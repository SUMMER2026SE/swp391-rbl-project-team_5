'use strict';

const prisma = require('../config/prisma');
const { emitLiveTripUpdated } = require('../realtime/events');
const { getAttractionPressure, getDateKey } = require('./arrivalPressureService');
const { recordLiveTripEvent } = require('./liveTripEventService');
const { DEFAULT_QUEUE_POLICY, selectQueuePressure } = require('./smartQueueService');

const QUEUE_CALL_BEFORE_MS = 15 * 60 * 1000;

const QUEUE_ENTRY_SELECT = {
  id: true,
  liveTripId: true,
  liveTripItemId: true,
  userId: true,
  attractionId: true,
  bookingId: true,
  visitDate: true,
  partySize: true,
  status: true,
  joinedAt: true,
  readyAt: true,
  readyExpiresAt: true,
  calledAt: true,
  calledById: true,
  noShowAt: true,
  admittedAt: true,
  expiresAt: true,
  user: { select: { id: true, fullName: true } },
  attraction: { select: { id: true, title: true, city: true } },
  liveTripItem: { select: { scheduledStart: true, scheduledEnd: true } },
  booking: {
    select: {
      status: true,
      fullName: true,
      reservation: { select: { timeSlotId: true } },
    },
  },
};

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeDateKey(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw httpError(400, 'INVALID_DATE', 'date phải có định dạng YYYY-MM-DD.');
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || getDateKey(date) !== raw) {
    throw httpError(400, 'INVALID_DATE', 'date không phải là ngày hợp lệ.');
  }
  return date;
}

function queueScopeWhere(entry) {
  const timeSlotId = entry.booking?.reservation?.timeSlotId;
  return {
    booking: timeSlotId
      ? { reservation: { timeSlotId } }
      : { reservation: { timeSlotId: null } },
  };
}

function normalizePolicyInput(payload = {}) {
  const policy = {};
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled === 'boolean') policy.enabled = payload.enabled;
    else if (payload.enabled === 'true' || payload.enabled === 'false') policy.enabled = payload.enabled === 'true';
    else throw httpError(400, 'INVALID_QUEUE_POLICY', 'enabled phải là boolean.');
  }
  if (payload.mode !== undefined) {
    const mode = String(payload.mode).toUpperCase();
    if (!['AUTO', 'STAFF_CONTROLLED'].includes(mode)) {
      throw httpError(400, 'INVALID_QUEUE_MODE', 'mode phải là AUTO hoặc STAFF_CONTROLLED.');
    }
    policy.mode = mode;
  }
  const integerFields = [
    ['openBeforeMinutes', 0, 24 * 60],
    ['readyGraceMinutes', 1, 60],
    ['maxReadyParties', 1, 50],
    ['maxActiveParties', 1, 10000],
    ['fallbackThroughput15m', 1, 10000],
    ['snapshotIntervalMinutes', 5, 60],
  ];
  for (const [field, min, max] of integerFields) {
    if (payload[field] === undefined) continue;
    const value = Number(payload[field]);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw httpError(400, 'INVALID_QUEUE_POLICY', `${field} phải là số nguyên trong khoảng ${min}-${max}.`);
    }
    policy[field] = value;
  }
  return policy;
}

async function getPolicy(attractionId, { prismaClient = prisma } = {}) {
  if (!prismaClient?.smartQueuePolicy?.findUnique) return { ...DEFAULT_QUEUE_POLICY };
  const policy = await prismaClient.smartQueuePolicy.findUnique({ where: { attractionId } });
  return { ...DEFAULT_QUEUE_POLICY, ...(policy || {}) };
}

async function listQueueOperations({ attractionId, date, prismaClient = prisma, now = new Date() } = {}) {
  const normalizedAttractionId = String(attractionId || '').trim();
  if (!normalizedAttractionId) throw httpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  const visitDate = normalizeDateKey(date || getDateKey(now));
  const policy = await getPolicy(normalizedAttractionId, { prismaClient });
  const entries = await prismaClient.smartQueueEntry.findMany({
    where: {
      attractionId: normalizedAttractionId,
      visitDate,
      status: { in: ['WAITING', 'READY'] },
      expiresAt: { gt: now },
    },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: QUEUE_ENTRY_SELECT,
  });
  const pressure = await getAttractionPressure(normalizedAttractionId, getDateKey(visitDate), {
    prismaClient,
    now,
  });
  const active = entries || [];
  const waitingPositions = new Map();
  const readyCounts = active.reduce((counts, entry) => {
    if (entry.status !== 'READY') return counts;
    const scopeKey = entry.booking?.reservation?.timeSlotId || 'UNTIMED';
    counts.set(scopeKey, (counts.get(scopeKey) || 0) + 1);
    return counts;
  }, new Map());
  return {
    date: getDateKey(visitDate),
    policy,
    pressure,
    summary: {
      waitingParties: active.filter((entry) => entry.status === 'WAITING').length,
      readyParties: active.filter((entry) => entry.status === 'READY').length,
      waitingGuests: active
        .filter((entry) => entry.status === 'WAITING')
        .reduce((sum, entry) => sum + Number(entry.partySize || 0), 0),
      readyGuests: active
        .filter((entry) => entry.status === 'READY')
        .reduce((sum, entry) => sum + Number(entry.partySize || 0), 0),
      activeGuests: active.reduce((sum, entry) => sum + Number(entry.partySize || 0), 0),
    },
    entries: active.map((entry) => {
      const scopeKey = entry.booking?.reservation?.timeSlotId || 'UNTIMED';
      const nextPosition = entry.status === 'WAITING'
        ? (waitingPositions.get(scopeKey) || 0) + 1
        : null;
      if (nextPosition) waitingPositions.set(scopeKey, nextPosition);
      const scheduledStart = new Date(entry.liveTripItem?.scheduledStart);
      const hasScheduledStart = Number.isFinite(scheduledStart.getTime());
      const callAvailableAt = hasScheduledStart
        ? new Date(scheduledStart.getTime() - QUEUE_CALL_BEFORE_MS)
        : null;
      const entryPressure = selectQueuePressure(pressure, entry);
      return {
        ...entry,
        position: nextPosition,
        queueScope: entry.booking?.reservation?.timeSlotId ? 'TIME_SLOT' : 'ATTRACTION_DAY',
        readyPartiesInScope: readyCounts.get(scopeKey) || 0,
        callAvailableAt,
        callWindowOpen: Boolean(callAvailableAt && new Date(now) >= callAvailableAt),
        pressure: {
          score: entryPressure?.summary?.score ?? 0,
          label: entryPressure?.summary?.label || null,
          scope: entryPressure?.pressureScope || 'ATTRACTION_DAY',
          timeSlot: entryPressure?.selectedTimeSlot || null,
        },
        visitDate: getDateKey(entry.visitDate),
      };
    }),
    generatedAt: new Date(now).toISOString(),
  };
}

async function transitionQueueEntry({ entryId, action, actorId, prismaClient = prisma, now = new Date() } = {}) {
  const id = String(entryId || '').trim();
  const normalizedAction = String(action || '').toUpperCase();
  if (!id || !['CALL', 'NO_SHOW'].includes(normalizedAction)) {
    throw httpError(400, 'INVALID_QUEUE_ACTION', 'action phải là CALL hoặc NO_SHOW.');
  }
  const entry = await prismaClient.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT });
  if (!entry) throw httpError(404, 'QUEUE_ENTRY_NOT_FOUND', 'Không tìm thấy lượt SmartQueue.');
  const policy = await getPolicy(entry.attractionId, { prismaClient });

  if (normalizedAction === 'CALL') {
    if (!policy.enabled || policy.pausedAt) throw httpError(409, 'QUEUE_PAUSED', 'SmartQueue đang tạm dừng.');
    if (entry.status !== 'WAITING') {
      if (entry.status === 'ADMITTED') throw httpError(409, 'QUEUE_ALREADY_ADMITTED', 'Lượt này đã check-in.');
      if (entry.status === 'READY') throw httpError(409, 'QUEUE_ALREADY_CALLED', 'Lượt này đã được gọi và đang trong cửa sổ quay lại.');
      throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt này không còn ở trạng thái có thể gọi.');
    }
    const calledAt = new Date(now);
    const scheduledStart = new Date(entry.liveTripItem?.scheduledStart);
    if (!Number.isFinite(scheduledStart.getTime())) {
      throw httpError(
        409,
        'QUEUE_SCHEDULE_UNAVAILABLE',
        'Không xác định được giờ tham quan nên chưa thể gọi khách an toàn.',
      );
    }
    if (calledAt < new Date(scheduledStart.getTime() - QUEUE_CALL_BEFORE_MS)) {
      throw httpError(
        409,
        'QUEUE_CALL_TOO_EARLY',
        'Chỉ có thể gọi khách từ 15 phút trước giờ tham quan để tránh làm hết cửa sổ quay lại quá sớm.',
      );
    }
    if (entry.status === 'WAITING') {
      const [waitingAhead, readyCount] = await Promise.all([
        prismaClient.smartQueueEntry.count({
          where: {
            attractionId: entry.attractionId,
            visitDate: entry.visitDate,
            ...queueScopeWhere(entry),
            status: 'WAITING',
            expiresAt: { gt: calledAt },
            OR: [
              { joinedAt: { lt: entry.joinedAt } },
              { joinedAt: entry.joinedAt, id: { lt: entry.id } },
            ],
          },
        }),
        prismaClient.smartQueueEntry.count({
          where: {
            attractionId: entry.attractionId,
            visitDate: entry.visitDate,
            ...queueScopeWhere(entry),
            status: 'READY',
            expiresAt: { gt: calledAt },
          },
        }),
      ]);
      if (Number(waitingAhead || 0) > 0) {
        throw httpError(
          409,
          'QUEUE_FIFO_VIOLATION',
          'Phải gọi nhóm đầu hàng chờ trước để bảo toàn FIFO.',
        );
      }
      if (Number(readyCount || 0) >= Math.max(1, Number(policy.maxReadyParties) || 3)) {
        throw httpError(
          409,
          'QUEUE_READY_CAPACITY_REACHED',
          'Đã đạt số nhóm tối đa trong cửa sổ quay lại. Hãy check-in hoặc xử lý no-show trước.',
        );
      }
    }
    const readyExpiresAt = new Date(calledAt.getTime() + policy.readyGraceMinutes * 60 * 1000);
    const updated = await prismaClient.$transaction(async (tx) => {
      const result = await tx.smartQueueEntry.updateMany({
        where: { id, status: 'WAITING', expiresAt: { gt: calledAt } },
        data: { status: 'READY', readyAt: entry.readyAt || calledAt, readyExpiresAt, calledAt, calledById: actorId },
      });
      if (result.count !== 1) throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt vừa được xử lý bởi nhân viên khác.');
      await recordLiveTripEvent({
        client: tx,
        liveTripId: entry.liveTripId,
        liveTripItemId: entry.liveTripItemId,
        userId: entry.userId,
        type: 'QUEUE_CALLED',
        severity: 'SUCCESS',
        title: 'Nhân viên đã gọi lượt SmartQueue',
        message: 'Vui lòng di chuyển đến cổng trong thời gian hiển thị.',
        data: { queueEntryId: id, calledById: actorId, readyExpiresAt },
      });
      return tx.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT });
    });
    return updated;
  }

  if (entry.status !== 'READY') {
    throw httpError(409, 'QUEUE_NOT_READY', 'Chỉ lượt đã được gọi mới có thể đánh dấu no-show.');
  }
  const noShowAt = new Date(now);
  if (!entry.readyExpiresAt || noShowAt < new Date(entry.readyExpiresAt)) {
    throw httpError(
      409,
      'QUEUE_RETURN_WINDOW_ACTIVE',
      'Chưa thể ghi nhận no-show khi cửa sổ quay lại vẫn còn hiệu lực.',
    );
  }
  return prismaClient.$transaction(async (tx) => {
    const result = await tx.smartQueueEntry.updateMany({
      where: { id, status: 'READY' },
      data: { status: 'NO_SHOW', noShowAt },
    });
    if (result.count !== 1) throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt vừa được xử lý bởi nhân viên khác.');
    await recordLiveTripEvent({
      client: tx,
      liveTripId: entry.liveTripId,
      liveTripItemId: entry.liveTripItemId,
      userId: entry.userId,
      type: 'QUEUE_NO_SHOW',
      severity: 'WARNING',
      title: 'Nhân viên xác nhận khách no-show',
      message: 'Lượt đã đóng do khách không đến cổng trong thời gian cho phép.',
      data: { queueEntryId: id, actorId },
    });
    return tx.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT });
  });
}

async function saveQueuePolicy({ attractionId, payload, actorId, prismaClient = prisma } = {}) {
  const id = String(attractionId || '').trim();
  if (!id) throw httpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  const data = normalizePolicyInput(payload);
  return prismaClient.smartQueuePolicy.upsert({
    where: { attractionId: id },
    create: { attractionId: id, ...data, updatedById: actorId || null },
    update: { ...data, updatedById: actorId || null },
  });
}

async function setQueuePause({ attractionId, paused, reason, actorId, prismaClient = prisma } = {}) {
  const id = String(attractionId || '').trim();
  const text = String(reason || '').trim();
  if (!id) throw httpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  if (paused && (text.length < 5 || text.length > 300)) {
    throw httpError(400, 'INVALID_QUEUE_REASON', 'Lý do tạm dừng phải có 5-300 ký tự.');
  }
  const previous = prismaClient?.smartQueuePolicy?.findUnique
    ? await prismaClient.smartQueuePolicy.findUnique({ where: { attractionId: id } })
    : null;
  const wasPaused = Boolean(previous?.pausedAt);
  const data = paused
    ? { pausedAt: new Date(), pausedById: actorId || null, pauseReason: text, updatedById: actorId || null }
    : { pausedAt: null, pausedById: null, pauseReason: null, updatedById: actorId || null };
  const stateChanged = wasPaused !== Boolean(paused);
  const result = await prismaClient.$transaction(async (tx) => {
    const policy = await tx.smartQueuePolicy.upsert({
      where: { attractionId: id },
      create: { attractionId: id, ...data },
      update: data,
    });
    if (!stateChanged) return { policy, entries: [] };

    const entries = await tx.smartQueueEntry.findMany({
      where: {
        attractionId: id,
        status: { in: ['WAITING', 'READY'] },
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        liveTripId: true,
        liveTripItemId: true,
        userId: true,
      },
      take: 10000,
    });
    for (const entry of entries || []) {
      await recordLiveTripEvent({
        client: tx,
        liveTripId: entry.liveTripId,
        liveTripItemId: entry.liveTripItemId,
        userId: entry.userId,
        type: paused ? 'QUEUE_PAUSED' : 'QUEUE_RESUMED',
        severity: paused ? 'WARNING' : 'INFO',
        title: paused ? 'SmartQueue tạm dừng vận hành' : 'SmartQueue đã hoạt động trở lại',
        message: paused
          ? `Hàng chờ đang tạm dừng: ${text}. Lượt hiện tại vẫn được bảo lưu.`
          : 'Hàng chờ đã hoạt động trở lại; thứ tự hiện tại vẫn được bảo lưu.',
        data: { queueEntryId: entry.id, attractionId: id, reason: text || null },
      });
    }
    return { policy, entries: entries || [] };
  });

  for (const entry of result.entries) {
    emitLiveTripUpdated({
      customerId: entry.userId,
      tripId: entry.liveTripId,
      itemId: entry.liveTripItemId,
      queueStatus: null,
      reason: paused ? 'QUEUE_PAUSED' : 'QUEUE_RESUMED',
    });
  }
  return { ...result.policy, affectedEntries: result.entries.length };
}

module.exports = {
  getPolicy,
  listQueueOperations,
  normalizePolicyInput,
  saveQueuePolicy,
  setQueuePause,
  transitionQueueEntry,
};
