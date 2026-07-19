const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { queueNewBookingNotification, emitBookingStatusUpdated } = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');

const {
  buildVnpayUrl,
  verifyVnpaySignature,
  formatVnpDate,
  createVnpRequestId,
  signRefundData,
  signQueryData,
  verifyRefundResponseSignature,
  verifyQueryResponseSignature,
} = require('../utils/vnpay');
const {
  getRefundEligibility,
  releaseHeldInventory,
  releaseInventory,
} = require('../utils/refundService');
const {
  isTicketProductSaleEnabled,
  publicAttractionWhere,
} = require('../services/catalogVisibilityService');
const { sendRefundRequestReceivedEmail } = require('../utils/mailer');
const { queueMandatoryRefund } = require('../services/mandatoryRefundService');
const { getFrontendUrl } = require('../config/runtimeConfig');
const {
  MIN_VNPAY_AMOUNT,
  parseVndInteger,
} = require('../utils/money');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('./bookingController');

const PAYMENT_WINDOW_MS = 10 * 60 * 1000; // 10 phút (khớp vnp_ExpireDate)

const MAX_PAYMENT_ATTEMPTS = 3;
const VNPAY_API_TIMEOUT_MS = 15 * 1000;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getClientIp(req) {
  // Express only derives req.ip from proxy headers when `trust proxy` is
  // explicitly configured. Never trust a raw client-supplied X-Forwarded-For.
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

// VNPay yêu cầu số tiền nhân 100, dạng số nguyên.
function amountToVnp(totalAmount) {
  return Math.round(Number(totalAmount) * 100);
}

const VNP_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const LEGACY_TXN_TIMESTAMP_PATTERN = /(\d{13})$/;
const EARLIEST_SUPPORTED_PAYMENT_MS = Date.UTC(2020, 0, 1);

function parseVnpDate(value) {
  const match = VNP_DATE_PATTERN.exec(String(value || ''));
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const parsed = new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour - 7,
    minute,
    second,
  ));
  if (Number.isNaN(parsed.getTime())) return null;

  // Date.UTC also normalizes impossible component values. Compare in GMT+7 so
  // malformed gateway timestamps cannot silently become a different instant.
  const vietnamTime = new Date(parsed.getTime() + VN_OFFSET_MS);
  if (
    vietnamTime.getUTCFullYear() !== year
    || vietnamTime.getUTCMonth() + 1 !== month
    || vietnamTime.getUTCDate() !== day
    || vietnamTime.getUTCHours() !== hour
    || vietnamTime.getUTCMinutes() !== minute
    || vietnamTime.getUTCSeconds() !== second
  ) {
    return null;
  }
  return parsed;
}

function rawResponseObject(payment) {
  const raw = payment?.rawResponse;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function resolveOriginalVnpCreateDate(payment) {
  const raw = rawResponseObject(payment);
  const storedCreateDate = String(raw.vnp_CreateDate || '').trim();
  if (VNP_DATE_PATTERN.test(storedCreateDate) && parseVnpDate(storedCreateDate)) {
    return storedCreateDate;
  }

  // Legacy attempts encoded the exact creation epoch in the TxnRef suffix.
  // Only accept a plausible timestamp and, when available, the expected booking
  // prefix so an unrelated numeric reference is never guessed as a date.
  const transactionId = String(payment?.transactionId || '');
  const timestampMatch = LEGACY_TXN_TIMESTAMP_PATTERN.exec(transactionId);
  if (!timestampMatch) return '';
  const bookingPrefix = String(payment?.bookingId || '').replace(/-/g, '');
  if (bookingPrefix && !transactionId.startsWith(bookingPrefix)) return '';
  const timestamp = Number(timestampMatch[1]);
  if (
    !Number.isSafeInteger(timestamp)
    || timestamp < EARLIEST_SUPPORTED_PAYMENT_MS
    || timestamp > Date.now() + 24 * 60 * 60 * 1000
  ) {
    return '';
  }
  return formatVnpDate(new Date(timestamp));
}

function mergeVnpayRawResponse(payment, query) {
  const originalCreateDate = resolveOriginalVnpCreateDate(payment);
  return {
    ...rawResponseObject(payment),
    ...query,
    ...(originalCreateDate ? { vnp_CreateDate: originalCreateDate } : {}),
  };
}

function resolvePaymentDeadline(payment, reservation) {
  const rawExpiry = parseVnpDate(rawResponseObject(payment).vnp_ExpireDate);
  const candidates = [
    payment?.expiresAt,
    reservation?.paymentDeadline,
    reservation?.expiresAt,
    rawExpiry,
  ]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((value) => value.getTime())));
}

// POST /api/payments/create-vnpay-url
async function createVNPayUrl(req, res, next) {
  try {
    const bookingId = String(req.body?.bookingId || req.params?.bookingId || '').trim();
    if (!bookingId) {
      return res.status(400).json({ message: 'bookingId là bắt buộc.' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        reservation: {
          include: {
            ticketProduct: {
              include: {
                attraction: { include: { partner: { select: { status: true } } } },
              },
            },
          },
        },
        payments: {
          select: { id: true, status: true, transactionId: true, isDuplicate: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!booking || booking.userId !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé.' });
    }
    if (booking.paymentMethod !== 'vnpay') {
      return res.status(400).json({ message: 'Đơn này không dùng phương thức VNPay.' });
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ message: 'Đơn không ở trạng thái chờ thanh toán.' });
    }
    if (!isTicketProductSaleEnabled(booking.reservation?.ticketProduct)) {
      return res.status(409).json({
        message: 'Gói vé đã tạm dừng bán và không thể tiếp tục thanh toán.',
      });
    }

    const paymentAmount = parseVndInteger(booking.totalAmount);
    if (paymentAmount === null) {
      return res.status(400).json({
        message: 'Tổng tiền thanh toán phải là số nguyên VND hợp lệ lớn hơn 0.',
      });
    }
    if (paymentAmount < MIN_VNPAY_AMOUNT) {
      return res.status(400).json({
        message: `Số tiền thanh toán VNPay tối thiểu là ${MIN_VNPAY_AMOUNT.toLocaleString('vi-VN')} VND.`,
      });
    }

    if (booking.payments.some((payment) => payment.status === 'SUCCESS' && !payment.isDuplicate)) {
      return res.status(409).json({ message: 'Đơn này đã thanh toán thành công.' });
    }

    const now = new Date();
    const paymentDeadline = booking.reservation?.paymentDeadline
      || booking.reservation?.expiresAt;
    if (!booking.reservation || !paymentDeadline || new Date(paymentDeadline) <= now) {
      return res.status(409).json({ message: 'Đơn giữ chỗ đã hết hạn thanh toán.' });
    }
    if (booking.reservation.paymentAttemptCount >= MAX_PAYMENT_ATTEMPTS) {
      return res.status(429).json({
        message: 'Bạn đã tạo quá nhiều liên kết thanh toán cho đơn này.',
      });
    }

    const tmnCode = process.env.VNP_TMNCODE;
    const secret = process.env.VNP_HASHSECRET;
    const vnpUrl = process.env.VNP_URL;
    const returnUrl = process.env.VNP_RETURNURL;
    if (!tmnCode || !secret || !vnpUrl || !returnUrl) {
      return res.status(500).json({ message: 'Thiếu cấu hình VNPay trên máy chủ.' });
    }

    const requestedExpiry = new Date(now.getTime() + PAYMENT_WINDOW_MS);
    const expiresAt = new Date(
      Math.min(requestedExpiry.getTime(), new Date(paymentDeadline).getTime()),
    );
    const vnpCreateDate = formatVnpDate(now);
    const vnpExpireDate = formatVnpDate(expiresAt);
    // TxnRef chỉ gồm [a-z0-9]. Thêm entropy ngẫu nhiên để hai request đồng
    // thời trong cùng một mili-giây vẫn không thể dùng chung mã giao dịch; giữ
    // timestamp ở cuối để dữ liệu legacy còn có thể suy ra vnp_CreateDate.
    const txnRef =
      `${bookingId.replace(/-/g, '')}${createVnpRequestId().slice(0, 12)}${now.getTime()}`;

    // Mỗi lần thử thanh toán là một Payment bất biến. Link cũ vẫn có thể được
    // VNPay callback an toàn, thay vì bị mất dấu khi người dùng bấm thử lại.
    await prisma.$transaction(async (tx) => {
      const claimedAttempt = await tx.reservation.updateMany({
        where: {
          id: booking.reservationId,
          status: 'HELD',
          expiresAt: { gt: now },
          paymentAttemptCount: { lt: MAX_PAYMENT_ATTEMPTS },
          ticketProduct: {
            status: 'ACTIVE',
            archivedAt: null,
            attraction: publicAttractionWhere(),
          },
        },
        data: {
          paymentAttemptCount: { increment: 1 },
        },
      });
      if (claimedAttempt.count !== 1) {
        throw httpError(409, 'Đơn giữ chỗ đã hết hạn, gói vé đã dừng bán hoặc vượt quá số lần thanh toán.');
      }
      await tx.payment.create({
        data: {
          bookingId,
          amount: paymentAmount,
          paymentGateway: 'VNPAY',
          transactionId: txnRef,
          status: 'PENDING',
          expiresAt,
          // Persist the merchant-side transaction date. VNPay requires this
          // exact PAY vnp_CreateDate later for both QueryDR and Refund.
          rawResponse: {
            vnp_CreateDate: vnpCreateDate,
            vnp_ExpireDate: vnpExpireDate,
          },
        },
      });
    });

    const params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: `Thanh toan don hang ${bookingId}`,
      vnp_OrderType: 'other',
      vnp_Amount: amountToVnp(paymentAmount),
      vnp_ReturnUrl: returnUrl,
      vnp_IpAddr: getClientIp(req),
      vnp_CreateDate: vnpCreateDate,
      vnp_ExpireDate: vnpExpireDate,
    };

    const paymentUrl = buildVnpayUrl(params, { vnpUrl, secret });
    return res.json({ success: true, data: { paymentUrl } });
  } catch (error) {
    return next(error);
  }
}

// Dùng chung cho IPN và return. Chữ ký phải được xác thực trước khi gọi.
async function reconcileVnpayPayment(query) {
    const txnRef = String(query.vnp_TxnRef || '');
    const responseCode = String(query.vnp_ResponseCode || '');
    const transactionStatus = String(query.vnp_TransactionStatus || '');
    const vnpAmount = String(query.vnp_Amount || '');

    const payment = await prisma.payment.findUnique({
      where: { transactionId: txnRef },
      include: {
        booking: {
          include: {
            reservation: {
              include: {
                ticketProduct: {
                  include: {
                    attraction: {
                      include: { partner: { select: { status: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!payment || !payment.booking) {
      return { code: '01', msg: 'Order not found', bookingId: '' };
    }

    const booking = payment.booking;
    if (vnpAmount !== String(amountToVnp(booking.totalAmount))) {
      return { code: '04', msg: 'Invalid amount', bookingId: booking.id };
    }

    const isSuccess = responseCode === '00' && transactionStatus === '00';

    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.booking.findUnique({
          where: { id: booking.id },
          include: {
            payments: true,
            refundRequests: true,
            reservation: {
              include: {
                ticketProduct: {
                  include: {
                    attraction: {
                      include: { partner: { select: { status: true } } },
                    },
                  },
                },
              },
            },
          },
        });

        const currentPayment = current.payments.find((p) => p.id === payment.id);
        if (currentPayment?.status === 'SUCCESS') {
          return {
            code: '02',
            msg: 'Order already confirmed',
            bookingStatus: current.status,
          };
        }
        const paymentState = {
          ...payment,
          ...currentPayment,
          rawResponse: currentPayment?.rawResponse ?? payment.rawResponse,
        };
        const callbackReceivedAt = new Date();
        const capturedAt = parseVnpDate(query.vnp_PayDate);
        const hasGatewayPayDate = String(query.vnp_PayDate || '').trim().length > 0;
        // VNPay documents vnp_PayDate as optional in PAY callbacks. When it is
        // omitted, a signed success received inside the merchant's own signed
        // payment window is sufficient to fulfil the hold. A malformed value
        // remains fail-closed; a callback first received after the deadline is
        // captured and refunded because its actual payment time is unknowable.
        const effectiveCapturedAt =
          capturedAt || (!hasGatewayPayDate ? callbackReceivedAt : null);
        const gatewayRawResponse = {
          ...mergeVnpayRawResponse(paymentState, query),
          callbackReceivedAt: callbackReceivedAt.toISOString(),
          captureTimingSource: capturedAt
            ? 'VNP_PAY_DATE'
            : hasGatewayPayDate
              ? 'INVALID_VNP_PAY_DATE'
              : 'MERCHANT_RECEIVED_AT',
        };
        const paymentDeadline = resolvePaymentDeadline(paymentState, current.reservation);
        const paidWithinDeadline = Boolean(
          effectiveCapturedAt
          && paymentDeadline
          && effectiveCapturedAt.getTime() <= paymentDeadline.getTime(),
        );

        const successfulPayment = current.payments.find(
          (p) => p.status === 'SUCCESS' && p.id !== payment.id && !p.isDuplicate,
        );
        const reservation = current.reservation;
        const saleEnabled = isTicketProductSaleEnabled(reservation?.ticketProduct);
        const needsApproval =
          reservation?.ticketProduct?.attraction?.requiresManualApproval === true;
        let bookingStatus = current.status;

        if (isSuccess) {
          if (successfulPayment) {
            const duplicateRefundRequestId =
              `dup${String(payment.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 29)}`;
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'SUCCESS',
                paidAt: effectiveCapturedAt || callbackReceivedAt,
                rawResponse: gatewayRawResponse,
                isDuplicate: true,
                duplicateOfPaymentId: successfulPayment.id,
              },
            });
            await tx.booking.update({
              where: { id: current.id },
              data: { refundRequired: true },
            });
            const duplicateRequestKey = `duplicate:${payment.id}`;
            const refundRequest = await tx.refundRequest.upsert({
              where: { requestKey: duplicateRequestKey },
              update: {},
              create: {
                bookingId: current.id,
                requestKey: duplicateRequestKey,
                requestedById: current.userId,
                type: 'DUPLICATE_PAYMENT',
                mandatory: true,
                reason: `Duplicate VNPay payment captured: ${payment.transactionId}`,
                originalAmount: payment.amount,
                amount: payment.amount,
                feeAmount: 0,
                policySnapshot: current.snapshotRefundPolicy || null,
                feeRateSnapshot: 0,
                bookingStatusBeforeRequest: current.status,
                status: 'PROCESSING',
                processingStartedAt: new Date(),
              },
              select: { id: true },
            });
            await tx.refundTransaction.upsert({
              where: { gatewayRequestId: duplicateRefundRequestId },
              update: {},
              create: {
                bookingId: current.id,
                paymentId: payment.id,
                refundRequestId: refundRequest.id,
                gatewayRequestId: duplicateRefundRequestId,
                transactionType: '02',
                amount: payment.amount,
                status: 'PENDING',
                reason: 'Khách hàng thanh toán thành công nhiều lần cho cùng một booking.',
                rawResponse: gatewayRawResponse,
              },
            });
            await tx.payment.updateMany({
              where: {
                bookingId: current.id,
                id: { not: payment.id },
                status: 'PENDING',
              },
              data: {
                status: 'FAILED',
                failureReason: 'SUPERSEDED_BY_SUCCESSFUL_PAYMENT',
              },
            });
            return {
              code: '00',
              msg: 'Duplicate payment recorded for refund',
              bookingStatus,
              shouldNotifyPaidStatus: false,
            };
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'SUCCESS',
              paidAt: effectiveCapturedAt || callbackReceivedAt,
              rawResponse: gatewayRawResponse,
            },
          });
          await tx.payment.updateMany({
            where: {
              bookingId: current.id,
              id: { not: payment.id },
              status: 'PENDING',
            },
            data: {
              status: 'FAILED',
              failureReason: 'SUPERSEDED_BY_SUCCESSFUL_PAYMENT',
            },
          });

          // Chỉ xác nhận khi giao dịch được ghi nhận trong chính payment window
          // đã ký với VNPay, đơn còn chờ thanh toán và vé còn giữ chỗ.
          // Guard current.status tránh "hồi sinh" đơn đã CANCELLED.
          if (
            current.status === 'PENDING_PAYMENT'
            && reservation.status === 'HELD'
            && saleEnabled
            && paidWithinDeadline
          ) {
            await confirmReservationAndStock(tx, reservation);
            if (needsApproval) {
              await tx.booking.update({
                where: { id: current.id },
                data: { status: 'PENDING_PARTNER' },
              });
              bookingStatus = 'PENDING_PARTNER';
            } else {
              await tx.booking.update({
                where: { id: current.id },
                data: { status: 'CONFIRMED' },
              });
              await createTicketInstances(
                tx,
                current.id,
                reservation.ticketProductId,
                reservation.quantity,
              );
              bookingStatus = 'CONFIRMED';
            }
            return {
              code: '00',
              msg: 'Confirm success',
              bookingStatus,
              shouldNotifyPaidStatus: true,
            };
          } else {
            const cancelledAt = new Date();
            const saleDisabled = !saleEnabled;
            const cancellationReason = saleDisabled
              ? 'Thanh toán thành công sau khi đối tác hoặc gói vé đã tạm dừng bán.'
              : 'Thanh toán thành công sau khi đơn giữ chỗ không còn hiệu lực.';

            const shouldReturnUnfulfilledInventory =
              current.status === 'PENDING_PAYMENT'
              && ['HELD', 'CONFIRMED'].includes(reservation.status);
            if (shouldReturnUnfulfilledInventory && reservation.status === 'HELD') {
              await releaseHeldInventory(tx, reservation);
            } else if (shouldReturnUnfulfilledInventory && reservation.status === 'CONFIRMED') {
              await releaseInventory(tx, current);
            }
            if (shouldReturnUnfulfilledInventory && current.voucherId) {
              await tx.voucher.updateMany({
                where: { id: current.voucherId, usedCount: { gt: 0 } },
                data: { usedCount: { decrement: 1 } },
              });
            }
            await tx.payment.updateMany({
              where: {
                bookingId: current.id,
                id: { not: payment.id },
                status: 'PENDING',
              },
              data: {
                status: 'FAILED',
                failureReason: saleDisabled ? 'SALE_SUSPENDED' : 'BOOKING_EXPIRED',
              },
            });
            // Đã thu tiền nhưng vé đã bị thu hồi/đơn đã hủy -> cần hoàn tiền thủ công.
            await tx.booking.update({
              where: { id: current.id },
              data: {
                status: 'CANCELLED',
                refundRequired: true,
                cancelledAt,
                cancellationReason,
                cancellationSource: saleDisabled
                  ? 'SALE_SUSPENDED_AFTER_HOLD'
                  : 'PAYMENT_AFTER_EXPIRY',
              },
            });
            const capturedBooking = {
              ...current,
              payments: current.payments.map((item) => (
                item.id === payment.id
                  ? {
                      ...item,
                      status: 'SUCCESS',
                      paidAt: effectiveCapturedAt || callbackReceivedAt,
                      paymentGateway: payment.paymentGateway,
                      rawResponse: gatewayRawResponse,
                    }
                  : item
              )),
            };
            await queueMandatoryRefund(tx, capturedBooking, {
              now: cancelledAt,
              type: 'SYSTEM_CANCELLATION',
              reason: saleDisabled
                ? 'Hệ thống tự động hủy và hoàn toàn bộ tiền vì đối tác hoặc gói vé đã tạm dừng bán trước khi giao dịch được xác nhận.'
                : 'Hệ thống tự động hủy đơn do vé đã bị thu hồi hoặc đơn giữ chỗ hết hạn trước khi thanh toán.',
            });
            bookingStatus = 'CANCELLED';
          }
        } else {
          // Thất bại: chỉ đánh dấu Payment FAILED, GIỮ Booking PENDING_PAYMENT
          // để khách thử lại (createVNPayUrl). Worker sẽ dọn nếu khách bỏ luôn.
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'FAILED',
              failureReason: responseCode || transactionStatus || 'UNKNOWN',
              rawResponse: gatewayRawResponse,
            },
          });
        }

        return {
          code: '00',
          msg: 'Confirm success',
          bookingStatus,
          shouldNotifyPaidStatus: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (
      result.shouldNotifyPaidStatus
      && ['PENDING_PARTNER', 'CONFIRMED'].includes(result.bookingStatus)
    ) {
      // Thông báo cho Partner có đơn mới
      queueNewBookingNotification(booking.id);

      // Đẩy WebSocket ngay tới Customer để UI cập nhật status không cần F5
      emitBookingStatusUpdated({
        customerId: booking.userId,
        bookingId: booking.id,
        status: result.bookingStatus,
        message:
          result.bookingStatus === 'CONFIRMED'
            ? `Đặt vé ${booking.id.slice(0, 8).toUpperCase()} của bạn đã được thanh toán và xác nhận thành công!`
            : `Đơn hàng ${booking.id.slice(0, 8).toUpperCase()} đã thanh toán thành công và đang chờ đối tác phê duyệt.`,
      });

      // Nếu địa điểm không cần duyệt thủ công -> CONFIRMED ngay: gửi email vé PDF luôn
      if (result.bookingStatus === 'CONFIRMED') {
        queueConfirmedTicketEmail(booking.id);
      }
    }

    return { ...result, bookingId: booking.id };
}

// GET /api/payments/vnpay-ipn — VNPay gọi server-to-server (KHÔNG auth).
// Luôn trả HTTP 200 kèm { RspCode, Message }.
async function vnpayIpn(req, res) {
  try {
    const secret = process.env.VNP_HASHSECRET;
    const query = { ...req.query };

    if (!verifyVnpaySignature(query, secret)) {
      return res.status(200).json({ RspCode: '97', Message: 'Invalid signature' });
    }

    const result = await reconcileVnpayPayment(query);
    return res.status(200).json({ RspCode: result.code, Message: result.msg });
  } catch (error) {
    // Serialization failure / lỗi bất ngờ -> trả mã != 00 để VNPay gọi lại.
    console.error('[vnpay-ipn] Lỗi:', error.message);
    return res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
  }
}

// GET /api/payments/vnpay-return — VNPay redirect trình duyệt khách về.
// Return hợp lệ cũng đối soát như fallback idempotent cho môi trường local/private,
// nơi VNPay không thể gọi IPN vào localhost.
async function vnpayReturn(req, res, next) {
  try {
    const secret = process.env.VNP_HASHSECRET;
    const frontend = getFrontendUrl();
    const query = { ...req.query };

    const valid = verifyVnpaySignature(query, secret);
    const txnRef = String(query.vnp_TxnRef || '');
    const responseCode = String(query.vnp_ResponseCode || '');

    let bookingId = '';
    let reconciliation = null;
    if (valid && txnRef) {
      reconciliation = await reconcileVnpayPayment(query);
      bookingId = reconciliation.bookingId || '';
    }

    const reconciled =
      reconciliation
      && ['00', '02'].includes(reconciliation.code)
      && reconciliation.bookingStatus !== 'CANCELLED';
    const status =
      !valid || (responseCode === '00' && !reconciled)
        ? 'invalid'
        : responseCode === '00'
          ? 'success'
          : 'failed';
    const url =
      `${frontend}/booking-success?bookingId=${encodeURIComponent(bookingId)}` +
      `&status=${status}&vnp_ResponseCode=${encodeURIComponent(responseCode)}`;
    return res.redirect(url);
  } catch (error) {
    return next(error);
  }
}

// POST /api/payments/refund-request — khách hàng GỬI yêu cầu hoàn tiền.
// Tạo RefundRequest (PENDING) + chuyển đơn sang REFUND_REQUESTED. Staff sẽ duyệt sau.
async function createRefundRequest(req, res, next) {
  try {
    const bookingId = String(req.body?.bookingId || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!bookingId) {
      return res.status(400).json({ message: 'bookingId là bắt buộc.' });
    }
    if (reason.length < 5) {
      return res.status(400).json({ message: 'Vui lòng nhập lý do hoàn tiền (tối thiểu 5 ký tự).' });
    }
    if (reason.length > 1000) {
      return res.status(400).json({ message: 'Lý do hoàn tiền không được vượt quá 1000 ký tự.' });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            reservation: {
              include: {
                timeSlot: true,
                ticketProduct: {
                  include: {
                    attraction: { select: { openTime: true, closeTime: true } },
                  },
                },
              },
            },
            payments: {
              where: { status: 'SUCCESS', isDuplicate: false },
              select: {
                id: true,
                amount: true,
                status: true,
                isDuplicate: true,
                paymentGateway: true,
              },
            },
            ticketInstances: { select: { status: true } },
            refundRequests: {
              select: { id: true, type: true, status: true },
            },
          },
        });

        if (!booking || booking.userId !== req.user.id) {
          throw httpError(404, 'Không tìm thấy đơn đặt vé.');
        }
        const eligibility = getRefundEligibility(booking);
        if (!eligibility.refundable) {
          throw httpError(409, eligibility.notRefundableReason);
        }
        const capturedPayment = booking.payments[0];
        if (eligibility.refundAmount > Number(capturedPayment.amount)) {
          throw httpError(409, 'Số tiền hoàn vượt quá giao dịch thanh toán gốc.');
        }

        const claimed = await tx.booking.updateMany({
          where: { id: bookingId, status: 'CONFIRMED' },
          data: { status: 'REFUND_REQUESTED' },
        });
        if (claimed.count !== 1) {
          throw httpError(409, 'Đơn vừa được cập nhật ở một phiên khác. Vui lòng tải lại.');
        }

        const refundRequest = await tx.refundRequest.create({
          data: {
            bookingId,
            requestKey: `customer:${bookingId}`,
            requestedById: req.user.id,
            type: 'CUSTOMER_CANCELLATION',
            mandatory: false,
            reason,
            originalAmount: booking.totalAmount,
            amount: eligibility.refundAmount,
            feeAmount: eligibility.feeAmount,
            policySnapshot: eligibility.refundPolicy,
            feeRateSnapshot: eligibility.refundFeeRate,
            bookingStatusBeforeRequest: booking.status,
            status: 'PENDING',
          },
        });

        return { refundRequest, booking };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Email xác nhận đã tiếp nhận yêu cầu (không chặn response nếu gửi lỗi).
    try {
      await sendRefundRequestReceivedEmail({
        to: result.booking.email,
        fullName: result.booking.fullName,
        bookingId: result.booking.id,
        refundAmount: Number(result.refundRequest.amount),
      });
    } catch (emailError) {
      console.error('[refund-request] Không thể gửi email xác nhận:', emailError.message);
    }

    return res.status(201).json({ success: true, data: result.refundRequest });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { message: error.message },
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      return res.status(409).json({
        success: false,
        error: { message: 'Yêu cầu hoàn tiền đã được tạo hoặc đơn vừa thay đổi. Vui lòng tải lại.' },
      });
    }
    return next(error);
  }
}

// GET /api/payments/refund-preview/:bookingId — xem trước số tiền hoàn cho modal.
async function getRefundPreview(req, res, next) {
  try {
    const { bookingId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        reservation: {
          include: {
            timeSlot: true,
            ticketProduct: {
              include: {
                attraction: { select: { openTime: true, closeTime: true } },
              },
            },
          },
        },
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: {
            amount: true,
            status: true,
            isDuplicate: true,
            paymentGateway: true,
          },
        },
        ticketInstances: { select: { status: true } },
        refundRequests: { select: { id: true, type: true, status: true } },
      },
    });

    if (!booking || booking.userId !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé.' });
    }

    const eligibility = getRefundEligibility(booking);

    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        status: booking.status,
        totalAmount: Number(booking.totalAmount),
        refundPolicy: eligibility.refundPolicy,
        refundFeeRate: Number(eligibility.refundFeeRate),
        refundCutoffHours: eligibility.refundCutoffHours,
        refundDeadline: eligibility.refundDeadline,
        feeAmount: eligibility.feeAmount,
        refundAmount: eligibility.refundAmount,
        refundable: eligibility.refundable,
        notRefundableReason: eligibility.notRefundableReason,
        hasRefundRequest: Boolean(eligibility.customerRequest),
        visitDate: booking.reservation.date,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// Gọi API hoàn tiền VNPay (Sandbox). KHÔNG gọi trong transaction DB (I/O mạng chậm).
// Trả { success, responseCode, message, raw }. Ném lỗi nếu thiếu cấu hình/dữ liệu gốc.
// payment: bản ghi Payment SUCCESS của đơn (đã lưu rawResponse từ IPN).
// transactionType: '02' (toàn phần) hoặc '03' (một phần — khi có phí hủy).
async function refundViaVnpay({
  payment,
  amount,
  transactionType,
  createBy,
  ipAddr,
  orderInfo,
  requestId,
}) {
  const tmnCode = process.env.VNP_TMNCODE;
  const secret = process.env.VNP_HASHSECRET;
  const apiUrl = process.env.VNP_API;
  if (!tmnCode || !secret || !apiUrl) {
    throw httpError(500, 'Thiếu cấu hình VNPay hoàn tiền (VNP_TMNCODE/VNP_HASHSECRET/VNP_API).');
  }

  const raw = payment?.rawResponse || {};
  const vnpTransactionNo = String(raw.vnp_TransactionNo || '');
  const originalCreateDate = resolveOriginalVnpCreateDate(payment);
  if (!payment?.transactionId || !vnpTransactionNo || !originalCreateDate) {
    throw httpError(
      422,
      'Thiếu thông tin giao dịch gốc để hoàn tiền (TxnRef/TransactionNo/original vnp_CreateDate).',
    );
  }
  const refundAmount = Number(amount);
  const capturedAmount = Number(payment.amount);
  if (
    !Number.isSafeInteger(refundAmount)
    || refundAmount <= 0
    || !Number.isSafeInteger(capturedAmount)
    || refundAmount > capturedAmount
  ) {
    throw httpError(422, 'Số tiền hoàn phải là số nguyên VND và không vượt quá giao dịch gốc.');
  }
  if (!['02', '03'].includes(transactionType)) {
    throw httpError(422, 'Loại giao dịch hoàn tiền phải là 02 (toàn phần) hoặc 03 (một phần).');
  }
  if (transactionType === '02' && refundAmount !== capturedAmount) {
    throw httpError(422, 'Hoàn toàn phần phải bằng đúng số tiền của giao dịch gốc.');
  }
  if (transactionType === '03' && refundAmount >= capturedAmount) {
    throw httpError(422, 'Hoàn một phần phải nhỏ hơn số tiền của giao dịch gốc.');
  }

  const params = {
    vnp_RequestId: requestId || createVnpRequestId(),
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: tmnCode,
    vnp_TransactionType: transactionType,
    vnp_TxnRef: payment.transactionId,
    vnp_Amount: amountToVnp(refundAmount),
    vnp_TransactionNo: vnpTransactionNo,
    vnp_TransactionDate: originalCreateDate,
    vnp_CreateBy: String(createBy || 'system').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'system',
    vnp_CreateDate: formatVnpDate(new Date()),
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_OrderInfo: orderInfo || `Hoan tien giao dich ${payment.transactionId}`,
  };
  params.vnp_SecureHash = signRefundData(params, secret);

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(VNPAY_API_TIMEOUT_MS),
    });
  } catch (error) {
    error.gatewayAttempted = true;
    throw error;
  }
  if (!response.ok) {
    const error = httpError(502, `VNPay trả về HTTP ${response.status} khi gửi yêu cầu hoàn tiền.`);
    error.gatewayAttempted = true;
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!verifyRefundResponseSignature(result, secret)) {
    const error = httpError(502, 'Chữ ký phản hồi hoàn tiền từ VNPay không hợp lệ.');
    error.gatewayAttempted = true;
    throw error;
  }

  return {
    success:
      result.vnp_ResponseCode === '00'
      && result.vnp_TransactionStatus === '00',
    requestId: params.vnp_RequestId,
    responseCode: result.vnp_ResponseCode || null,
    transactionStatus: result.vnp_TransactionStatus || null,
    message: result.vnp_Message || null,
    rawRequest: params,
    raw: result,
  };
}

async function queryVnpayTransaction({
  payment,
  ipAddr = '127.0.0.1',
  orderInfo,
  requestId,
}) {
  const tmnCode = process.env.VNP_TMNCODE;
  const secret = process.env.VNP_HASHSECRET;
  const apiUrl = process.env.VNP_API;
  if (!tmnCode || !secret || !apiUrl) {
    throw httpError(500, 'Thiếu cấu hình VNPay đối soát (VNP_TMNCODE/VNP_HASHSECRET/VNP_API).');
  }

  const raw = payment?.rawResponse || {};
  const transactionNo = String(raw.vnp_TransactionNo || '');
  const transactionDate = resolveOriginalVnpCreateDate(payment);
  if (!payment?.transactionId || !transactionDate) {
    throw httpError(
      422,
      'Thiếu original vnp_CreateDate của giao dịch thanh toán để đối soát VNPay.',
    );
  }

  const params = {
    vnp_RequestId: requestId || createVnpRequestId(),
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: tmnCode,
    vnp_TxnRef: payment.transactionId,
    vnp_TransactionNo: transactionNo || undefined,
    vnp_TransactionDate: transactionDate,
    vnp_CreateDate: formatVnpDate(new Date()),
    vnp_IpAddr: ipAddr,
    vnp_OrderInfo: orderInfo || `Doi soat giao dich ${payment.transactionId}`,
  };
  params.vnp_SecureHash = signQueryData(params, secret);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(VNPAY_API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw httpError(502, `VNPay trả về HTTP ${response.status} khi đối soát.`);
  }
  const result = await response.json().catch(() => ({}));
  if (!verifyQueryResponseSignature(result, secret)) {
    throw httpError(502, 'Chữ ký phản hồi đối soát từ VNPay không hợp lệ.');
  }

  return {
    requestId: params.vnp_RequestId,
    responseCode: result.vnp_ResponseCode || null,
    transactionStatus: result.vnp_TransactionStatus || null,
    transactionType: result.vnp_TransactionType || null,
    amount: Number(result.vnp_Amount || 0) / 100,
    message: result.vnp_Message || null,
    rawRequest: params,
    raw: result,
  };
}

module.exports = {
  createVNPayUrl,
  vnpayIpn,
  vnpayReturn,
  createRefundRequest,
  getRefundPreview,
  refundViaVnpay,
  queryVnpayTransaction,
};
