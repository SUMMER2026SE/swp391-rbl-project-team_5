'use strict';

const { releaseInventory } = require('../utils/refundService');
const { reversePointsForBooking } = require('./loyaltyService');
const {
  getRefundMode,
  isRefundableCapturedPayment,
} = require('../utils/paymentGateway');
const { enqueueRefundNotification } = require('./refundNotificationService');

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
  const returnedRequestId = String(
    result?.refundRequestId
      || result?.raw?.vnp_RequestId
      || result?.raw?.vnp_RefundRequestId
      || result?.raw?.vnp_RefundRequestID
      || '',
  ).trim();
  const expectedRequestId = String(refundTransaction?.gatewayRequestId || '').trim();
  const returnedGatewayTransactionId = String(
    result?.raw?.vnp_TransactionNo || '',
  ).trim();
  const returnedTransactionRef = String(
    result?.raw?.vnp_TxnRef
      || result?.raw?.vnp_TxnRefNo
      || '',
  ).trim();
  const expectedTransactionRef = String(
    refundTransaction?.payment?.transactionId || '',
  ).trim();
  const transactionRefCompatible = !returnedTransactionRef
    || Boolean(expectedTransactionRef && returnedTransactionRef === expectedTransactionRef);
  const priorGatewayTransactionId = String(
    refundTransaction?.gatewayTransactionId || '',
  ).trim();
  const hasExactIdentity = Boolean(
    (expectedRequestId && returnedRequestId && returnedRequestId === expectedRequestId)
      || (
        priorGatewayTransactionId
        && returnedGatewayTransactionId
        && returnedGatewayTransactionId === priorGatewayTransactionId
      ),
  );
  const matchesRefund = responseCode === '00'
    && ['02', '03'].includes(transactionType)
    && transactionType === expectedType
    && Number.isFinite(responseAmount)
    && responseAmount === expectedAmount
    && transactionRefCompatible
    && hasExactIdentity;

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
  return payments.find(isRefundableCapturedPayment) || null;
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
      blockReason: 'Không tìm thấy giao dịch thanh toán đã thu tiền để thực hiện hoàn tiền.',
    };
  }
  if (getRefundMode(payment) === 'MANUAL_BANK_TRANSFER') {
    return {
      canApprove: true,
      mode: 'MANUAL_BANK_TRANSFER',
      blockReason: null,
      requiresManualReference: true,
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

async function lockPaymentForRefund(tx, paymentId) {
  if (!paymentId || typeof tx?.$queryRaw !== 'function') return;
  await tx.$queryRaw`
    SELECT "id"
    FROM "Payment"
    WHERE "id" = ${paymentId}
    FOR UPDATE
  `;
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
  let lockedTransaction = null;
  let repairingSuccessfulTransaction = false;
  if (refundTransactionId && typeof tx.$queryRaw === 'function') {
    const rows = await tx.$queryRaw`
      SELECT "id", "status", "refundRequestId"
      FROM "RefundTransaction"
      WHERE "id" = ${refundTransactionId}
      FOR UPDATE
    `;
    lockedTransaction = rows?.[0] || null;
    if (!lockedTransaction) {
      throw httpError(404, 'KhÃ´ng tÃ¬m tháº¥y giao dá»‹ch hoÃ n tiá»n.');
    }
    // A second worker/manual reconciler may arrive after the first one has
    // committed. Treat SUCCESS as idempotent, but never let a stale caller
    // mutate a terminal FAILED/REJECTED row.
    if (lockedTransaction.status === 'SUCCESS') {
      const alreadyFinalized = await tx.refundRequest.findUnique({
        where: { id: refundRequestId },
      });
      // A gateway SUCCESS can be committed just before the local request/
      // booking finalization. Only short-circuit when both sides are already
      // terminal; otherwise continue through the idempotent finalization path
      // to repair the request and booking state.
      if (!alreadyFinalized) {
        throw httpError(404, 'KhÃ´ng tÃ¬m tháº¥y yÃªu cáº§u hoÃ n tiá»n.');
      }
      if (alreadyFinalized.status === 'APPROVED') {
        return alreadyFinalized;
      }
      if (['PENDING', 'PROCESSING'].includes(alreadyFinalized.status)) {
        repairingSuccessfulTransaction = true;
      }
    }
    if (
      lockedTransaction.status
      && !ACTIVE_TRANSACTION_STATUSES.has(lockedTransaction.status)
      && !repairingSuccessfulTransaction
    ) {
      throw httpError(409, 'Giao dá»‹ch hoÃ n tiá»n khÃ´ng cÃ²n á»Ÿ tráº¡ng thÃ¡i cÃ³ thá»ƒ hoÃ n táº¥t.');
    }
  }
  const refundRequest = await tx.refundRequest.findUnique({
    where: { id: refundRequestId },
    include: {
      booking: {
        include: {
          reservation: { include: { ticketProduct: true } },
          ticketInstances: { select: { id: true, status: true } },
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
          refundTransactions: {
            where: { status: 'SUCCESS' },
            select: { paymentId: true, amount: true, status: true },
          },
        },
      },
    },
  });

  if (!refundRequest) throw httpError(404, 'Không tìm thấy yêu cầu hoàn tiền.');
  if (
    refundRequest.status === 'APPROVED'
    && (!refundTransactionId || lockedTransaction?.status === 'SUCCESS' || lockedTransaction?.status == null)
  ) return refundRequest;
  if (!['PENDING', 'PROCESSING'].includes(refundRequest.status)) {
    throw httpError(409, 'Yêu cầu hoàn tiền không còn ở trạng thái có thể hoàn tất.');
  }

  const booking = refundRequest.booking;
  const requestKey = String(refundRequest.requestKey || '');
  const isRecoveryDifference = requestKey.startsWith('recovery-difference:');
  const recoveryCustomerBookingId = requestKey.startsWith('recovery-customer:')
    ? requestKey.slice('recovery-customer:'.length)
    : null;
  const recoveryCaseId = requestKey.startsWith('recovery-full:')
    ? requestKey.slice('recovery-full:'.length)
    : null;
  const directRecoveryBookingId = requestKey.startsWith('recovery-full-booking:')
    ? requestKey.slice('recovery-full-booking:'.length)
    : null;
  const isRecoveryFull = Boolean(recoveryCaseId || directRecoveryBookingId);
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
  } else if (isRecoveryDifference) {
    // This is a partial cash refund after the original booking value was
    // transferred to a confirmed replacement booking. The source booking
    // remains CANCELLED and its old QR remains EXPIRED; marking it REFUNDED
    // would incorrectly imply that the customer received the full amount.
    const hasOtherOutstanding = await hasOtherOutstandingMandatoryRefund(
      tx,
      booking.id,
      refundRequest.id,
    );
    await tx.booking.update({
      where: { id: booking.id },
      data: { refundRequired: hasOtherOutstanding },
    });
  } else if (recoveryCustomerBookingId) {
    const targetBookingId = refundRequest.targetBookingId || recoveryCustomerBookingId;
    const targetBooking = await tx.booking.findUnique({
      where: { id: targetBookingId },
      include: {
        reservation: { include: { ticketProduct: true } },
        ticketInstances: { select: { id: true, status: true } },
      },
    });
    if (!targetBooking) {
      throw httpError(409, 'Không tìm thấy vé thay thế thuộc yêu cầu hoàn tiền.');
    }
    if (targetBooking.ticketInstances.some((ticket) => ticket.status === 'USED')) {
      throw httpError(409, 'Không thể hoàn tiền cho đơn đã có vé được sử dụng.');
    }

    await releaseInventory(tx, targetBooking);
    await tx.ticketInstance.updateMany({
      where: {
        bookingId: targetBooking.id,
        status: { in: ['VALID', 'EXPIRED'] },
      },
      data: { status: 'REFUNDED' },
    });
    await tx.booking.update({
      where: { id: targetBooking.id },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    await reversePointsForBooking(tx, { id: targetBooking.id });

    const hasOtherOutstanding = await hasOtherOutstandingMandatoryRefund(
      tx,
      booking.id,
      refundRequest.id,
    );
    if (!hasOtherOutstanding) {
      await tx.ticketInstance.updateMany({
        where: {
          bookingId: booking.id,
          status: { in: ['VALID', 'EXPIRED'] },
        },
        data: { status: 'REFUNDED' },
      });
    }
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        ...(!hasOtherOutstanding ? { status: 'REFUNDED' } : {}),
        refundRequired: hasOtherOutstanding,
      },
    });
    await reversePointsForBooking(tx, { id: booking.id });
  } else if (isRecoveryFull) {
    const recoveryCase = recoveryCaseId && tx.recoveryCase?.findUnique
      ? await tx.recoveryCase.findUnique({
        where: { id: recoveryCaseId },
        select: { id: true, originalBookingId: true },
      })
      : null;
    const targetBookingId = refundRequest.targetBookingId
      || recoveryCase?.originalBookingId
      || directRecoveryBookingId;
    const targetBooking = targetBookingId === booking.id
      ? booking
      : await tx.booking.findUnique({
        where: { id: targetBookingId },
        include: {
          ticketInstances: { select: { id: true, status: true } },
        },
      });
    if (!targetBooking) {
      throw httpError(409, 'Không tìm thấy booking bị hủy thuộc yêu cầu Rescue.');
    }
    if (targetBooking.ticketInstances.some((ticket) => ticket.status === 'USED')) {
      throw httpError(409, 'Không thể hoàn tiền cho đơn đã có vé được sử dụng.');
    }

    const capturedPayment = (booking.payments || []).find(isRefundableCapturedPayment);
    if (!capturedPayment) {
      throw httpError(409, 'Không tìm thấy giao dịch thanh toán gốc của yêu cầu Rescue.');
    }
    const successfulAmount = (booking.refundTransactions || [])
      .filter((transaction) => transaction.paymentId === capturedPayment.id)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const totalRefundedAfterThisRequest = successfulAmount + Number(refundRequest.amount);
    const hasOtherOutstanding = await hasOtherOutstandingMandatoryRefund(
      tx,
      booking.id,
      refundRequest.id,
    );
    const sourceFullyRefunded = (
      totalRefundedAfterThisRequest >= Number(capturedPayment.amount)
      && !hasOtherOutstanding
    );

    await tx.ticketInstance.updateMany({
      where: {
        bookingId: targetBooking.id,
        status: { in: ['VALID', 'EXPIRED'] },
      },
      data: { status: 'REFUNDED' },
    });
    await tx.booking.update({
      where: { id: targetBooking.id },
      data: {
        status: targetBooking.id === booking.id && !sourceFullyRefunded
          ? targetBooking.status
          : 'REFUNDED',
        refundRequired: targetBooking.id === booking.id && !sourceFullyRefunded,
      },
    });
    if (targetBooking.id !== booking.id || sourceFullyRefunded) {
      await reversePointsForBooking(tx, { id: targetBooking.id });
    }

    if (targetBooking.id !== booking.id) {
      if (sourceFullyRefunded) {
        await tx.ticketInstance.updateMany({
          where: {
            bookingId: booking.id,
            status: { in: ['VALID', 'EXPIRED'] },
          },
          data: { status: 'REFUNDED' },
        });
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          ...(sourceFullyRefunded ? { status: 'REFUNDED' } : {}),
          refundRequired: !sourceFullyRefunded,
        },
      });
      if (sourceFullyRefunded) {
        await reversePointsForBooking(tx, { id: booking.id });
      }
    }
    if (recoveryCaseId && tx.recoveryCase?.updateMany) {
      await tx.recoveryCase.updateMany({
        where: { id: recoveryCaseId, status: 'REFUND_PENDING' },
        data: {
          status: 'REFUNDED',
          completedAt: now,
          version: { increment: 1 },
        },
      });
    }
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
    // Thu hồi điểm thưởng đã cộng cho đơn này (nếu có) khi hoàn tiền thành công.
    await reversePointsForBooking(tx, { id: booking.id });
    if (tx.recoveryCase?.updateMany) {
      await tx.recoveryCase.updateMany({
        where: {
          originalBookingId: booking.id,
          status: 'REFUND_PENDING',
        },
        data: {
          status: 'REFUNDED',
          completedAt: now,
          version: { increment: 1 },
        },
      });
    }
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

  await enqueueRefundNotification(tx, {
    refundRequestId: refundRequest.id,
    status: 'APPROVED',
    amount: refundRequest.amount,
    refundTransactionId,
  });

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
  lockPaymentForRefund,
  toVndAmount,
};
