'use strict';

const prisma = require('../config/prisma');
const {
  OUTBOX_CLAIM_TTL_MS,
  OUTBOX_PENDING,
  OUTBOX_PROCESSING,
  REFUND_NOTIFICATION_TOPIC,
  claimOutboxRow,
  deliverClaimedOutboxRow,
} = require('../services/refundNotificationService');
const {
  BOOKING_NOTIFICATION_TOPICS,
  deliverClaimedBookingOutboxRow,
} = require('../services/bookingNotificationService');
const { runWithJobLease } = require('./jobLease');

const DEFAULT_INTERVAL_MS = 30 * 1000;
const LEASE_TTL_MS = 2 * 60 * 1000;

async function sweepNotificationOutbox({ limit = 30, now = new Date() } = {}) {
  const staleBefore = new Date(now.getTime() - OUTBOX_CLAIM_TTL_MS);
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      topic: { in: [REFUND_NOTIFICATION_TOPIC, ...BOOKING_NOTIFICATION_TOPICS] },
      OR: [
        { status: OUTBOX_PENDING, nextAttemptAt: { lte: now } },
        { status: OUTBOX_PROCESSING, lockedAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  let delivered = 0;
  for (const candidate of rows) {
    try {
      const claimed = await claimOutboxRow(candidate.dedupeKey, now);
      if (!claimed || claimed.status !== OUTBOX_PROCESSING) continue;
      const wasDelivered = BOOKING_NOTIFICATION_TOPICS.includes(claimed.topic)
        ? await deliverClaimedBookingOutboxRow(claimed, now)
        : await deliverClaimedOutboxRow(claimed, now);
      if (wasDelivered) delivered += 1;
    } catch (error) {
      console.error(
        `[notification-outbox] Không thể giao ${candidate.dedupeKey}:`,
        error.message,
      );
    }
  }
  return delivered;
}

function startNotificationOutboxWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (process.env.NODE_ENV === 'test') return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runWithJobLease('notification-outbox', LEASE_TTL_MS, () =>
        sweepNotificationOutbox());
    } catch (error) {
      console.error('[notification-outbox] Lỗi vòng quét:', error.message);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  // Other maintenance workers also perform an immediate startup sweep.
  // Starting this one on its first short interval avoids contending for the
  // same freshly-created PostgreSQL client while still retrying within 30s.
  return handle;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  startNotificationOutboxWorker,
  sweepNotificationOutbox,
};
