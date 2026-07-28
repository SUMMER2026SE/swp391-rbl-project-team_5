'use strict';

// ============================================================
// bankTransferService.js — Thanh toán bằng chuyển khoản ngân hàng (VietQR).
// ------------------------------------------------------------
// Khách quét mã VietQR trong app ngân hàng -> tiền về thẳng tài khoản nền tảng.
// Cổng chuyển khoản KHÔNG có callback như VNPay, nên đơn chỉ được xác nhận khi
// Admin đối chiếu sao kê và bấm duyệt (confirmBankTransfer).
//
// An toàn tiền của khách:
//   - Giữ chỗ mặc định chỉ 10 phút, không đủ cho chuyển khoản + duyệt tay.
//     Đơn chuyển khoản được nới hạn giữ chỗ (BANK_TRANSFER_HOLD_MINUTES)
//     để tránh cảnh "khách đã chuyển tiền nhưng đơn bị worker tự hủy".
//   - Xác nhận là idempotent: transactionId = BT-<bookingId> (unique) nên
//     không thể ghi nhận thanh toán hai lần cho cùng một đơn.
// ============================================================

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { getBankTransferConfig } = require('../config/runtimeConfig');
const { buildVietQrPayload } = require('../utils/vietqr');
const { formatBookingReference } = require('../utils/bookingReference');
const {
  BANK_TRANSFER_METHOD,
  buildTransferContent,
  getBankTransferHoldMinutes,
  getBankTransferHoldMs,
} = require('../utils/bankTransferPolicy');
const { isTicketProductSaleEnabled } = require('../services/catalogVisibilityService');
const { awardPointsForBooking } = require('../services/loyaltyService');
const { queueMandatoryRefund } = require('../services/mandatoryRefundService');
const { writeAuditLog } = require('../utils/auditLog');
const {
  isBankTransferPayment,
  isCapturedPayment,
} = require('../utils/paymentGateway');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('../controllers/bookingController');

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isBankTransferAvailable() {
  return getBankTransferConfig().configured;
}

// Thông tin hiển thị cho khách ở trang thanh toán.
function buildTransferInstruction(booking) {
  const config = getBankTransferConfig();
  if (!config.configured) {
    throw httpError(
      503,
      'Nền tảng chưa cấu hình tài khoản ngân hàng nhận tiền. Vui lòng chọn thanh toán VNPay.',
    );
  }

  const amount = Number(booking.totalAmount);
  const content = buildTransferContent(booking.id);

  return {
    bankName: config.bankName || null,
    bankBin: config.bankBin,
    accountNumber: config.accountNumber,
    accountName: config.accountName,
    amount,
    content,
    bookingReference: formatBookingReference(booking.id),
    // Chuỗi để frontend render thành ảnh QR (không gọi dịch vụ ngoài).
    qrPayload: buildVietQrPayload({
      bankBin: config.bankBin,
      accountNumber: config.accountNumber,
      amount,
      content,
    }),
    expiresAt: booking.reservation?.expiresAt || null,
    holdMinutes: getBankTransferHoldMinutes(),
  };
}

const CONFIRM_INCLUDE = {
  payments: {
    where: { status: 'SUCCESS', isDuplicate: false },
    select: {
      id: true,
      amount: true,
      status: true,
      isDuplicate: true,
      paymentGateway: true,
      transactionId: true,
      paidAt: true,
    },
  },
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
};

/**
 * Admin xác nhận đã nhận được tiền chuyển khoản của một đơn.
 * Lặp lại đúng các bước của luồng VNPay: chốt kho -> chuyển trạng thái ->
 * phát vé QR -> cộng điểm thưởng, tất cả trong một transaction Serializable.
 */
async function confirmBankTransfer({ bookingId, actorId, req = null, note = null }) {
  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: CONFIRM_INCLUDE,
      });

      if (!booking || booking.isForecastTrainingSample) {
        throw httpError(404, 'Không tìm thấy đơn đặt vé.');
      }
      if (booking.paymentMethod !== BANK_TRANSFER_METHOD) {
        throw httpError(400, 'Đơn này không thanh toán bằng chuyển khoản ngân hàng.');
      }

      // Idempotent: đơn đã được xác nhận trước đó thì báo lại, không xử lý tiếp.
      if (['CONFIRMED', 'PENDING_PARTNER', 'COMPLETED'].includes(booking.status)) {
        return { alreadyConfirmed: true, bookingStatus: booking.status, booking };
      }
      if (
        ['CANCELLED', 'REFUNDED'].includes(booking.status)
        && (booking.payments || []).some((payment) => (
          isCapturedPayment(payment) && isBankTransferPayment(payment)
        ))
      ) {
        return {
          alreadyConfirmed: true,
          latePayment: true,
          bookingStatus: booking.status,
          booking,
        };
      }
      const now = new Date();
      const cannotFulfill = (
        booking.status === 'CANCELLED'
        || !booking.reservation
        || booking.reservation.status !== 'HELD'
        || booking.reservation.expiresAt <= now
        || !isTicketProductSaleEnabled(booking.reservation.ticketProduct)
      );
      if (cannotFulfill) {
        const payment = await tx.payment.upsert({
          where: { transactionId: `BT-${booking.id}` },
          update: {},
          create: {
            bookingId: booking.id,
            amount: booking.totalAmount,
            paymentGateway: 'BANK_TRANSFER',
            transactionId: `BT-${booking.id}`,
            status: 'SUCCESS',
            paidAt: now,
            rawResponse: {
              method: BANK_TRANSFER_METHOD,
              confirmedBy: actorId || null,
              note: note || null,
              transferContent: buildTransferContent(booking.id),
              receivedAfterFulfillmentWindow: true,
            },
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'CANCELLED',
            refundRequired: true,
            cancelledAt: booking.cancelledAt || now,
            cancellationReason: booking.cancellationReason
              || 'Tiền chuyển khoản được ghi nhận sau khi đơn không còn khả năng phát vé.',
            cancellationSource: booking.cancellationSource || 'BANK_TRANSFER_AFTER_EXPIRY',
          },
        });
        const queuedRefund = await queueMandatoryRefund(tx, {
          ...booking,
          status: 'CANCELLED',
          refundRequired: true,
          payments: [payment],
        }, {
          type: 'SYSTEM_CANCELLATION',
          reason: 'Hệ thống đã nhận chuyển khoản sau khi hết thời hạn giữ chỗ hoặc vé ngừng bán. Hoàn lại 100% qua chuyển khoản ngân hàng.',
          now,
        });
        await writeAuditLog({
          client: tx,
          req,
          actorId,
          action: 'BANK_TRANSFER_RECEIVED_AFTER_EXPIRY',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: {
            bookingId: booking.id,
            paymentId: payment.id,
            refundRequestId: queuedRefund.refundRequest?.id || null,
            amount: Number(booking.totalAmount),
          },
        });
        return {
          alreadyConfirmed: false,
          latePayment: true,
          bookingStatus: 'CANCELLED',
          booking,
          refundRequestId: queuedRefund.refundRequest?.id || null,
        };
      }
      if (booking.status !== 'PENDING_PAYMENT') {
        throw httpError(
          409,
          `Đơn đang ở trạng thái ${booking.status} nên không thể xác nhận thanh toán. `
          + 'Nếu khách đã chuyển tiền, hãy hoàn tiền thủ công cho khách.',
        );
      }

      const reservation = booking.reservation;

      // Chốt kho giữ chỗ -> kho đã bán (dùng chung helper với luồng VNPay).
      await confirmReservationAndStock(tx, reservation);

      const needsApproval =
        reservation.ticketProduct?.attraction?.requiresManualApproval === true;
      let bookingStatus;

      if (needsApproval) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'PENDING_PARTNER' },
        });
        bookingStatus = 'PENDING_PARTNER';
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'CONFIRMED' },
        });
        await createTicketInstances(
          tx,
          booking.id,
          reservation.ticketProductId,
          reservation.quantity,
        );
        await awardPointsForBooking(tx, {
          id: booking.id,
          userId: booking.userId,
          totalAmount: booking.totalAmount,
          isForecastTrainingSample: booking.isForecastTrainingSample,
        });
        bookingStatus = 'CONFIRMED';
      }

      // Ghi nhận khoản thu. transactionId unique -> chống ghi nhận trùng.
      await tx.payment.upsert({
        where: { transactionId: `BT-${booking.id}` },
        update: {},
        create: {
          bookingId: booking.id,
          amount: booking.totalAmount,
          paymentGateway: 'BANK_TRANSFER',
          transactionId: `BT-${booking.id}`,
          status: 'SUCCESS',
          paidAt: now,
          rawResponse: {
            method: BANK_TRANSFER_METHOD,
            confirmedBy: actorId || null,
            note: note || null,
            transferContent: buildTransferContent(booking.id),
          },
        },
      });

      await writeAuditLog({
        client: tx,
        req,
        actorId,
        action: 'BANK_TRANSFER_CONFIRMED',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: {
          bookingId: booking.id,
          amount: Number(booking.totalAmount),
          transferContent: buildTransferContent(booking.id),
          resultingStatus: bookingStatus,
          note: note || null,
        },
      });

      return { alreadyConfirmed: false, bookingStatus, booking };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return result;
}

// Danh sách đơn chuyển khoản đang chờ Admin đối chiếu sao kê.
async function listPendingBankTransfers({ limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const bookings = await prisma.booking.findMany({
    where: {
      paymentMethod: BANK_TRANSFER_METHOD,
      status: 'PENDING_PAYMENT',
      isForecastTrainingSample: false,
    },
    orderBy: { createdAt: 'asc' },
    take,
    include: {
      reservation: {
        select: { expiresAt: true, status: true, date: true, quantity: true },
      },
    },
  });

  const now = new Date();
  return bookings.map((booking) => ({
    bookingId: booking.id,
    bookingReference: formatBookingReference(booking.id),
    transferContent: buildTransferContent(booking.id),
    customer: booking.fullName,
    email: booking.email,
    phone: booking.phone,
    amount: Number(booking.totalAmount),
    attraction: booking.snapshotAttractionTitle,
    ticketName: booking.snapshotTicketName,
    quantity: booking.reservation?.quantity ?? null,
    visitDate: booking.reservation?.date || booking.snapshotVisitDate,
    createdAt: booking.createdAt,
    holdExpiresAt: booking.reservation?.expiresAt || null,
    // Hết hạn giữ chỗ -> không xác nhận được nữa, phải hoàn tiền thủ công.
    holdExpired: booking.reservation
      ? booking.reservation.status !== 'HELD' || booking.reservation.expiresAt <= now
      : true,
  }));
}

module.exports = {
  BANK_TRANSFER_METHOD,
  buildTransferContent,
  buildTransferInstruction,
  confirmBankTransfer,
  getBankTransferHoldMs,
  getBankTransferHoldMinutes,
  isBankTransferAvailable,
  listPendingBankTransfers,
};
