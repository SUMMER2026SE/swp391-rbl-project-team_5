'use strict';

const prisma = require('../config/prisma');
const {
  queryVnpayTransaction,
  refundViaVnpay,
} = require('../controllers/paymentController');
const {
  REFUND_GATEWAY_OUTCOME,
  buildGatewayTransactionData,
  classifyVnpayReconciliationResult,
  classifyVnpayRefundResult,
  finalizeSuccessfulRefund,
  isLocalDemoPayment,
  toVndAmount,
} = require('../services/refundLifecycleService');
const { runWithJobLease } = require('./jobLease');
const {
  deliverRefundNotificationNow,
} = require('../services/refundNotificationService');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const RECONCILIATION_RETRY_MS = 5 * 60 * 1000;
const LEASE_TTL_MS = 5 * 60 * 1000;
const SERIALIZABLE_RETRY_LIMIT = 3;
const PAYMENT_BLOCKING_STATUSES = ['PROCESSING', 'NEEDS_RECONCILIATION'];

async function notifyRefundCompletion({
  refundRequestId,
  transactionId = null,
  amount = null,
} = {}) {
  if (!refundRequestId) return;
  try {
    await deliverRefundNotificationNow({
      refundRequestId,
      status: 'APPROVED',
      amount,
      refundTransactionId: transactionId,
    });
  } catch (error) {
    // The outbox row was committed with the financial transition and will be
    // retried with backoff by notificationOutboxWorker.
    console.error(`[refund-worker] Không thể phát thông báo hoàn tiền ${refundRequestId}:`, error.message);
  }
}

function isSerializableConflict(error) {
  return error?.code === 'P2034' || error?.code === '40001';
}

async function runSerializableTransaction(task) {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(task, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === SERIALIZABLE_RETRY_LIMIT) {
        throw error;
      }
    }
  }
  throw new Error('Không thể khóa giao dịch hoàn tiền.');
}

async function reopenRequestAfterFailure(tx, transaction, staffNotes) {
  if (!transaction.refundRequestId) return;
  await tx.refundRequest.updateMany({
    where: {
      id: transaction.refundRequestId,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    data: {
      status: 'PENDING',
      processedById: null,
      processingStartedAt: null,
      staffNotes,
    },
  });
}

async function recordPreflightFailure(tx, transaction, error, now = new Date()) {
  const failed = await tx.refundTransaction.updateMany({
    where: { id: transaction.id, status: 'PROCESSING' },
    data: {
      status: 'FAILED',
      rawResponse: { error: error.message },
      processedAt: now,
    },
  });
  if (failed.count !== 1) return false;
  await reopenRequestAfterFailure(
    tx,
    transaction,
    `Không thể gửi yêu cầu hoàn tiền: ${error.message}`,
  );
  return true;
}

async function lockRefundPayment(tx, paymentId) {
  if (!paymentId) return;
  // Every worker locks the same, single parent row before inspecting or
  // claiming refunds for a payment. This keeps the external gateway call out
  // of the DB transaction while still preventing concurrent claims.
  await tx.$queryRaw`
    SELECT "id"
    FROM "Payment"
    WHERE "id" = ${paymentId}
    FOR UPDATE
  `;
}

async function claimPendingRefundTransaction(transaction) {
  return runSerializableTransaction(async (tx) => {
    await lockRefundPayment(tx, transaction.paymentId);

    const paymentTransactions = transaction.paymentId
      ? await tx.refundTransaction.findMany({
        where: {
          paymentId: transaction.paymentId,
          status: {
            in: ['PENDING', 'PROCESSING', 'NEEDS_RECONCILIATION', 'SUCCESS'],
          },
        },
        select: {
          id: true,
          paymentId: true,
          refundRequestId: true,
          amount: true,
          status: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      : [transaction];
    const current = paymentTransactions.find((item) => item.id === transaction.id);
    if (!current || current.status !== 'PENDING') {
      return { state: 'SKIPPED' };
    }

    const oldestPending = paymentTransactions.find((item) => item.status === 'PENDING');
    if (oldestPending?.id !== transaction.id) {
      return { state: 'QUEUED' };
    }

    const hasAmbiguousRefund = paymentTransactions.some((item) => (
      item.id !== transaction.id
      && PAYMENT_BLOCKING_STATUSES.includes(item.status)
    ));
    if (hasAmbiguousRefund) {
      return { state: 'BLOCKED' };
    }

    const claimed = await tx.refundTransaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) {
      return { state: 'SKIPPED' };
    }

    const claimedTransaction = {
      ...transaction,
      ...current,
      status: 'PROCESSING',
    };
    try {
      if (!transaction.payment) {
        throw new Error('Không tìm thấy giao dịch thanh toán gốc.');
      }
      const requestedAmount = toVndAmount(current.amount, 'Số tiền hoàn');
      const capturedAmount = toVndAmount(
        transaction.payment.amount,
        'Số tiền thanh toán gốc',
      );
      const successfulAmount = paymentTransactions.reduce((total, item) => (
        item.status === 'SUCCESS'
          ? total + toVndAmount(item.amount, 'Số tiền giao dịch hoàn')
          : total
      ), 0);
      const availableAmount = Math.max(0, capturedAmount - successfulAmount);

      if (requestedAmount > availableAmount) {
        throw new Error(
          `Số tiền hoàn (${requestedAmount}) vượt quá số dư có thể hoàn (${availableAmount}) của giao dịch gốc.`,
        );
      }
    } catch (error) {
      await recordPreflightFailure(tx, claimedTransaction, error);
      return { state: 'FAILED', error };
    }

    return { state: 'CLAIMED', transaction: claimedTransaction };
  });
}

async function finalizeOrphanTransaction(tx, transaction, gatewayResult, now) {
  const finalized = await tx.refundTransaction.updateMany({
    where: {
      id: transaction.id,
      status: { in: ['PENDING', 'PROCESSING', 'NEEDS_RECONCILIATION'] },
    },
    data: {
      status: 'SUCCESS',
      // Reconciliation may already have persisted the signed gateway response.
      // Do not erase that evidence when only the local DB finalization is retried.
      ...(gatewayResult ? buildGatewayTransactionData(gatewayResult, now) : {}),
      processedAt: now,
      reconciledAt: now,
    },
  });
  if (finalized.count !== 1) return { transitioned: false };
  const remaining = await tx.refundTransaction.count({
    where: {
      bookingId: transaction.bookingId,
      id: { not: transaction.id },
      status: { in: ['PENDING', 'PROCESSING', 'NEEDS_RECONCILIATION'] },
    },
  });
  if (remaining === 0) {
    await tx.booking.update({
      where: { id: transaction.bookingId },
      data: { refundRequired: false },
    });
  }
  return { transitioned: true };
}

async function finalizeWorkerRefund(transaction, gatewayResult, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    if (!transaction.refundRequestId) {
      return finalizeOrphanTransaction(tx, transaction, gatewayResult, now);
    }
    return finalizeSuccessfulRefund(tx, {
      refundRequestId: transaction.refundRequestId,
      refundTransactionId: transaction.id,
      staffNotes: 'Hoàn tiền tự động đã được VNPay xác nhận.',
      gatewayResult,
      now,
    });
  });
}

async function markNeedsReconciliation(transaction, data = {}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const marked = await tx.refundTransaction.updateMany({
      where: { id: transaction.id, status: transaction.status },
      data: {
        status: 'NEEDS_RECONCILIATION',
        ...data,
        processedAt: now,
      },
    });
    if (marked.count !== 1) return false;
    if (transaction.refundRequestId) {
      await tx.refundRequest.updateMany({
        where: {
          id: transaction.refundRequestId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: {
          status: 'PROCESSING',
          processingStartedAt: now,
        },
      });
    }
    return true;
  });
}

async function markPreflightFailure(transaction, error) {
  await prisma.$transaction(async (tx) => {
    await recordPreflightFailure(tx, transaction, error);
  });
}

function buildWorkerReconciliationData(gatewayResult, error) {
  const gatewayData = gatewayResult
    ? buildGatewayTransactionData(gatewayResult)
    : { submittedAt: new Date() };
  return {
    ...gatewayData,
    rawResponse: {
      ...(gatewayData.rawResponse || {}),
      workerError: error.message,
    },
  };
}

function hasRecordedSuccessfulGatewayResponse(transaction) {
  return String(transaction?.gatewayResponseCode || '') === '00'
    && String(transaction?.gatewayTransactionStatus || '') === '00';
}

async function sweepPendingRefundTransactions({ limit = 20 } = {}) {
  const pending = await prisma.refundTransaction.findMany({
    where: { status: 'PENDING', gateway: 'VNPAY' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: { payment: true, refundRequest: true },
  });

  let processed = 0;
  for (const candidate of pending) {
    let transaction = candidate;
    let claimed = false;
    let gatewayResult = null;
    let gatewayResponseReceived = false;
    try {
      const claim = await claimPendingRefundTransaction(candidate);
      if (claim.state === 'FAILED') {
        console.error(`[refund-worker] Lỗi giao dịch ${candidate.id}:`, claim.error.message);
        continue;
      }
      if (claim.state !== 'CLAIMED') continue;

      transaction = claim.transaction;
      claimed = true;
      const amount = toVndAmount(transaction.amount, 'Số tiền hoàn');
      const capturedAmount = toVndAmount(transaction.payment.amount, 'Số tiền thanh toán gốc');

      const submittedAt = new Date();
      await prisma.refundTransaction.update({
        where: { id: transaction.id },
        data: { submittedAt },
      });
      const transactionType = transaction.transactionType
        || (amount >= capturedAmount ? '02' : '03');
      gatewayResult = isLocalDemoPayment(transaction.payment)
        ? {
          success: true,
          responseCode: '00',
          transactionStatus: '00',
          message: 'Giao dịch hoàn tiền demo thành công.',
          rawRequest: {
            vnp_RequestId: transaction.gatewayRequestId,
            vnp_TxnRef: transaction.payment.transactionId,
            vnp_Amount: amount * 100,
          },
          raw: {
            vnp_ResponseCode: '00',
            vnp_TransactionStatus: '00',
            vnp_TransactionNo: `DEMO${Date.now()}`,
          },
        }
        : await refundViaVnpay({
          payment: transaction.payment,
          amount,
          transactionType,
          createBy: 'refund-worker',
          ipAddr: '127.0.0.1',
          orderInfo: transaction.refundRequest?.type === 'DUPLICATE_PAYMENT'
            ? `Hoan tien giao dich trung don hang ${transaction.bookingId}`
            : `Hoan tien don hang ${transaction.bookingId}`,
          requestId: transaction.gatewayRequestId,
        });
      gatewayResponseReceived = true;
      const outcome = classifyVnpayRefundResult(gatewayResult);

      if (outcome === REFUND_GATEWAY_OUTCOME.SUCCESS) {
        await finalizeWorkerRefund(transaction, gatewayResult);
        await notifyRefundCompletion({
          refundRequestId: transaction.refundRequestId,
          transactionId: transaction.id,
          amount: transaction.amount,
        });
      } else if (outcome === REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION) {
        await markNeedsReconciliation(
          transaction,
          buildGatewayTransactionData(gatewayResult),
        );
      } else {
        await prisma.$transaction(async (tx) => {
          const failed = await tx.refundTransaction.updateMany({
            where: { id: transaction.id, status: transaction.status },
            data: {
              status: 'FAILED',
              ...buildGatewayTransactionData(gatewayResult),
              processedAt: new Date(),
            },
          });
          if (failed.count !== 1) return;
          await reopenRequestAfterFailure(
            tx,
            transaction,
            `VNPay từ chối hoàn tiền tự động: ${gatewayResult.responseCode || 'N/A'} ${gatewayResult.message || ''}`.trim(),
          );
        });
      }
      processed += 1;
    } catch (error) {
      if (gatewayResponseReceived || error.gatewayAttempted === true) {
        await markNeedsReconciliation(
          transaction,
          buildWorkerReconciliationData(gatewayResult, error),
        ).catch(() => {});
        if (gatewayResponseReceived) processed += 1;
      } else if (claimed) {
        await markPreflightFailure(transaction, error).catch(() => {});
      }
      console.error(`[refund-worker] Lỗi giao dịch ${transaction.id}:`, error.message);
    }
  }

  return processed;
}

async function sweepRefundReconciliations({ limit = 20, now = new Date() } = {}) {
  const retryBefore = new Date(now.getTime() - RECONCILIATION_RETRY_MS);
  const transactions = await prisma.refundTransaction.findMany({
    where: {
      status: { in: ['PROCESSING', 'NEEDS_RECONCILIATION'] },
      gateway: 'VNPAY',
      OR: [
        {
          status: 'PROCESSING',
          submittedAt: null,
          updatedAt: { lte: retryBefore },
        },
        {
          submittedAt: { lte: retryBefore },
          OR: [
            { reconciledAt: null },
            { reconciledAt: { lte: retryBefore } },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { payment: true, refundRequest: true },
  });

  let resolved = 0;
  for (const transaction of transactions) {
    if (!transaction.payment) continue;

    try {
      // PROCESSING without submittedAt means the worker stopped after the
      // atomic claim but before the request could be sent. Once the claim is
      // stale, returning it to PENDING is safe because no gateway attempt
      // could have happened without first persisting submittedAt.
      if (!transaction.submittedAt) {
        const releasedCount = await prisma.$transaction(async (tx) => {
          const released = await tx.refundTransaction.updateMany({
            where: {
              id: transaction.id,
              status: 'PROCESSING',
              submittedAt: null,
              updatedAt: { lte: retryBefore },
            },
            data: { status: 'PENDING' },
          });
          if (released.count === 1 && transaction.refundRequestId) {
            await tx.refundRequest.updateMany({
              where: {
                id: transaction.refundRequestId,
                status: 'PROCESSING',
              },
              data: {
                status: 'PENDING',
                processingStartedAt: null,
                staffNotes: 'Tác vụ tự động bị gián đoạn trước khi gửi tới cổng thanh toán và đã được xếp hàng lại an toàn.',
              },
            });
          }
          return released.count;
        });
        if (releasedCount === 1) resolved += 1;
        continue;
      }

      // A signed 00/00 refund response was already received, but the following
      // local transaction failed. Retrying the local finalization is safe and
      // avoids interpreting a query of the original payment as a second refund.
      if (hasRecordedSuccessfulGatewayResponse(transaction)) {
        await finalizeWorkerRefund(transaction, null, now);
        await notifyRefundCompletion({
          refundRequestId: transaction.refundRequestId,
          transactionId: transaction.id,
          amount: transaction.amount,
        });
        resolved += 1;
        continue;
      }

      const queryResult = await queryVnpayTransaction({
        payment: transaction.payment,
        ipAddr: '127.0.0.1',
        orderInfo: `Doi soat hoan tien don hang ${transaction.bookingId}`,
      });
      const outcome = classifyVnpayReconciliationResult(queryResult, transaction);
      const reconciliationGatewayTransactionId = String(
        queryResult.raw?.vnp_TransactionNo || '',
      ).trim();
      const reconciliationData = {
        gatewayResponseCode: queryResult.responseCode,
        gatewayTransactionStatus: queryResult.transactionStatus,
        // QueryDR responses can omit the refund transaction number. Never
        // erase a previously recorded gateway identity in that case.
        gatewayTransactionId: reconciliationGatewayTransactionId
          || transaction.gatewayTransactionId
          || null,
        rawResponse: {
          ...(transaction.rawResponse || {}),
          reconciliation: queryResult.raw,
        },
        reconciledAt: now,
      };

      if (outcome === REFUND_GATEWAY_OUTCOME.SUCCESS) {
        const transitioned = await prisma.$transaction(async (tx) => {
          const marked = await tx.refundTransaction.updateMany({
            where: { id: transaction.id, status: transaction.status },
            data: reconciliationData,
          });
          if (marked.count !== 1) return false;
          if (transaction.refundRequestId) {
            await finalizeSuccessfulRefund(tx, {
              refundRequestId: transaction.refundRequestId,
              refundTransactionId: transaction.id,
              staffNotes: 'Hoàn tiền tự động đã được xác nhận qua đối soát VNPay.',
              now,
            });
          } else {
            await finalizeOrphanTransaction(tx, transaction, null, now);
          }
          return true;
        });
        if (transitioned) {
          await notifyRefundCompletion({
            refundRequestId: transaction.refundRequestId,
            transactionId: transaction.id,
            amount: transaction.amount,
          });
          resolved += 1;
        }
      } else if (outcome === REFUND_GATEWAY_OUTCOME.FAILED) {
        await prisma.$transaction(async (tx) => {
          const failed = await tx.refundTransaction.updateMany({
            where: { id: transaction.id, status: transaction.status },
            data: {
              status: 'FAILED',
              ...reconciliationData,
              processedAt: now,
            },
          });
          if (failed.count !== 1) return;
          await reopenRequestAfterFailure(
            tx,
            transaction,
            'Đối soát xác nhận VNPay từ chối khoản hoàn. Cần kiểm tra trước khi thử lại.',
          );
        });
        resolved += 1;
      } else {
        await prisma.refundTransaction.updateMany({
          where: { id: transaction.id, status: transaction.status },
          data: reconciliationData,
        });
      }
    } catch (error) {
      await prisma.refundTransaction.updateMany({
        where: { id: transaction.id, status: transaction.status },
        data: { reconciledAt: now },
      }).catch(() => {});
      console.error(`[refund-worker] Lỗi đối soát ${transaction.id}:`, error.message);
    }
  }

  return resolved;
}

function startRefundWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false;
  const tick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await runWithJobLease('refund-reconciliation', LEASE_TTL_MS, async () => {
        await sweepPendingRefundTransactions();
        await sweepRefundReconciliations();
      });
    } catch (error) {
      console.error('[refund-worker] Lỗi vòng quét:', error.message);
    } finally {
      isRunning = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  void tick();
  return handle;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  RECONCILIATION_RETRY_MS,
  startRefundWorker,
  sweepPendingRefundTransactions,
  sweepRefundReconciliations,
};
