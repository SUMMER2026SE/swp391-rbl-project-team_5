'use strict';

const { getBookingActivityWindow } = require('./activityTime');

// Múi giờ nghiệp vụ của hệ thống (Việt Nam, UTC+7).
const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_REFUND_WITH_FEE_RATE = 0.5;
const DEFAULT_REFUND_CUTOFF_HOURS = 24;

function normalizeRefundFeeRate(policy, value) {
  if (policy !== 'REFUND_WITH_FEE') return 0;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate < 1
    ? rate
    : DEFAULT_REFUND_WITH_FEE_RATE;
}

/**
 * Ngày hiện tại theo giờ Việt Nam ở dạng 'YYYY-MM-DD'.
 */
function todayInVietnam(now = new Date()) {
  return new Date(now.getTime() + VN_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Yêu cầu hoàn tiền chỉ hợp lệ khi gửi trước thời hạn đã snapshot trên booking.
 * Deadline được tính từ giờ bắt đầu hoạt động, theo chính sách của gói vé.
 *
 * @param {Object} booking Booking including reservation.
 * @returns {boolean}
 */
function isBeforeRefundCutoff(booking, now = new Date()) {
  const deadline = getRefundDeadline(booking);
  return Boolean(deadline && now < deadline);
}

function getRefundDeadline(booking) {
  const { startsAt } = getBookingActivityWindow(booking || {});
  if (!startsAt) return null;

  const configuredHours = Number(
    booking?.snapshotRefundCutoffHours
      ?? booking?.reservation?.ticketProduct?.refundCutoffHours
      ?? DEFAULT_REFUND_CUTOFF_HOURS,
  );
  const cutoffHours = Number.isFinite(configuredHours)
    ? Math.min(Math.max(configuredHours, 0), 720)
    : DEFAULT_REFUND_CUTOFF_HOURS;
  return new Date(startsAt.getTime() - cutoffHours * 60 * 60 * 1000);
}

/**
 * Calculate the refundable amount from the ticket product's refund policy.
 *
 * @param {Object} booking Booking including reservation.ticketProduct.
 * @returns {{ refundAmount: number, feeAmount: number, policyLabel: string }}
 */
function calculateRefundAmount(booking) {
  const parsedTotal = Number(booking?.totalAmount || 0);
  const totalAmount = Number.isFinite(parsedTotal) ? Math.max(0, Math.round(parsedTotal)) : 0;
  const ticketProduct = booking?.reservation?.ticketProduct;
  const snapshotPolicy = booking?.snapshotRefundPolicy;
  const snapshotFeeRate = booking?.snapshotRefundFeeRate;

  if (!ticketProduct && !snapshotPolicy) {
    return {
      refundAmount: 0,
      feeAmount: totalAmount,
      policyLabel: 'NON_REFUNDABLE',
    };
  }

  const policy = snapshotPolicy || ticketProduct.refundPolicy;
  const feeRate = normalizeRefundFeeRate(
    policy,
    snapshotFeeRate ?? ticketProduct?.refundFeeRate,
  );

  if (policy === 'FREE_CANCELLATION') {
    return {
      refundAmount: totalAmount,
      feeAmount: 0,
      policyLabel: 'FREE_CANCELLATION',
    };
  }

  if (policy === 'REFUND_WITH_FEE') {
    const feeAmount = Math.round(totalAmount * feeRate);
    return {
      refundAmount: Math.max(0, totalAmount - feeAmount),
      feeAmount,
      policyLabel: `REFUND_WITH_FEE (${feeRate * 100}% fee)`,
    };
  }

  return {
    refundAmount: 0,
    feeAmount: totalAmount,
    policyLabel: 'NON_REFUNDABLE',
  };
}

function getRefundEligibility(booking, now = new Date()) {
  const ticketProduct = booking?.reservation?.ticketProduct || {};
  const refundPolicy = booking?.snapshotRefundPolicy || ticketProduct.refundPolicy;
  const refundFeeRate = Number(
    booking?.snapshotRefundFeeRate ?? ticketProduct.refundFeeRate ?? 0,
  );
  const refundCutoffHours = Number(
    booking?.snapshotRefundCutoffHours
      ?? ticketProduct.refundCutoffHours
      ?? DEFAULT_REFUND_CUTOFF_HOURS,
  );
  const deadline = getRefundDeadline(booking);
  const customerRequest = (booking?.refundRequests || []).find((request) => (
    !request.type || request.type === 'CUSTOMER_CANCELLATION'
  ));
  const hasUsedTicket = (booking?.ticketInstances || []).some(
    (ticket) => ticket.status === 'USED',
  );
  const hasCapturedPayment = (booking?.payments || []).some((payment) => (
    payment.status === 'SUCCESS'
    && !payment.isDuplicate
    && /vnpay/i.test(payment.paymentGateway || '')
  ));
  const { refundAmount, feeAmount, policyLabel } = calculateRefundAmount(booking);

  let notRefundableReason = null;
  if (booking?.status !== 'CONFIRMED') {
    notRefundableReason = 'Chỉ đơn đã xác nhận mới có thể yêu cầu hoàn tiền.';
  } else if (!hasCapturedPayment) {
    notRefundableReason = 'Đơn chưa có giao dịch VNPay thành công để hoàn tiền về phương thức gốc.';
  } else if (hasUsedTicket) {
    notRefundableReason = 'Đơn đã có vé được sử dụng nên không thể yêu cầu hoàn tiền.';
  } else if (refundPolicy === 'NON_REFUNDABLE' || refundAmount <= 0) {
    notRefundableReason = 'Vé này không áp dụng chính sách hoàn tiền.';
  } else if (customerRequest) {
    notRefundableReason = 'Đơn này đã có yêu cầu hoàn tiền của khách hàng trước đó.';
  } else if (!deadline || now >= deadline) {
    notRefundableReason = 'Đã quá thời hạn hủy theo chính sách của gói vé.';
  }

  return {
    refundable: notRefundableReason === null,
    notRefundableReason,
    refundPolicy,
    refundFeeRate,
    refundCutoffHours,
    refundDeadline: deadline,
    refundAmount,
    feeAmount,
    policyLabel,
    customerRequest,
  };
}

/**
 * Return confirmed inventory for a cancelled booking.
 * This function must run inside a Prisma transaction.
 *
 * @param {Object} tx Prisma transaction client.
 * @param {Object} booking Booking including reservation.
 */
async function releaseInventory(tx, booking) {
  const reservation = booking?.reservation;
  if (!reservation || reservation.status !== 'CONFIRMED') return;

  const { ticketProductId, timeSlotId, date, quantity } = reservation;

  const dailyStock = await tx.dailyStock.updateMany({
    where: {
      ticketProductId,
      date,
      bookedQuantity: { gte: quantity },
    },
    data: { bookedQuantity: { decrement: quantity } },
  });

  if (dailyStock.count !== 1) {
    const error = new Error('Không thể hoàn trả kho vé theo ngày.');
    error.statusCode = 409;
    throw error;
  }

  const attractionId = reservation.ticketProduct?.attractionId
    || (await tx.ticketProduct.findUnique({
      where: { id: ticketProductId },
      select: { attractionId: true },
    }))?.attractionId;
  const attractionStock = attractionId
    ? await tx.attractionDailyStock.updateMany({
        where: {
          attractionId,
          date,
          bookedQty: { gte: quantity },
        },
        data: { bookedQty: { decrement: quantity } },
      })
    : { count: 0 };

  if (attractionStock.count !== 1) {
    const error = new Error('Không thể hoàn trả kho của điểm tham quan.');
    error.statusCode = 409;
    throw error;
  }

  if (timeSlotId) {
    const timeSlotStock = await tx.timeSlotStock.updateMany({
      where: {
        timeSlotId,
        date,
        bookedQty: { gte: quantity },
      },
      data: { bookedQty: { decrement: quantity } },
    });

    if (timeSlotStock.count !== 1) {
      const error = new Error('Không thể hoàn trả kho vé theo khung giờ.');
      error.statusCode = 409;
      throw error;
    }
  }

  await tx.reservation.update({
    where: { id: reservation.id },
    data: { status: 'CANCELLED' },
  });
}

/**
 * Return inventory that is still held by an unpaid reservation.
 * The reservation claim and all stock changes are expected to run in one transaction.
 */
async function releaseHeldInventory(tx, reservation, { status = 'CANCELLED' } = {}) {
  if (!reservation || reservation.status !== 'HELD') return false;
  if (!['CANCELLED', 'EXPIRED'].includes(status)) {
    throw new Error(`Unsupported held reservation release status: ${status}`);
  }

  const claimed = await tx.reservation.updateMany({
    where: { id: reservation.id, status: 'HELD' },
    data: { status },
  });
  if (claimed.count !== 1) return false;

  const { ticketProductId, timeSlotId, date, quantity } = reservation;
  const dailyStock = await tx.dailyStock.updateMany({
    where: { ticketProductId, date, heldQuantity: { gte: quantity } },
    data: { heldQuantity: { decrement: quantity } },
  });
  if (dailyStock.count !== 1) {
    const error = new Error('Không thể hoàn trả kho vé đang giữ theo ngày.');
    error.statusCode = 409;
    throw error;
  }

  const attractionId = reservation.ticketProduct?.attractionId
    || (await tx.ticketProduct.findUnique({
      where: { id: ticketProductId },
      select: { attractionId: true },
    }))?.attractionId;
  const attractionStock = attractionId
    ? await tx.attractionDailyStock.updateMany({
        where: { attractionId, date, heldQty: { gte: quantity } },
        data: { heldQty: { decrement: quantity } },
      })
    : { count: 0 };
  if (attractionStock.count !== 1) {
    const error = new Error('Không thể hoàn trả kho đang giữ của điểm tham quan.');
    error.statusCode = 409;
    throw error;
  }

  if (timeSlotId) {
    const timeSlotStock = await tx.timeSlotStock.updateMany({
      where: { timeSlotId, date, heldQty: { gte: quantity } },
      data: { heldQty: { decrement: quantity } },
    });
    if (timeSlotStock.count !== 1) {
      const error = new Error('Không thể hoàn trả kho vé đang giữ theo khung giờ.');
      error.statusCode = 409;
      throw error;
    }
  }

  return true;
}

module.exports = {
  DEFAULT_REFUND_CUTOFF_HOURS,
  DEFAULT_REFUND_WITH_FEE_RATE,
  calculateRefundAmount,
  getRefundDeadline,
  getRefundEligibility,
  normalizeRefundFeeRate,
  releaseHeldInventory,
  releaseInventory,
  isBeforeRefundCutoff,
  todayInVietnam,
};
