'use strict';

const prisma = require('../config/prisma');

const EVENT_TYPES = new Set([
  'QUEUE_JOINED',
  'QUEUE_READY',
  'QUEUE_ADMITTED',
  'QUEUE_CANCELLED',
  'QUEUE_EXPIRED',
  'QUEUE_CALLED',
  'QUEUE_NO_SHOW',
  'QUEUE_PAUSED',
  'QUEUE_RESUMED',
  'AUTOPILOT_PROPOSED',
  'AUTOPILOT_ACCEPTED',
  'AUTOPILOT_REJECTED',
  'AUTOPILOT_EXPIRED',
  'ITEM_AT_RISK',
  'ITEM_RECOVERED',
  'ITEM_COMPLETED',
  'ITEM_SKIPPED',
]);

const EVENT_SEVERITIES = new Set(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']);

function safeJson(value) {
  if (value == null) return undefined;
  return JSON.parse(JSON.stringify(value));
}

async function recordLiveTripEvent({
  client = prisma,
  liveTripId,
  liveTripItemId = null,
  userId,
  type,
  severity = 'INFO',
  title,
  message,
  data,
}) {
  if (!liveTripId || !userId || !EVENT_TYPES.has(type)) {
    throw new Error('Invalid live-trip event payload.');
  }
  if (!EVENT_SEVERITIES.has(severity)) {
    throw new Error('Invalid live-trip event severity.');
  }

  return client.liveTripEvent.create({
    data: {
      liveTripId,
      liveTripItemId: liveTripItemId || null,
      userId,
      type,
      severity,
      title: String(title || '').trim().slice(0, 160),
      message: String(message || '').trim(),
      ...(data == null ? {} : { data: safeJson(data) }),
    },
  });
}

function serializeLiveTripEvent(event) {
  return {
    id: event.id,
    liveTripItemId: event.liveTripItemId || null,
    type: event.type,
    severity: event.severity,
    title: event.title,
    message: event.message,
    data: event.data || null,
    createdAt: event.createdAt,
  };
}

module.exports = {
  EVENT_SEVERITIES,
  EVENT_TYPES,
  recordLiveTripEvent,
  serializeLiveTripEvent,
};
