'use strict';

const prisma = require('../config/prisma');
const { emitLiveTripUpdated } = require('../realtime/events');
const { todayInVietnam } = require('../utils/refundService');
const {
  getAttractionPressure,
  getDateKey,
  getVietnamDateKey,
} = require('./arrivalPressureService');
const { recordLiveTripEvent } = require('./liveTripEventService');

const ACTIVE_QUEUE_STATUSES = ['WAITING', 'READY'];
const QUEUE_OPEN_BEFORE_MS = 2 * 60 * 60 * 1000;
const QUEUE_READY_MAX_PRESSURE = 84;
const QUEUE_FALLBACK_THROUGHPUT_RATIO = 0.08;
const ARRIVAL_PREDICTION_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_ESTIMATED_WAIT_MINUTES = 240;
const QUEUE_SWEEP_LIMIT = 100;
const QUEUE_CALL_BEFORE_MS = 15 * 60 * 1000;
const DEFAULT_QUEUE_POLICY = Object.freeze({
  enabled: true,
  mode: 'AUTO',
  openBeforeMinutes: 120,
  readyGraceMinutes: 10,
  maxReadyParties: 3,
  maxActiveParties: 100,
  fallbackThroughput15m: 8,
});

const QUEUE_ENTRY_INCLUDE = {
  attraction: {
    select: {
      id: true,
      title: true,
      city: true,
      operationalStatus: true,
    },
  },
  liveTripItem: {
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      snapshot: true,
    },
  },
  booking: {
    select: {
      status: true,
      reservation: { select: { timeSlotId: true } },
      ticketInstances: {
        where: { status: 'USED' },
        select: { id: true },
        take: 1,
      },
    },
  },
};

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizedDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNow(now) {
  const value = normalizedDate(now) || new Date();
  return value;
}

async function getQueuePolicy(attractionId, { prismaClient = prisma } = {}) {
  // Older unit-test doubles and pre-migration read replicas do not expose the
  // new table. Falling back here keeps the Sprint 1–2 customer flow safe.
  if (!prismaClient?.smartQueuePolicy?.findUnique) return { ...DEFAULT_QUEUE_POLICY };
  const policy = await prismaClient.smartQueuePolicy.findUnique({
    where: { attractionId: String(attractionId || '') },
  });
  return { ...DEFAULT_QUEUE_POLICY, ...(policy || {}) };
}

function getQueueVisitDate(item) {
  return item.booking?.snapshotVisitDate || item.booking?.reservation?.date || null;
}

function getQueueCloseTime(item) {
  const start = normalizedDate(item.scheduledStart);
  const end = normalizedDate(item.scheduledEnd);
  return end && start && end > start
    ? end
    : new Date(start.getTime() + 4 * 60 * 60 * 1000);
}

function assertQueueEligibility(item, now, policy = DEFAULT_QUEUE_POLICY) {
  if (!item) {
    throw createHttpError(404, 'LIVE_TRIP_ITEM_NOT_FOUND', 'Không tìm thấy hoạt động trong chuyến đi này.');
  }
  if (!item.attractionId || !item.attraction) {
    throw createHttpError(409, 'QUEUE_ATTRACTION_UNAVAILABLE', 'Điểm tham quan không còn khả dụng cho SmartQueue.');
  }
  if (item.attraction.operationalStatus !== 'ACTIVE') {
    throw createHttpError(409, 'QUEUE_ATTRACTION_SUSPENDED', 'Điểm tham quan đang tạm ngưng vận hành.');
  }
  if (!item.bookingId || !item.booking) {
    throw createHttpError(409, 'QUEUE_BOOKING_REQUIRED', 'SmartQueue chỉ dành cho hoạt động đã liên kết booking hợp lệ.');
  }
  if (item.booking.status !== 'CONFIRMED') {
    throw createHttpError(409, 'QUEUE_BOOKING_NOT_CONFIRMED', 'Booking phải ở trạng thái đã xác nhận để tham gia SmartQueue.');
  }
  if (item.booking.ticketInstances?.some((ticket) => ticket.status === 'USED')) {
    throw createHttpError(409, 'QUEUE_ALREADY_ADMITTED', 'Booking đã có vé check-in nên không thể tham gia hàng chờ.');
  }

  const visitDate = getQueueVisitDate(item);
  const visitDateKey = getDateKey(visitDate);
  const itemDateKey = item.snapshot?.visitDate || getVietnamDateKey(item.scheduledStart);
  if (!visitDateKey || visitDateKey !== itemDateKey) {
    throw createHttpError(409, 'QUEUE_DATE_MISMATCH', 'Ngày booking không khớp với hoạt động trong chuyến đi.');
  }
  if (visitDateKey !== todayInVietnam(now)) {
    throw createHttpError(409, 'QUEUE_VISIT_DATE_REQUIRED', 'SmartQueue chỉ mở trong đúng ngày tham quan theo giờ Việt Nam.');
  }

  const startsAt = normalizedDate(item.scheduledStart);
  const closesAt = getQueueCloseTime(item);
  const openBeforeMinutes = Math.min(24 * 60, Math.max(0, Number(policy.openBeforeMinutes) || 120));
  if (!startsAt || now < new Date(startsAt.getTime() - openBeforeMinutes * 60 * 1000)) {
    throw createHttpError(
      409,
      'QUEUE_NOT_OPEN',
      `SmartQueue chỉ mở từ ${openBeforeMinutes} phút trước thời gian tham quan.`,
    );
  }
  if (now >= closesAt) {
    throw createHttpError(409, 'QUEUE_CLOSED_FOR_ITEM', 'Khung giờ tham quan đã kết thúc nên SmartQueue đã đóng.');
  }

  return {
    closesAt,
    partySize: Math.max(1, Number(item.booking.reservation?.quantity) || 1),
    visitDate,
    visitDateKey,
  };
}

async function loadOwnedItem(prismaClient, tripId, itemId, userId) {
  return prismaClient.liveTripItem.findFirst({
    where: {
      id: String(itemId || '').trim(),
      liveTripId: String(tripId || '').trim(),
      liveTrip: { userId, status: 'ACTIVE' },
    },
    include: {
      attraction: {
        select: {
          id: true,
          title: true,
          city: true,
          operationalStatus: true,
        },
      },
      booking: {
        select: {
          id: true,
          userId: true,
          status: true,
          snapshotVisitDate: true,
          reservation: { select: { date: true, quantity: true, timeSlotId: true } },
          ticketInstances: { select: { status: true } },
        },
      },
      smartQueueEntry: { include: QUEUE_ENTRY_INCLUDE },
    },
  });
}

function getQueueTimeSlotId(subject) {
  return subject?.booking?.reservation?.timeSlotId
    || subject?.liveTripItem?.snapshot?.timeSlotId
    || subject?.snapshot?.timeSlotId
    || null;
}

function queueScopeWhere(entry) {
  const timeSlotId = getQueueTimeSlotId(entry);
  return {
    booking: timeSlotId
      ? { reservation: { timeSlotId } }
      : { reservation: { timeSlotId: null } },
  };
}

function selectQueuePressure(pressure, subject) {
  const timeSlotId = getQueueTimeSlotId(subject);
  const slot = timeSlotId
    ? pressure?.slots?.find((candidate) => candidate.timeSlotId === timeSlotId)
    : null;
  if (!slot) return pressure;
  return {
    ...pressure,
    summary: slot,
    selectedTimeSlot: {
      timeSlotId: slot.timeSlotId,
      startTime: slot.startTime,
      endTime: slot.endTime,
    },
    pressureScope: 'TIME_SLOT',
  };
}

function queueAheadWhere(entry, now) {
  return {
    attractionId: entry.attractionId,
    visitDate: entry.visitDate,
    ...queueScopeWhere(entry),
    status: { in: ACTIVE_QUEUE_STATUSES },
    expiresAt: { gt: now },
    OR: [
      { joinedAt: { lt: entry.joinedAt } },
      { joinedAt: entry.joinedAt, id: { lt: entry.id } },
    ],
  };
}

async function getAheadMetrics(entry, prismaClient, now) {
  const where = queueAheadWhere(entry, now);
  const [partiesAhead, guestsAheadResult] = await Promise.all([
    prismaClient.smartQueueEntry.count({ where }),
    prismaClient.smartQueueEntry.aggregate({
      where,
      _sum: { partySize: true },
    }),
  ]);
  return {
    partiesAhead: Number(partiesAhead || 0),
    guestsAhead: Number(guestsAheadResult?._sum?.partySize || 0),
  };
}

async function getWaitingAheadCount(entry, prismaClient, now) {
  if (!prismaClient?.smartQueueEntry?.count) return 0;
  return prismaClient.smartQueueEntry.count({
    where: {
      ...queueAheadWhere(entry, now),
      status: 'WAITING',
    },
  });
}

function buildWaitEstimate({
  entry,
  guestsAhead,
  pressure,
  arrivalPrediction = null,
  policy = DEFAULT_QUEUE_POLICY,
}) {
  if (['READY', 'ADMITTED'].includes(entry.status)) {
    return { estimatedWaitMinutes: 0, estimateBasis: 'READY_NOW', confidence: 'HIGH' };
  }

  const recentCheckins = Math.max(0, Number(pressure?.summary?.checkinsLast15Minutes) || 0);
  const capacity = Math.max(1, Number(pressure?.summary?.capacity) || 1);
  const hasUsableModelPrediction = Boolean(
    arrivalPrediction
    && arrivalPrediction.usedFallback === false
    && ['MEDIUM', 'HIGH'].includes(arrivalPrediction.confidence),
  );
  const modelThroughput = hasUsableModelPrediction
    ? Number(arrivalPrediction.predictedP50)
    : Number.NaN;
  const throughputPer15Minutes = Number.isFinite(modelThroughput) && modelThroughput > 0
    ? modelThroughput
    : recentCheckins > 0
    ? recentCheckins
    : Math.max(
      1,
      Number(policy.fallbackThroughput15m)
        || Math.round(capacity * QUEUE_FALLBACK_THROUGHPUT_RATIO),
    );
  const guestsToServe = guestsAhead + Math.max(1, Number(entry.partySize) || 1);
  const rawWait = Math.ceil(guestsToServe / (throughputPer15Minutes / 15));

  return {
    estimatedWaitMinutes: Math.min(MAX_ESTIMATED_WAIT_MINUTES, Math.max(1, rawWait)),
    estimateBasis: Number.isFinite(modelThroughput) && modelThroughput > 0
      ? 'ML_ARRIVAL_PREDICTION'
      : recentCheckins > 0 ? 'RECENT_QR_THROUGHPUT' : 'CAPACITY_FALLBACK',
    confidence: hasUsableModelPrediction
      ? arrivalPrediction.confidence
      : recentCheckins >= 5 ? 'HIGH' : recentCheckins > 0 ? 'MEDIUM' : 'LOW',
  };
}

async function getLatestArrivalPrediction(
  attractionId,
  { prismaClient = prisma, now = new Date() } = {},
) {
  if (!prismaClient?.livePrediction?.findFirst) return null;
  const referenceNow = normalizeNow(now);
  return prismaClient.livePrediction.findFirst({
    where: {
      attractionId,
      predictionType: 'ARRIVALS',
      usedFallback: false,
      confidence: { in: ['MEDIUM', 'HIGH'] },
      predictedAt: {
        gte: new Date(referenceNow.getTime() - ARRIVAL_PREDICTION_MAX_AGE_MS),
        lte: referenceNow,
      },
    },
    orderBy: { predictedAt: 'desc' },
    select: {
      predictedP50: true,
      predictedP90: true,
      confidence: true,
      usedFallback: true,
      modelVersion: true,
      predictedAt: true,
    },
  });
}

function serializeQueueEntry(entry, metrics = null, pressure = null) {
  return {
    id: entry.id,
    liveTripId: entry.liveTripId,
    liveTripItemId: entry.liveTripItemId,
    attractionId: entry.attractionId,
    bookingId: entry.bookingId,
    visitDate: getDateKey(entry.visitDate),
    partySize: entry.partySize,
    status: entry.status,
    position: metrics && entry.status === 'WAITING'
      ? metrics.partiesAhead + 1
      : null,
    partiesAhead: metrics?.partiesAhead ?? null,
    guestsAhead: metrics?.guestsAhead ?? null,
    estimatedWaitMinutes: metrics?.estimatedWaitMinutes ?? null,
    estimateBasis: metrics?.estimateBasis || null,
    confidence: metrics?.confidence || null,
    joinedAt: entry.joinedAt,
    readyAt: entry.readyAt,
    readyExpiresAt: entry.readyExpiresAt || null,
    calledAt: entry.calledAt || null,
    noShowAt: entry.noShowAt || null,
    admittedAt: entry.admittedAt,
    cancelledAt: entry.cancelledAt,
    expiresAt: entry.expiresAt,
    attraction: entry.attraction || null,
    pressure: pressure
      ? {
          score: pressure.summary?.score ?? 0,
          level: pressure.summary?.level || null,
          label: pressure.summary?.label || null,
          scope: pressure.pressureScope || 'ATTRACTION_DAY',
          timeSlot: pressure.selectedTimeSlot || null,
          calculatedAt: pressure.calculatedAt,
        }
      : null,
    policy: {
      bookingRequired: true,
      oneEnrollmentPerExperience: true,
      opensBeforeMinutes: metrics?.policy?.openBeforeMinutes
        ?? DEFAULT_QUEUE_POLICY.openBeforeMinutes,
      readyGraceMinutes: metrics?.policy?.readyGraceMinutes
        ?? DEFAULT_QUEUE_POLICY.readyGraceMinutes,
      maxActiveParties: metrics?.policy?.maxActiveParties
        ?? DEFAULT_QUEUE_POLICY.maxActiveParties,
      admissionMethod: 'STAFF_QR_CHECKIN',
      mode: metrics?.policy?.mode || null,
      enabled: metrics?.policy?.enabled ?? true,
      paused: metrics?.policy?.paused ?? false,
      pauseReason: metrics?.policy?.pauseReason || null,
    },
  };
}

function queueJoinData(item, eligibility, userId, joinedAt) {
  return {
    liveTripId: item.liveTripId,
    liveTripItemId: item.id,
    userId,
    attractionId: item.attractionId,
    bookingId: item.bookingId,
    visitDate: eligibility.visitDate,
    partySize: eligibility.partySize,
    status: 'WAITING',
    joinedAt,
    readyAt: null,
    readyExpiresAt: null,
    calledAt: null,
    noShowAt: null,
    calledById: null,
    admittedAt: null,
    cancelledAt: null,
    expiresAt: eligibility.closesAt,
  };
}

async function recordQueueJoined({ tx, item, userId, entry, eligibility, pressure }) {
  await recordLiveTripEvent({
    client: tx,
    liveTripId: item.liveTripId,
    liveTripItemId: item.id,
    userId,
    type: 'QUEUE_JOINED',
    severity: 'INFO',
    title: 'Đã tham gia SmartQueue',
    message: `Hệ thống đang giữ thứ tự vào cổng cho ${eligibility.partySize} khách.`,
    data: {
      queueEntryId: entry.id,
      partySize: eligibility.partySize,
      pressureScore: pressure.summary?.score ?? null,
    },
  });
}

async function findQueueEntryByItem(prismaClient, liveTripItemId) {
  return prismaClient.smartQueueEntry.findUnique({
    where: { liveTripItemId },
    include: QUEUE_ENTRY_INCLUDE,
  });
}

async function assertQueueHasCapacity({
  attractionId,
  visitDate,
  policy,
  prismaClient,
  now,
}) {
  const maxActiveParties = Math.max(
    1,
    Number(policy.maxActiveParties) || DEFAULT_QUEUE_POLICY.maxActiveParties,
  );
  const activeParties = await prismaClient.smartQueueEntry.count({
    where: {
      attractionId,
      visitDate,
      status: { in: ACTIVE_QUEUE_STATUSES },
      expiresAt: { gt: now },
    },
  });
  if (Number(activeParties || 0) >= maxActiveParties) {
    throw createHttpError(
      409,
      'QUEUE_FULL',
      'SmartQueue đã hết suất cho thời điểm hiện tại. Vé vẫn còn hiệu lực theo điều kiện booking.',
    );
  }
}

async function refreshQueueRecord(entry, {
  prismaClient = prisma,
  now = new Date(),
  pressure: providedPressure = null,
} = {}) {
  const referenceNow = normalizeNow(now);
  if (!ACTIVE_QUEUE_STATUSES.includes(entry.status)) {
    return serializeQueueEntry(entry);
  }

  const policy = await getQueuePolicy(entry.attractionId, { prismaClient });

  if (referenceNow >= entry.expiresAt) {
    const expired = await prismaClient.$transaction(async (tx) => {
      const result = await tx.smartQueueEntry.updateMany({
        where: { id: entry.id, status: { in: ACTIVE_QUEUE_STATUSES } },
        data: { status: 'EXPIRED' },
      });
      if (result.count !== 1) return null;
      await recordLiveTripEvent({
        client: tx,
        liveTripId: entry.liveTripId,
        liveTripItemId: entry.liveTripItemId,
        userId: entry.userId,
        type: 'QUEUE_EXPIRED',
        severity: 'INFO',
        title: 'SmartQueue đã hết hiệu lực',
        message: 'Khung giờ tham quan đã kết thúc nên lượt xếp hàng được đóng tự động.',
        data: { queueEntryId: entry.id },
      });
      return { ...entry, status: 'EXPIRED' };
    });
    if (expired) {
      emitLiveTripUpdated({
        customerId: entry.userId,
        tripId: entry.liveTripId,
        itemId: entry.liveTripItemId,
        queueStatus: 'EXPIRED',
        reason: 'QUEUE_EXPIRED',
      });
      return serializeQueueEntry(expired);
    }
  }

  if (entry.status === 'READY' && entry.readyExpiresAt && referenceNow >= entry.readyExpiresAt) {
    const noShow = await prismaClient.$transaction(async (tx) => {
      const result = await tx.smartQueueEntry.updateMany({
        where: { id: entry.id, status: 'READY', readyExpiresAt: { lte: referenceNow } },
        data: { status: 'NO_SHOW', noShowAt: referenceNow },
      });
      if (result.count !== 1) return null;
      await recordLiveTripEvent({
        client: tx,
        liveTripId: entry.liveTripId,
        liveTripItemId: entry.liveTripItemId,
        userId: entry.userId,
        type: 'QUEUE_NO_SHOW',
        severity: 'WARNING',
        title: 'Lượt SmartQueue đã quá thời gian gọi',
        message: 'Khách chưa đến cổng trong thời gian cho phép; hệ thống chuyển lượt sang no-show.',
        data: { queueEntryId: entry.id, readyExpiresAt: entry.readyExpiresAt },
      });
      return { ...entry, status: 'NO_SHOW', noShowAt: referenceNow };
    });
    if (noShow) {
      emitLiveTripUpdated({
        customerId: entry.userId,
        tripId: entry.liveTripId,
        itemId: entry.liveTripItemId,
        queueStatus: 'NO_SHOW',
        reason: 'QUEUE_NO_SHOW',
      });
      return serializeQueueEntry(noShow);
    }
  }

  const rawPressure = providedPressure || await getAttractionPressure(
    entry.attractionId,
    getDateKey(entry.visitDate),
    { prismaClient, now: referenceNow },
  );
  const pressure = selectQueuePressure(rawPressure, entry);
  const arrivalPrediction = await getLatestArrivalPrediction(entry.attractionId, {
    prismaClient,
    now: referenceNow,
  });
  const ahead = await getAheadMetrics(entry, prismaClient, referenceNow);
  const waitingAhead = entry.status === 'WAITING'
    ? await getWaitingAheadCount(entry, prismaClient, referenceNow)
    : 0;
  const hasRecentAdmission = Number(pressure.summary?.checkinsLast15Minutes || 0) > 0;
  const readyCount = entry.status === 'WAITING' && prismaClient.smartQueueEntry?.count
    ? await prismaClient.smartQueueEntry.count({
      where: {
        attractionId: entry.attractionId,
        visitDate: entry.visitDate,
        ...queueScopeWhere(entry),
        status: 'READY',
        expiresAt: { gt: referenceNow },
      },
    })
    : 0;
  const shouldBecomeReady = policy.enabled
    && !policy.pausedAt
    && policy.mode === 'AUTO'
    && entry.status === 'WAITING'
    && referenceNow >= new Date(
      new Date(entry.liveTripItem?.scheduledStart || entry.expiresAt).getTime()
        - QUEUE_CALL_BEFORE_MS,
    )
    // READY parties have already left the virtual queue for the gate. They
    // must not block the next FIFO party when the policy allows a batch.
    && waitingAhead === 0
    && readyCount < Math.max(1, Number(policy.maxReadyParties) || 3)
    && !pressure.isClosed
    && (
      Number(pressure.summary?.score || 0) <= QUEUE_READY_MAX_PRESSURE
      || hasRecentAdmission
    );

  let current = entry;
  if (shouldBecomeReady) {
    const readyAt = referenceNow;
    const updated = await prismaClient.$transaction(async (tx) => {
      const result = await tx.smartQueueEntry.updateMany({
        where: { id: entry.id, status: 'WAITING', expiresAt: { gt: referenceNow } },
        data: {
          status: 'READY',
          readyAt,
          calledAt: readyAt,
          readyExpiresAt: new Date(
            readyAt.getTime() + Math.max(1, Number(policy.readyGraceMinutes) || 10) * 60 * 1000,
          ),
        },
      });
      if (result.count !== 1) return null;
      await recordLiveTripEvent({
        client: tx,
        liveTripId: entry.liveTripId,
        liveTripItemId: entry.liveTripItemId,
        userId: entry.userId,
        type: 'QUEUE_READY',
        severity: 'SUCCESS',
        title: 'Đã đến lượt vào cổng',
        message: 'Vui lòng di chuyển đến cổng và mở mã QR để nhân viên check-in.',
        data: { queueEntryId: entry.id, pressureScore: pressure.summary?.score ?? null },
      });
      return {
        ...entry,
        status: 'READY',
        readyAt,
        calledAt: readyAt,
        readyExpiresAt: new Date(
          readyAt.getTime() + Math.max(1, Number(policy.readyGraceMinutes) || 10) * 60 * 1000,
        ),
      };
    });
    if (updated) {
      current = updated;
      emitLiveTripUpdated({
        customerId: entry.userId,
        tripId: entry.liveTripId,
        itemId: entry.liveTripItemId,
        queueStatus: 'READY',
        reason: 'QUEUE_READY',
      });
    }
  }

  const estimate = buildWaitEstimate({
    entry: current,
    guestsAhead: ahead.guestsAhead,
    pressure,
    arrivalPrediction,
    policy,
  });
  return serializeQueueEntry(current, {
    ...ahead,
    ...estimate,
    policy: {
      mode: policy.mode,
      enabled: policy.enabled,
      paused: Boolean(policy.pausedAt),
      pauseReason: policy.pauseReason,
      openBeforeMinutes: policy.openBeforeMinutes,
      readyGraceMinutes: policy.readyGraceMinutes,
      maxActiveParties: policy.maxActiveParties,
    },
  }, pressure);
}

async function getQueueSnapshot(entry, {
  prismaClient = prisma,
  now = new Date(),
  pressure: providedPressure = null,
} = {}) {
  const referenceNow = normalizeNow(now);
  if (!ACTIVE_QUEUE_STATUSES.includes(entry.status)) return serializeQueueEntry(entry);
  if (referenceNow >= entry.expiresAt) {
    return serializeQueueEntry({ ...entry, status: 'EXPIRED' });
  }
  if (entry.status === 'READY' && entry.readyExpiresAt && referenceNow >= entry.readyExpiresAt) {
    return serializeQueueEntry({ ...entry, status: 'NO_SHOW', noShowAt: referenceNow });
  }

  const [rawPressure, arrivalPrediction, policy] = await Promise.all([
    providedPressure || getAttractionPressure(
      entry.attractionId,
      getDateKey(entry.visitDate),
      { prismaClient, now: referenceNow },
    ),
    getLatestArrivalPrediction(entry.attractionId, { prismaClient, now: referenceNow }),
    getQueuePolicy(entry.attractionId, { prismaClient }),
  ]);
  const pressure = selectQueuePressure(rawPressure, entry);
  const ahead = await getAheadMetrics(entry, prismaClient, referenceNow);
  const estimate = buildWaitEstimate({
    entry,
    guestsAhead: ahead.guestsAhead,
    pressure,
    arrivalPrediction,
    policy,
  });
  return serializeQueueEntry(entry, {
    ...ahead,
    ...estimate,
    policy: {
      mode: policy.mode,
      enabled: policy.enabled,
      paused: Boolean(policy.pausedAt),
      pauseReason: policy.pauseReason,
      openBeforeMinutes: policy.openBeforeMinutes,
      readyGraceMinutes: policy.readyGraceMinutes,
      maxActiveParties: policy.maxActiveParties,
    },
  }, pressure);
}

async function joinQueue({
  tripId,
  itemId,
  userId,
  prismaClient = prisma,
  now = new Date(),
} = {}) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const referenceNow = normalizeNow(now);
  const item = await loadOwnedItem(prismaClient, tripId, itemId, userId);
  const policy = item?.attractionId
    ? await getQueuePolicy(item.attractionId, { prismaClient })
    : { ...DEFAULT_QUEUE_POLICY };
  if (!policy.enabled || policy.pausedAt) {
    throw createHttpError(409, 'QUEUE_PAUSED', 'SmartQueue đang tạm dừng tại điểm tham quan.');
  }
  const eligibility = assertQueueEligibility(item, referenceNow, policy);

  if (item.booking.userId !== userId) {
    throw createHttpError(403, 'QUEUE_BOOKING_FORBIDDEN', 'Booking không thuộc tài khoản hiện tại.');
  }
  if (item.smartQueueEntry && ACTIVE_QUEUE_STATUSES.includes(item.smartQueueEntry.status)) {
    return {
      created: false,
      queue: await refreshQueueRecord(item.smartQueueEntry, { prismaClient, now: referenceNow }),
    };
  }
  if (item.smartQueueEntry?.status === 'ADMITTED') {
    throw createHttpError(409, 'QUEUE_ALREADY_ADMITTED', 'Booking đã hoàn tất lượt vào cổng.');
  }
  if (item.smartQueueEntry) {
    throw createHttpError(
      409,
      'QUEUE_DAILY_LIMIT_REACHED',
      'Mỗi booking chỉ được tham gia SmartQueue một lần cho hoạt động này trong ngày.',
    );
  }

  const rawPressure = await getAttractionPressure(item.attractionId, eligibility.visitDateKey, {
    prismaClient,
    now: referenceNow,
  });
  const pressure = selectQueuePressure(rawPressure, item);
  if (pressure.isClosed) {
    throw createHttpError(409, 'QUEUE_ATTRACTION_CLOSED', 'Điểm tham quan đang đóng cửa, không thể mở SmartQueue.');
  }
  if (Number(pressure.summary?.score || 0) < 70) {
    throw createHttpError(409, 'QUEUE_NOT_NEEDED', 'Điểm tham quan hiện chưa đông; bạn có thể đến cổng check-in trực tiếp.');
  }

  const data = queueJoinData(item, eligibility, userId, referenceNow);
  let entry;

  try {
    entry = await prismaClient.$transaction(async (tx) => {
      await assertQueueHasCapacity({
        attractionId: item.attractionId,
        visitDate: eligibility.visitDate,
        policy,
        prismaClient: tx,
        now: referenceNow,
      });
      const saved = await tx.smartQueueEntry.create({
        data,
      });
      await recordQueueJoined({ tx, item, userId, entry: saved, eligibility, pressure });
      return saved;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    // unique(liveTripItemId) enforces one enrolment; serializable isolation
    // keeps the attraction-level capacity check correct under concurrent joins.
    if (error?.code === 'P2034') {
      throw createHttpError(
        409,
        'QUEUE_CAPACITY_CHANGED',
        'Sức chứa SmartQueue vừa thay đổi. Vui lòng tải lại trạng thái.',
      );
    }
    if (error?.code !== 'P2002') throw error;
  }

  if (!entry) {
    const concurrentEntry = await findQueueEntryByItem(prismaClient, item.id);
    if (concurrentEntry && ACTIVE_QUEUE_STATUSES.includes(concurrentEntry.status)) {
      return {
        created: false,
        queue: await refreshQueueRecord(concurrentEntry, {
          prismaClient,
          now: referenceNow,
          pressure,
        }),
      };
    }
    if (concurrentEntry?.status === 'ADMITTED') {
      throw createHttpError(409, 'QUEUE_ALREADY_ADMITTED', 'Booking đã hoàn tất lượt vào cổng.');
    }
    if (concurrentEntry) {
      throw createHttpError(
        409,
        'QUEUE_DAILY_LIMIT_REACHED',
        'Mỗi booking chỉ được tham gia SmartQueue một lần cho hoạt động này trong ngày.',
      );
    }
    throw createHttpError(409, 'QUEUE_STATE_CHANGED', 'Trạng thái SmartQueue vừa thay đổi. Vui lòng tải lại.');
  }
  entry = await findQueueEntryByItem(prismaClient, item.id);
  if (!entry) {
    throw createHttpError(
      409,
      'QUEUE_STATE_CHANGED',
      'Lượt SmartQueue đã được tạo nhưng chưa thể đọc lại trạng thái. Vui lòng tải lại.',
    );
  }

  emitLiveTripUpdated({
    customerId: userId,
    tripId: item.liveTripId,
    itemId: item.id,
    queueStatus: 'WAITING',
    reason: 'QUEUE_JOINED',
  });

  return {
    created: true,
    queue: await refreshQueueRecord(entry, { prismaClient, now: referenceNow, pressure }),
  };
}

async function getQueueForItem({
  tripId,
  itemId,
  userId,
  prismaClient = prisma,
  now = new Date(),
} = {}) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const entry = await prismaClient.smartQueueEntry.findFirst({
    where: {
      liveTripId: String(tripId || '').trim(),
      liveTripItemId: String(itemId || '').trim(),
      userId,
      liveTrip: { userId },
    },
    include: QUEUE_ENTRY_INCLUDE,
  });
  if (!entry) return null;
  return getQueueSnapshot(entry, { prismaClient, now });
}

async function cancelQueue({
  tripId,
  itemId,
  userId,
  prismaClient = prisma,
  now = new Date(),
} = {}) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const referenceNow = normalizeNow(now);
  const entry = await prismaClient.smartQueueEntry.findFirst({
    where: {
      liveTripId: String(tripId || '').trim(),
      liveTripItemId: String(itemId || '').trim(),
      userId,
      liveTrip: { userId },
    },
    include: QUEUE_ENTRY_INCLUDE,
  });
  if (!entry) throw createHttpError(404, 'QUEUE_NOT_FOUND', 'Hoạt động này chưa tham gia SmartQueue.');
  if (entry.status === 'ADMITTED') {
    throw createHttpError(409, 'QUEUE_ALREADY_ADMITTED', 'Lượt vào cổng đã được xác nhận nên không thể hủy.');
  }
  if (!ACTIVE_QUEUE_STATUSES.includes(entry.status)) {
    return serializeQueueEntry(entry);
  }

  const cancelledAt = referenceNow;
  const cancelled = await prismaClient.$transaction(async (tx) => {
    const result = await tx.smartQueueEntry.updateMany({
      where: { id: entry.id, status: { in: ACTIVE_QUEUE_STATUSES } },
      data: { status: 'CANCELLED', cancelledAt },
    });
    if (result.count !== 1) {
      throw createHttpError(409, 'QUEUE_STATE_CHANGED', 'Trạng thái SmartQueue vừa thay đổi. Vui lòng tải lại.');
    }
    await recordLiveTripEvent({
      client: tx,
      liveTripId: entry.liveTripId,
      liveTripItemId: entry.liveTripItemId,
      userId,
      type: 'QUEUE_CANCELLED',
      severity: 'INFO',
      title: 'Đã rời SmartQueue',
      message: 'Lượt xếp hàng đã được hủy theo yêu cầu của bạn.',
      data: { queueEntryId: entry.id },
    });
    return { ...entry, status: 'CANCELLED', cancelledAt };
  });

  emitLiveTripUpdated({
    customerId: userId,
    tripId: entry.liveTripId,
    itemId: entry.liveTripItemId,
    queueStatus: 'CANCELLED',
    reason: 'QUEUE_CANCELLED',
  });
  return serializeQueueEntry(cancelled);
}

async function markQueueAdmittedForBooking(
  bookingId,
  { prismaClient = prisma, admittedAt = new Date() } = {},
) {
  const referenceNow = normalizeNow(admittedAt);
  const entries = await prismaClient.smartQueueEntry.findMany({
    where: { bookingId, status: { in: ACTIVE_QUEUE_STATUSES } },
    include: QUEUE_ENTRY_INCLUDE,
  });
  const admitted = [];

  for (const entry of entries || []) {
    const updated = await prismaClient.$transaction(async (tx) => {
      const result = await tx.smartQueueEntry.updateMany({
        where: { id: entry.id, status: { in: ACTIVE_QUEUE_STATUSES } },
        data: { status: 'ADMITTED', admittedAt: referenceNow },
      });
      if (result.count !== 1) return false;
      await recordLiveTripEvent({
        client: tx,
        liveTripId: entry.liveTripId,
        liveTripItemId: entry.liveTripItemId,
        userId: entry.userId,
        type: 'QUEUE_ADMITTED',
        severity: 'SUCCESS',
        title: 'Đã check-in qua SmartQueue',
        message: 'Nhân viên đã xác nhận mã QR và hoàn tất lượt vào cổng.',
        data: { queueEntryId: entry.id, bookingId },
      });
      return true;
    });
    if (!updated) continue;
    admitted.push(entry.id);
    emitLiveTripUpdated({
      customerId: entry.userId,
      tripId: entry.liveTripId,
      itemId: entry.liveTripItemId,
      queueStatus: 'ADMITTED',
      reason: 'QUEUE_ADMITTED',
    });
  }

  return { count: admitted.length, entryIds: admitted };
}

async function sweepSmartQueues({ prismaClient = prisma, now = new Date() } = {}) {
  const referenceNow = normalizeNow(now);
  const entries = await prismaClient.smartQueueEntry.findMany({
    where: { status: { in: ACTIVE_QUEUE_STATUSES } },
    orderBy: { updatedAt: 'asc' },
    take: QUEUE_SWEEP_LIMIT,
    include: QUEUE_ENTRY_INCLUDE,
  });
  let ready = 0;
  let expired = 0;
  let admitted = 0;

  for (const entry of entries || []) {
    try {
      const hasCheckedInTicket = (entry.booking?.ticketInstances?.length || 0) > 0;
      if (entry.booking?.status === 'COMPLETED' || hasCheckedInTicket) {
        const result = await markQueueAdmittedForBooking(entry.bookingId, {
          prismaClient,
          admittedAt: referenceNow,
        });
        admitted += result.count;
        continue;
      }
      const state = await refreshQueueRecord(entry, { prismaClient, now: referenceNow });
      if (entry.status === 'WAITING' && state.status === 'READY') ready += 1;
      if (ACTIVE_QUEUE_STATUSES.includes(entry.status) && state.status === 'EXPIRED') expired += 1;
    } catch (error) {
      console.error(`[smart-queue] Không thể làm mới ${entry.id}:`, error.message);
    }
  }

  return { scanned: entries?.length || 0, ready, admitted, expired };
}

module.exports = {
  ACTIVE_QUEUE_STATUSES,
  MAX_ESTIMATED_WAIT_MINUTES,
  DEFAULT_QUEUE_POLICY,
  QUEUE_OPEN_BEFORE_MS,
  QUEUE_READY_MAX_PRESSURE,
  assertQueueEligibility,
  buildWaitEstimate,
  cancelQueue,
  getQueueForItem,
  getQueuePolicy,
  getQueueSnapshot,
  joinQueue,
  markQueueAdmittedForBooking,
  refreshQueueRecord,
  selectQueuePressure,
  serializeQueueEntry,
  sweepSmartQueues,
};
