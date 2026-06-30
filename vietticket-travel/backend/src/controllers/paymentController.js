const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { queueNewBookingNotification, emitBookingStatusUpdated } = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');

const {
  buildVnpayUrl,
  verifyVnpaySignature,
  formatVnpDate,
  signRefundData,
} = require('../utils/vnpay');
const { calculateRefundAmount, isBeforeRefundCutoff } = require('../utils/refundService');
const { sendRefundRequestReceivedEmail } = require('../utils/mailer');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('./bookingController');

const PAYMENT_WINDOW_MS = 10 * 60 * 1000; // 10 phút (khớp vnp_ExpireDate)

const MAX_PAYMENT_ATTEMPTS = 3;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

// VNPay yêu cầu số tiền nhân 100, dạng số nguyên.
function amountToVnp(totalAmount) {
  return Math.round(Number(totalAmount) * 100);
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
        reservation: true,
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

    if (Number(booking.totalAmount) <= 0) {
      return res.status(400).json({ message: 'Tổng tiền thanh toán phải lớn hơn 0.' });
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
    // TxnRef chỉ gồm [a-z0-9] (bỏ dấu '-' của uuid) + timestamp -> duy nhất mỗi lần thử.
    const txnRef = `${bookingId.replace(/-/g, '')}${now.getTime()}`;

    // Mỗi lần thử thanh toán là một Payment bất biến. Link cũ vẫn có thể được
    // VNPay callback an toàn, thay vì bị mất dấu khi người dùng bấm thử lại.
    await prisma.$transaction(async (tx) => {
      const claimedAttempt = await tx.reservation.updateMany({
        where: {
          id: booking.reservationId,
          status: 'HELD',
          expiresAt: { gt: now },
          paymentAttemptCount: { lt: MAX_PAYMENT_ATTEMPTS },
        },
        data: {
          paymentAttemptCount: { increment: 1 },
        },
      });
      if (claimedAttempt.count !== 1) {
        throw httpError(409, 'Đơn giữ chỗ đã hết hạn hoặc vượt quá số lần thanh toán.');
      }
      await tx.payment.create({
        data: {
          bookingId,
          amount: booking.totalAmount,
          paymentGateway: 'VNPAY',
          transactionId: txnRef,
          status: 'PENDING',
          expiresAt,
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
      vnp_Amount: amountToVnp(booking.totalAmount),
      vnp_ReturnUrl: returnUrl,
      vnp_IpAddr: getClientIp(req),
      vnp_CreateDate: formatVnpDate(now),
      vnp_ExpireDate: formatVnpDate(expiresAt),
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
                  include: { attraction: { select: { requiresManualApproval: true } } },
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

    const needsApproval =
      booking.reservation.ticketProduct.attraction.requiresManualApproval === true;
    const isSuccess = responseCode === '00' && transactionStatus === '00';

    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.booking.findUnique({
          where: { id: booking.id },
          include: { payments: true, reservation: true },
        });

        const currentPayment = current.payments.find((p) => p.id === payment.id);
        if (currentPayment?.status === 'SUCCESS') {
          return {
            code: '02',
            msg: 'Order already confirmed',
            bookingStatus: current.status,
          };
        }

        const successfulPayment = current.payments.find(
          (p) => p.status === 'SUCCESS' && p.id !== payment.id && !p.isDuplicate,
        );
        const reservation = current.reservation;
        let bookingStatus = current.status;

        if (isSuccess) {
          if (successfulPayment) {
            const duplicateRefundRequestId =
              `dup${String(payment.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 29)}`;
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'SUCCESS',
                paidAt: new Date(),
                rawResponse: query,
                isDuplicate: true,
                duplicateOfPaymentId: successfulPayment.id,
              },
            });
            await tx.booking.update({
              where: { id: current.id },
              data: { refundRequired: true },
            });
            let refundRequest = await tx.refundRequest.findUnique({
              where: { bookingId: current.id },
              select: { id: true },
            });
            if (!refundRequest) {
              refundRequest = await tx.refundRequest.create({
                data: {
                  bookingId: current.id,
                  requestedById: current.userId,
                  reason: `Duplicate VNPay payment captured: ${payment.transactionId}`,
                  amount: payment.amount,
                  status: 'PENDING',
                },
                select: { id: true },
              });
            }
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
                status: 'NEEDS_RECONCILIATION',
                reason: 'Khách hàng thanh toán thành công nhiều lần cho cùng một booking.',
                rawResponse: query,
              },
            });
            return {
              code: '00',
              msg: 'Duplicate payment recorded for refund',
              bookingStatus,
            };
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'SUCCESS',
              paidAt: new Date(),
              rawResponse: query,
            },
          });

          // Chỉ xác nhận khi đơn còn chờ thanh toán & vé còn giữ chỗ.
          // Guard current.status tránh "hồi sinh" đơn đã CANCELLED.
          if (current.status === 'PENDING_PAYMENT' && reservation.status === 'HELD') {
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
          } else {
            // Đã thu tiền nhưng vé đã bị thu hồi/đơn đã hủy -> cần hoàn tiền thủ công.
            await tx.booking.update({
              where: { id: current.id },
              data: { status: 'CANCELLED', refundRequired: true },
            });
            let refundRequest = await tx.refundRequest.findUnique({
              where: { bookingId: current.id },
              select: { id: true },
            });
            if (!refundRequest) {
              await tx.refundRequest.create({
                data: {
                  bookingId: current.id,
                  requestedById: current.userId,
                  reason: `Hệ thống tự động hủy đơn do vé đã bị thu hồi hoặc đơn giữ chỗ hết hạn trước khi thanh toán.`,
                  amount: current.totalAmount,
                  status: 'PENDING',
                },
              });
            }
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
              rawResponse: query,
            },
          });
        }

        return {
          code: '00',
          msg: 'Confirm success',
          bookingStatus,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (['PENDING_PARTNER', 'CONFIRMED'].includes(result.bookingStatus)) {
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
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
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

    const result = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            reservation: { include: { ticketProduct: true } },
            refundRequests: { select: { id: true } },
          },
        });

        if (!booking || booking.userId !== req.user.id) {
          throw httpError(404, 'Không tìm thấy đơn đặt vé.');
        }
        if (booking.status !== 'CONFIRMED') {
          throw httpError(409, 'Chỉ đơn đã xác nhận mới có thể yêu cầu hoàn tiền.');
        }
        const refundPolicy =
          booking.snapshotRefundPolicy || booking.reservation.ticketProduct.refundPolicy;
        if (refundPolicy === 'NON_REFUNDABLE') {
          throw httpError(400, 'Vé này không áp dụng chính sách hoàn tiền.');
        }
        if (!isBeforeRefundCutoff(booking)) {
          throw httpError(
            409,
            'Đã quá thời hạn hoàn tiền. Yêu cầu phải được gửi trước ngày sử dụng vé.',
          );
        }
        if (booking.refundRequests.length > 0) {
          throw httpError(409, 'Đơn này đã có yêu cầu hoàn tiền.');
        }

        const { refundAmount } = calculateRefundAmount(booking);

        const refundRequest = await tx.refundRequest.create({
          data: {
            bookingId,
            requestedById: req.user.id,
            reason,
            amount: refundAmount,
            status: 'PENDING',
          },
        });

        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'REFUND_REQUESTED' },
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
        reservation: { include: { ticketProduct: true } },
        refundRequests: { select: { id: true } },
      },
    });

    if (!booking || booking.userId !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé.' });
    }

    const ticketProduct = booking.reservation.ticketProduct;
    const refundPolicy = booking.snapshotRefundPolicy || ticketProduct.refundPolicy;
    const refundFeeRate = booking.snapshotRefundFeeRate ?? ticketProduct.refundFeeRate;
    const { refundAmount, feeAmount } = calculateRefundAmount(booking);
    const beforeCutoff = isBeforeRefundCutoff(booking);

    // Lý do không đủ điều kiện (theo thứ tự ưu tiên) để UI hiển thị chính xác.
    let notRefundableReason = null;
    if (booking.status !== 'CONFIRMED') {
      notRefundableReason = 'Chỉ đơn đã xác nhận mới có thể yêu cầu hoàn tiền.';
    } else if (refundPolicy === 'NON_REFUNDABLE') {
      notRefundableReason = 'Vé này không áp dụng chính sách hoàn tiền.';
    } else if (booking.refundRequests.length > 0) {
      notRefundableReason = 'Đơn này đã có yêu cầu hoàn tiền trước đó.';
    } else if (!beforeCutoff) {
      notRefundableReason =
        'Đã quá thời hạn hoàn tiền. Yêu cầu phải được gửi trước ngày sử dụng vé.';
    }

    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        status: booking.status,
        totalAmount: Number(booking.totalAmount),
        refundPolicy,
        refundFeeRate: Number(refundFeeRate),
        feeAmount,
        refundAmount,
        refundable: notRefundableReason === null,
        notRefundableReason,
        hasRefundRequest: booking.refundRequests.length > 0,
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
  const vnpPayDate = String(raw.vnp_PayDate || '');
  if (!payment?.transactionId || !vnpTransactionNo || !vnpPayDate) {
    throw httpError(
      422,
      'Thiếu thông tin giao dịch gốc để hoàn tiền (TxnRef/TransactionNo/PayDate).',
    );
  }

  const params = {
    vnp_RequestId: requestId || randomUUID(),
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: tmnCode,
    vnp_TransactionType: transactionType,
    vnp_TxnRef: payment.transactionId,
    vnp_Amount: amountToVnp(amount),
    vnp_TransactionNo: vnpTransactionNo,
    vnp_TransactionDate: vnpPayDate,
    vnp_CreateBy: createBy || 'system',
    vnp_CreateDate: formatVnpDate(new Date()),
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_OrderInfo: orderInfo || `Hoan tien giao dich ${payment.transactionId}`,
  };
  params.vnp_SecureHash = signRefundData(params, secret);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const result = await response.json().catch(() => ({}));

  return {
    success: result.vnp_ResponseCode === '00',
    requestId: params.vnp_RequestId,
    responseCode: result.vnp_ResponseCode || null,
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
};
