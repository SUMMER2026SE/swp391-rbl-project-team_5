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
  toVndAmount,
} = require('../services/refundLifecycleService');
const { runWithJobLease } = require('./jobLease');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const RECONCILIATION_RETRY_MS = 5 * 60 * 1000;
const LEASE_TTL_MS = 5 * 60 * 1000;

async function reopenRequestAfterFailure(tx, transaction, staffNotes) {
  if (!transaction.refundRequestId) return;
  await tx.refundRequest.update({
    where: { id: transaction.refundRequestId },
    data: {
      status: 'PENDING',
      processedById: null,
      processingStartedAt: null,
      staffNotes,
    },
  });
}

async function finalizeOrphanTransaction(tx, transaction, gatewayResult, now) {
  await tx.refundTransaction.update({
    where: { id: transaction.id },
    data: {
      status: 'SUCCESS',
      ...buildGatewayTransactionData(gatewayResult, now),
      processedAt: now,
      reconciledAt: now,
    },
  });
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
  await prisma.$transaction(async (tx) => {
    await tx.refundTransaction.update({
      where: { id: transaction.id },
      data: {
        status: 'NEEDS_RECONCILIATION',
        ...data,
        processedAt: now,
      },
    });
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
  });
}

async function markPreflightFailure(transaction, error) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.refundTransaction.update({
      where: { id: transaction.id },
      data: {
        status: 'FAILED',
        rawResponse: { error: error.message },
        processedAt: now,
      },
    });
    await reopenRequestAfterFailure(
      tx,
      transaction,
      `Không thể gửi yêu cầu hoàn tiền: ${error.message}`,
    );
  });
}

async function sweepPendingRefundTransactions({ limit = 20 } = {}) {
  const pending = await prisma.refundTransaction.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { payment: true, refundRequest: true },
  });

  let processed = 0;
  for (const transaction of pending) {
    const claimed = await prisma.refundTransaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) continue;

    try {
      if (!transaction.payment) {
        throw new Error('Không tìm thấy giao dịch thanh toán gốc.');
      }
      const amount = toVndAmount(transaction.amount, 'Số tiền hoàn');
      const capturedAmount = toVndAmount(transaction.payment.amount, 'Số tiền thanh toán gốc');
      if (amount > capturedAmount) {
        throw new Error('Số tiền hoàn vượt quá giao dịch thanh toán gốc.');
      }

      const submittedAt = new Date();
      await prisma.refundTransaction.update({
        where: { id: transaction.id },
        data: { submittedAt },
      });
      const gatewayResult = await refundViaVnpay({
        payment: transaction.payment,
        amount,
        transactionType: transaction.transactionType || (amount >= capturedAmount ? '02' : '03'),
        createBy: 'refund-worker',
        ipAddr: '127.0.0.1',
        orderInfo: transaction.refundRequest?.type === 'DUPLICATE_PAYMENT'
          ? `Hoan tien giao dich trung don hang ${transaction.bookingId}`
          : `Hoan tien don hang ${transaction.bookingId}`,
        requestId: transaction.gatewayRequestId,
      });
      const outcome = classifyVnpayRefundResult(gatewayResult);

      if (outcome === REFUND_GATEWAY_OUTCOME.SUCCESS) {
        await finalizeWorkerRefund(transaction, gatewayResult);
      } else if (outcome === REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION) {
        await markNeedsReconciliation(
          transaction,
          buildGatewayTransactionData(gatewayResult),
        );
      } else {
        await prisma.$transaction(async (tx) => {
          await tx.refundTransaction.update({
            where: { id: transaction.id },
            data: {
              status: 'FAILED',
              ...buildGatewayTransactionData(gatewayResult),
              processedAt: new Date(),
            },
          });
          await reopenRequestAfterFailure(
            tx,
            transaction,
            `VNPay từ chối hoàn tiền tự động: ${gatewayResult.responseCode || 'N/A'} ${gatewayResult.message || ''}`.trim(),
          );
        });
      }
      processed += 1;
    } catch (error) {
      if (error.gatewayAttempted === true) {
        await markNeedsReconciliation(transaction, {
          rawResponse: { error: error.message },
          submittedAt: new Date(),
        }).catch(() => {});
      } else {
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
      submittedAt: { lte: retryBefore },
      AND: [
        {
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
      const queryResult = await queryVnpayTransaction({
        payment: transaction.payment,
        ipAddr: '127.0.0.1',
        orderInfo: `Doi soat hoan tien don hang ${transaction.bookingId}`,
      });
      const outcome = classifyVnpayReconciliationResult(queryResult, transaction);
      const reconciliationData = {
        gatewayResponseCode: queryResult.responseCode,
        gatewayTransactionStatus: queryResult.transactionStatus,
        gatewayTransactionId: String(queryResult.raw?.vnp_TransactionNo || '') || null,
        rawResponse: {
          ...(transaction.rawResponse || {}),
          reconciliation: queryResult.raw,
        },
        reconciledAt: now,
      };

      if (outcome === REFUND_GATEWAY_OUTCOME.SUCCESS) {
        await prisma.$transaction(async (tx) => {
          await tx.refundTransaction.update({
            where: { id: transaction.id },
            data: reconciliationData,
          });
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
        });
        resolved += 1;
      } else if (outcome === REFUND_GATEWAY_OUTCOME.FAILED) {
        await prisma.$transaction(async (tx) => {
          await tx.refundTransaction.update({
            where: { id: transaction.id },
            data: {
              status: 'FAILED',
              ...reconciliationData,
              processedAt: now,
            },
          });
          await reopenRequestAfterFailure(
            tx,
            transaction,
            'Đối soát xác nhận VNPay từ chối khoản hoàn. Cần kiểm tra trước khi thử lại.',
          );
        });
        resolved += 1;
      } else {
        await prisma.refundTransaction.update({
          where: { id: transaction.id },
          data: reconciliationData,
        });
      }
    } catch (error) {
      await prisma.refundTransaction.update({
        where: { id: transaction.id },
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
