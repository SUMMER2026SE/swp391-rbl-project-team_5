'use strict';

const prisma = require('../config/prisma');
const {
  INSTANCE_ID,
  acquireJobLock,
  releaseJobLock,
} = require('./cleanupWorker');

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 10;
const JOB_NAME = 'prune_expired_auth_sessions';
const LOCK_TTL_MS = 15 * 60 * 1000;

async function pruneExpiredAuthSessions({
  now = new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatches = MAX_BATCHES_PER_RUN,
} = {}) {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const sessions = await prisma.authSession.findMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { revokedAt: { not: null, lte: now } },
        ],
      },
      orderBy: { expiresAt: 'asc' },
      select: { id: true },
      take: batchSize,
    });
    if (sessions.length === 0) break;

    const result = await prisma.authSession.deleteMany({
      where: { id: { in: sessions.map((session) => session.id) } },
    });
    deleted += result.count;
    if (sessions.length < batchSize) break;
  }
  if (deleted > 0) {
    console.log(`[auth-session-cleanup] Đã xóa ${deleted} phiên hết hạn/đã thu hồi.`);
  }
  return deleted;
}

function startAuthSessionCleanupWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false;
  const tick = async () => {
    if (isRunning) return;
    let acquired = false;
    try {
      acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_MS);
      if (!acquired) return;
      isRunning = true;
      await pruneExpiredAuthSessions();
    } catch (error) {
      console.error('[auth-session-cleanup] Không thể dọn phiên:', error.message);
    } finally {
      isRunning = false;
      if (acquired) await releaseJobLock(JOB_NAME);
    }
  };

  // Chạy một lượt ngay sau khi server sẵn sàng, sau đó duy trì định kỳ.
  setImmediate(tick);
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  console.log(
    `[auth-session-cleanup] Worker đã khởi động (instance=${INSTANCE_ID}, mỗi ${intervalMs / 3600000}h).`,
  );
  return handle;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_INTERVAL_MS,
  JOB_NAME,
  pruneExpiredAuthSessions,
  startAuthSessionCleanupWorker,
};
