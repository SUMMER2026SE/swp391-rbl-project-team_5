'use strict';

const prisma = require('../config/prisma');
const { refundViaVnpay } = require('../controllers/paymentController');
const { runWithJobLease } = require('./jobLease');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const LEASE_TTL_MS = 5 * 60 * 1000;

async function sweepPendingRefundTransactions({ limit = 20 } = {}) {
  const pending = await prisma.refundTransaction.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { payment: true },
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
      const result = await refundViaVnpay({
        payment: transaction.payment,
        amount: Number(transaction.amount),
        transactionType: transaction.transactionType || '02',
        createBy: 'refund-worker',
        ipAddr: '127.0.0.1',
        orderInfo: `Hoan tien trung booking ${transaction.bookingId}`,
        requestId: transaction.gatewayRequestId,
      });

      await prisma.$transaction(async (tx) => {
        await tx.refundTransaction.update({
          where: { id: transaction.id },
          data: {
            status: result.success ? 'SUCCESS' : 'FAILED',
            rawResponse: result.raw,
            processedAt: new Date(),
          },
        });
        if (result.success) {
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
      });
      processed += 1;
    } catch (error) {
      await prisma.refundTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'NEEDS_RECONCILIATION',
          rawResponse: { error: error.message },
          processedAt: new Date(),
        },
      }).catch(() => {});
      console.error(`[refund-worker] Lỗi giao dịch ${transaction.id}:`, error.message);
    }
  }

  return processed;
}

function startRefundWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false;
  const tick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await runWithJobLease('refund-reconciliation', LEASE_TTL_MS, () =>
        sweepPendingRefundTransactions(),
      );
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
  startRefundWorker,
  sweepPendingRefundTransactions,
};
