'use strict';

const prisma = require('../config/prisma');
const { emitRecoveryCaseEvent } = require('../realtime/events');
const { expireRecoveryCase } = require('../services/recoveryService');
const { acquireJobLock, releaseJobLock, INSTANCE_ID } = require('./cleanupWorker');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const JOB_NAME = 'expire_recovery_cases';

async function sweepRecoveryDeadlines({ now = new Date(), limit = 100 } = {}) {
  const candidates = await prisma.recoveryCase.findMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let expiredCount = 0;
  for (const candidate of candidates) {
    try {
      const expired = await expireRecoveryCase(candidate.id, { now });
      if (!expired) continue;
      expiredCount += 1;
      emitRecoveryCaseEvent({
        customerId: expired.userId,
        recoveryCaseId: expired.id,
        status: 'REFUND_PENDING',
        message: 'Đã hết thời gian chọn vé thay thế. Hoàn tiền 100% đang được xử lý.',
        originalBookingId: expired.originalBookingId,
      });
    } catch (error) {
      console.error(`[Rescue] Không thể hết hạn case ${candidate.id}:`, error.message);
    }
  }
  return expiredCount;
}

function startRecoveryWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    let acquired = false;
    try {
      acquired = await acquireJobLock(JOB_NAME, intervalMs * 2);
      if (!acquired) return;
      running = true;
      await sweepRecoveryDeadlines();
    } catch (error) {
      console.error('[Rescue] Lỗi worker hết hạn:', error.message);
    } finally {
      running = false;
      if (acquired) await releaseJobLock(JOB_NAME);
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  console.log(`[Rescue] Worker đã khởi động (instance=${INSTANCE_ID}, mỗi ${intervalMs / 1000}s).`);
  return handle;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  startRecoveryWorker,
  sweepRecoveryDeadlines,
};
