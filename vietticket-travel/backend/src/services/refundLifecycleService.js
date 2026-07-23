'use strict';

const { releaseInventory } = require('../utils/refundService');

const REFUND_GATEWAY_OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING_RECONCILIATION: 'PENDING_RECONCILIATION',
  FAILED: 'FAILED',
});

const MANDATORY_REFUND_TYPES = new Set([
  'PARTNER_CANCELLATION',
  'SYSTEM_CANCELLATION',
  'DUPLICATE_PAYMENT',
]);

const ACTIVE_TRANSACTION_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'NEEDS_RECONCILIATION',
]);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toVndAmount(value, fieldName = 'Số tiền') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw httpError(422, `${fieldName} phải là số nguyên VND lớn hơn 0.`);
  }
  return amount;
}

function isMandatoryRefundRequest(refundRequest) {
  return refundRequest?.mandatory === true
    || MANDATORY_REFUND_TYPES.has(refundRequest?.type);
}

function classifyVnpayRefundResult(result) {
  const raw = result?.raw || {};
  const responseCode = String(result?.responseCode ?? raw.vnp_ResponseCode ?? '');
  const transactionStatus = String(
    result?.transactionStatus ?? raw.vnp_TransactionStatus ?? '',
  );

  if (responseCode === '00' && transactionStatus === '00') {
    return REFUND_GATEWAY_OUTCOME.SUCCESS;
  }

  const definiteFailure = (
    ['02', '03', '91', '95', '97'].includes(responseCode)
    || (responseCode === '00' && ['02', '07', '09'].includes(transactionStatus))
  );
  if (definiteFailure) {
    return REFUND_GATEWAY_OUTCOME.FAILED;
  }

  if (
    responseCode === '94'
    || responseCode === '99'
    || (responseCode === '00' && ['', '01', '04', '05', '06'].includes(transactionStatus))
  ) {
    return REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION;
  }

  // Mã mới/không tài liệu hóa không đủ an toàn để tự gửi lại refund.
  return REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION;
}

function classifyVnpayReconciliationResult(result, refundTransaction) {
  const responseCode = String(result?.responseCode || '');
  const transactionStatus = String(result?.transactionStatus || '');
  const transactionType = String(result?.transactionType || '');
  const expectedType = String(refundTransaction?.transactionType || '');
  const responseAmount = Number(result?.amount);
  const expectedAmount = Number(refundTransaction?.amount);
  const matchesRefund = responseCode === '00'
    && ['02', '03'].includes(transactionType)
    && transactionType === expectedType
    && Number.isFinite(responseAmount)
    && responseAmount === expectedAmount;

  if (matchesRefund && transactionStatus === '00') {
    return REFUND_GATEWAY_OUTCOME.SUCCESS;
  }
  if (matchesRefund && ['02', '07', '09'].includes(transactionStatus)) {
    return REFUND_GATEWAY_OUTCOME.FAILED;
  }
  return REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION;
}

function findRefundTargetPayment(refundRequest) {
  const transactions = Array.isArray(refundRequest?.refundTransactions)
    ? refundRequest.refundTransactions
    : [];

  if (refundRequest?.type === 'DUPLICATE_PAYMENT') {
    return transactions.find((transaction) => transaction.payment?.isDuplicate)?.payment || null;
  }

  const payments = Array.isArray(refundRequest?.booking?.payments)
    ? refundRequest.booking.payments
    : [];
  return payments.find((payment) => (
    payment.status === 'SUCCESS'
    && !payment.isDuplicate
    && /vnpay/i.test(payment.paymentGateway || '')
  )) || null;
}

function isLocalDemoPayment(payment) {
  const raw = payment?.rawResponse;
  return process.env.NODE_ENV !== 'production'
    && raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && ['defense_demo_fixture', 'operational_fixture_v2'].includes(raw.source);
}

function getRefundProcessingEligibility(payment) {
  if (!payment) {
    return {
      canApprove: false,
      mode: 'BLOCKED',
      blockReason: 'Không tìm thấy giao dịch VNPay đã thu tiền để thực hiện hoàn tiền.',
    };
  }
  if (isLocalDemoPayment(payment)) {
    return { canApprove: true, mode: 'LOCAL_DEMO', blockReason: null };
  }

  const raw = payment.rawResponse && typeof payment.rawResponse === 'object'
    ? payment.rawResponse
    : {};
  const hasTransactionNo = Boolean(String(raw.vnp_TransactionNo || '').trim());
  const hasCreateDate = /^\d{14}$/.test(String(raw.vnp_CreateDate || '').trim());
  if (!payment.transactionId || !hasTransactionNo || !hasCreateDate) {
    return {
      canApprove: false,
      mode: 'BLOCKED',
      blockReason: 'Thiếu dữ liệu giao dịch VNPay gốc. Cần đối soát thanh toán trước khi phê duyệt hoàn tiền.',
    };
  }
  return { canApprove: true, mode: 'VNPAY', blockReason: null };
}

function getPaymentRefundBalance({ payment, transactions = [], currentRefundRequestId }) {
  const capturedAmount = toVndAmount(payment?.amount, 'Số tiền thanh toán gốc');
  let successfulAmount = 0;
  const ambiguousTransactions = [];

  for (const transaction of transactions) {
    if (transaction.paymentId !== payment.id) continue;
    if (transaction.refundRequestId === currentRefundRequestId) continue;

    if (transaction.status === 'SUCCESS') {
      successfulAmount += toVndAmount(transaction.amount, 'Số tiền giao dịch hoàn');
    } else if (ACTIVE_TRANSACTION_STATUSES.has(transaction.status)) {
      ambiguousTransactions.push(transaction);
    }
  }

  return {
    capturedAmount,
    successfulAmount,
    availableAmount: Math.max(0, capturedAmount - successfulAmount),
    ambiguousTransactions,
  };
}

function assertRefundCanBeSubmitted({ refundRequest, payment, transactions = [] }) {
  const requestedAmount = toVndAmount(refundRequest?.amount, 'Số tiền yêu cầu hoàn');
  const balance = getPaymentRefundBalance({
    payment,
    transactions,
    currentRefundRequestId: refundRequest.id,
  });

  if (balance.ambiguousTransactions.length > 0) {
    throw httpError(
      409,
      'Giao dịch thanh toán này đang có khoản hoàn chưa xác định kết quả. Cần đối soát trước khi gửi yêu cầu mới.',
    );
  }
  if (requestedAmount > balance.availableAmount) {
    throw httpError(
      409,
      `Số tiền yêu cầu hoàn (${requestedAmount}) vượt quá số dư có thể hoàn (${balance.availableAmount}).`,
    );
  }

  return { ...balance, requestedAmount };
}

function buildGatewayTransactionData(result, now = new Date()) {
  const raw = result?.raw || {};
  return {
    rawRequest: result?.rawRequest,
    rawResponse: raw,
    gatewayResponseCode: String(result?.responseCode ?? raw.vnp_ResponseCode ?? '') || null,
    gatewayTransactionStatus:
      String(result?.transactionStatus ?? raw.vnp_TransactionStatus ?? '') || null,
    gatewayTransactionId: String(raw.vnp_TransactionNo || '') || null,
    submittedAt: now,
  };
}

async function hasOtherOutstandingMandatoryRefund(tx, bookingId, refundRequestId) {
  const remaining = await tx.refundRequest.count({
    where: {
      bookingId,
      id: { not: refundRequestId },
      mandatory: true,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
  });
  return remaining > 0;
}

async function finalizeSuccessfulRefund(
  tx,
  {
    refundRequestId,
    refundTransactionId = null,
    processedById = null,
    staffNotes = null,
    gatewayResult = null,
    now = new Date(),
  },
) {
  const refundRequest = await tx.refundRequest.findUnique({
    where: { id: refundRequestId },
    include: {
      booking: {
        include: {
          reservation: { include: { ticketProduct: true } },
          ticketInstances: { select: { id: true, status: true } },
        },
      },
    },
  });

  if (!refundRequest) throw httpError(404, 'Không tìm thấy yêu cầu hoàn tiền.');
  if (refundRequest.status === 'APPROVED') return refundRequest;
  if (!['PENDING', 'PROCESSING'].includes(refundRequest.status)) {
    throw httpError(409, 'Yêu cầu hoàn tiền không còn ở trạng thái có thể hoàn tất.');
  }

  const booking = refundRequest.booking;
  if (refundRequest.type === 'DUPLICATE_PAYMENT') {
    const hasOtherOutstanding = await hasOtherOutstandingMandatoryRefund(
      tx,
      booking.id,
      refundRequest.id,
    );
    await tx.booking.update({
      where: { id: booking.id },
      data: { refundRequired: hasOtherOutstanding },
    });
  } else {
    if (booking.ticketInstances.some((ticket) => ticket.status === 'USED')) {
      throw httpError(409, 'Không thể hoàn tiền cho đơn đã có vé được sử dụng.');
    }

    await releaseInventory(tx, booking);
    await tx.ticketInstance.updateMany({
      where: {
        bookingId: booking.id,
        status: { in: ['VALID', 'EXPIRED'] },
      },
      data: { status: 'REFUNDED' },
    });
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'REFUNDED', refundRequired: false },
    });
  }

  const updated = await tx.refundRequest.update({
    where: { id: refundRequest.id },
    data: {
      status: 'APPROVED',
      staffNotes,
      processedById,
      processedAt: now,
      processingStartedAt: null,
    },
  });

  if (refundTransactionId) {
    await tx.refundTransaction.update({
      where: { id: refundTransactionId },
      data: {
        status: 'SUCCESS',
        ...(gatewayResult ? buildGatewayTransactionData(gatewayResult, now) : {}),
        processedById,
        processedAt: now,
        reconciledAt: now,
      },
    });
  }

  return updated;
}

module.exports = {
  ACTIVE_TRANSACTION_STATUSES,
  REFUND_GATEWAY_OUTCOME,
  assertRefundCanBeSubmitted,
  buildGatewayTransactionData,
  classifyVnpayRefundResult,
  classifyVnpayReconciliationResult,
  finalizeSuccessfulRefund,
  findRefundTargetPayment,
  getRefundProcessingEligibility,
  getPaymentRefundBalance,
  httpError,
  isMandatoryRefundRequest,
  isLocalDemoPayment,
  toVndAmount,
};
