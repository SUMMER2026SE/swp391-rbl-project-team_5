'use strict';

const {
  releaseHeldInventory,
  releaseInventory,
} = require('../utils/refundService');
const {
  getCapturedPayment,
  queueMandatoryRefund,
} = require('./mandatoryRefundService');
const { releaseVoucherRedemption } = require('./voucherRedemptionService');

/**
 * Cancel a paid booking that is still waiting for partner approval.
 * The caller must run this helper inside the same transaction that re-read
 * the booking state, otherwise approval and cancellation could both win.
 */
async function cancelPendingPartnerBooking(
  tx,
  booking,
  {
    now = new Date(),
    reason,
    cancellationSource,
    refundType = 'SYSTEM_CANCELLATION',
  },
) {
  if (!booking || booking.status !== 'PENDING_PARTNER') return false;
  const capturedPayment = getCapturedPayment(booking);
  if (!capturedPayment) {
    const error = new Error(
      'Đơn chờ duyệt không có giao dịch đã thu tiền hợp lệ để tạo hoàn tiền bắt buộc.',
    );
    error.statusCode = 409;
    throw error;
  }

  const claimed = await tx.booking.updateMany({
    where: {
      id: booking.id,
      status: 'PENDING_PARTNER',
      isForecastTrainingSample: false,
    },
    data: {
      status: 'CANCELLED',
      refundRequired: true,
      cancelledAt: now,
      cancellationReason: reason,
      cancellationSource,
    },
  });
  if (claimed.count !== 1) return false;

  if (booking.reservation?.status === 'CONFIRMED') {
    await releaseInventory(tx, booking);
  } else if (booking.reservation?.status === 'HELD') {
    const released = await releaseHeldInventory(
      tx,
      booking.reservation,
      { status: 'CANCELLED' },
    );
    if (!released) {
      const error = new Error('Không thể giải phóng lượt giữ chỗ của đơn bị hủy.');
      error.statusCode = 409;
      throw error;
    }
  } else {
    const error = new Error(
      `Trạng thái giữ chỗ ${booking.reservation?.status || 'UNKNOWN'} không thể hủy an toàn.`,
    );
    error.statusCode = 409;
    throw error;
  }

  if (booking.voucherId) {
    await releaseVoucherRedemption(tx, {
      bookingId: booking.id,
      voucherId: booking.voucherId,
      now,
    });
  }

  const queuedRefund = await queueMandatoryRefund(tx, booking, {
    type: refundType,
    reason,
    now,
  });
  if (!queuedRefund?.refundRequest) {
    throw new Error(
      'Không thể tạo yêu cầu hoàn tiền bắt buộc cho đơn bị chặn vận hành.',
    );
  }

  return true;
}

module.exports = {
  cancelPendingPartnerBooking,
};
