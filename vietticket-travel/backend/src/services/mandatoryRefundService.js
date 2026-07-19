'use strict';

const { toVndAmount } = require('./refundLifecycleService');
const { createVnpRequestId } = require('../utils/vnpay');

function getCapturedPayment(booking) {
  return (booking?.payments || []).find((payment) => (
    payment.status === 'SUCCESS'
    && !payment.isDuplicate
    && /vnpay/i.test(payment.paymentGateway || '')
  )) || null;
}

async function queueMandatoryRefund(
  tx,
  booking,
  { reason, type = 'SYSTEM_CANCELLATION', now = new Date() },
) {
  const payment = getCapturedPayment(booking);
  if (!payment) return { queued: false, refundRequest: null, refundTransaction: null };

  const capturedAmount = toVndAmount(payment.amount, 'Số tiền thanh toán gốc');
  const bookingAmount = toVndAmount(booking.totalAmount, 'Tổng tiền booking');
  const refundAmount = Math.min(capturedAmount, bookingAmount);
  const requestKey = `mandatory:${type}:${booking.id}`;
  const refundRequest = await tx.refundRequest.upsert({
    where: { requestKey },
    update: {},
    create: {
      bookingId: booking.id,
      requestKey,
      requestedById: booking.userId,
      type,
      mandatory: true,
      reason,
      originalAmount: capturedAmount,
      amount: refundAmount,
      feeAmount: 0,
      policySnapshot: booking.snapshotRefundPolicy || null,
      feeRateSnapshot: 0,
      bookingStatusBeforeRequest: booking.status,
      status: 'PROCESSING',
      processingStartedAt: now,
    },
  });

  const existingTransaction = await tx.refundTransaction.findFirst({
    where: {
      refundRequestId: refundRequest.id,
      status: { in: ['PENDING', 'PROCESSING', 'SUCCESS', 'NEEDS_RECONCILIATION'] },
    },
  });
  if (existingTransaction) {
    return {
      queued: existingTransaction.status === 'PENDING',
      refundRequest,
      refundTransaction: existingTransaction,
    };
  }

  const refundTransaction = await tx.refundTransaction.create({
    data: {
      bookingId: booking.id,
      paymentId: payment.id,
      refundRequestId: refundRequest.id,
      gateway: 'VNPAY',
      gatewayRequestId: createVnpRequestId(),
      transactionType: refundAmount >= capturedAmount ? '02' : '03',
      amount: refundAmount,
      status: 'PENDING',
      reason,
    },
  });

  return { queued: true, refundRequest, refundTransaction };
}

module.exports = {
  getCapturedPayment,
  queueMandatoryRefund,
};
