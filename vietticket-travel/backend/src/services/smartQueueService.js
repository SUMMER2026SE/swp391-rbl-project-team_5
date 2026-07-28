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
const MAX_ESTIMATED_WAIT_MINUTES = 240;
const QUEUE_SWEEP_LIMIT = 100;
const QUEUE_CALL_BEFORE_MS = 15 * 60 * 1000;
const DEFAULT_QUEUE_POLICY = Object.freeze({
  // A virtual queue only has real-world value when the partner has committed
  // staff/a dedicated VietTicket check-in flow. Missing configuration must
  // therefore fail closed instead of silently promising a queue at every venue.
  enabled: false,
  mode: 'AUTO',
  openBeforeMinutes: 120,
  readyGraceMinutes: 10,
  maxReadyParties: 3,
  maxReadyGuests: 20,
  maxActiveParties: 100,
  fallbackThroughput15m: 8,
});
const SERIALIZABLE_RETRY_LIMIT = 2;

/**
 * Run a queue state transition at SERIALIZABLE isolation and retry transient
 * serialization conflicts.  Queue workers and staff actions can legitimately
 * collide (for example, a customer joining while staff pauses a venue); a
 * bounded retry lets the winning committed state be re-read without exposing
 * a spurious "state changed" error to the customer.
 */
async function runSerializableTransaction(
  prismaClient,
  callback,
  { retries = SERIALIZABLE_RETRY_LIMIT } = {},
) {
  // A few read-only maintenance paths and legacy test doubles expose the
  // model delegates but not `$transaction`; retain their deterministic
  // behaviour while real Prisma clients always take the serializable path.
  if (!prismaClient?.$transaction) return callback(prismaClient);
  let attempt = 0;
  while (true) {
    try {
      return await prismaClient.$transaction(callback, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error?.code !== 'P2034' || attempt >= retries) throw error;
      attempt += 1;
    }
  }
}

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
  if (!prismaClient?.smartQueuePolicy?.findUnique) {
    return { ...DEFAULT_QUEUE_POLICY, configured: false };
  }
  const policy = await prismaClient.smartQueuePolicy.findUnique({
    where: { attractionId: String(attractionId || '') },
  });
  const merged = { ...DEFAULT_QUEUE_POLICY, ...(policy || {}), configured: Boolean(policy) };
  // The field is present on real Prisma rows after the readiness migration.
  // Older test doubles/read replicas may omit it; preserve their legacy shape
  // while production fails closed for pre-opt-in enabled rows.
  if (
    policy
    && Object.prototype.hasOwnProperty.call(policy, 'operationalReadinessConfirmedAt')
    && merged.enabled === true
    && !policy.operationalReadinessConfirmedAt
  ) {
    merged.enabled = false;
  }
  return merged;
}

function getQueueVisitDate(item) {
  return item.booking?.snapshotVisitDate || item.booking?.reservation?.date || null;
}

function getQueueCloseTime(item) {
  const start = normalizedDate(item.scheduledStart);
  const end = normalizedDate(item.scheduledEnd);
  if (!start) return null;
  return end && start && end > start
    ? end
    : new Date(start.getTime() + 4 * 60 * 60 * 1000);
}

function getSnapshotVisitDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return value ? getVietnamDateKey(value) : null;
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
  const itemDateKey = getSnapshotVisitDateKey(item.snapshot?.visitDate)
    || getVietnamDateKey(item.scheduledStart);
  if (!visitDateKey || visitDateKey !== itemDateKey) {
    throw createHttpError(409, 'QUEUE_DATE_MISMATCH', 'Ngày booking không khớp với hoạt động trong chuyến đi.');
  }
  if (visitDateKey !== todayInVietnam(now)) {
    throw createHttpError(409, 'QUEUE_VISIT_DATE_REQUIRED', 'SmartQueue chỉ mở trong đúng ngày tham quan theo giờ Việt Nam.');
  }

  const startsAt = normalizedDate(item.scheduledStart);
  const closesAt = getQueueCloseTime(item);
  if (!startsAt || !closesAt) {
    throw createHttpError(
      409,
      'QUEUE_SCHEDULE_UNAVAILABLE',
      'Không xác định được khung giờ tham quan nên chưa thể mở SmartQueue an toàn.',
    );
  }
  const openBeforeMinutes = Math.min(24 * 60, Math.max(0, Number(policy.openBeforeMinutes) || 120));
  if (now < new Date(startsAt.getTime() - openBeforeMinutes * 60 * 1000)) {
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
  policy = DEFAULT_QUEUE_POLICY,
}) {
  if (['READY', 'ADMITTED'].includes(entry.status)) {
    return { estimatedWaitMinutes: 0, estimateBasis: 'READY_NOW', confidence: 'HIGH' };
  }

  const recentCheckins = Math.max(0, Number(pressure?.summary?.checkinsLast15Minutes) || 0);
  const capacity = Math.max(1, Number(pressure?.summary?.capacity) || 1);
  // Arrival demand and service throughput are different quantities. Treating
  // predicted arrivals as gate throughput makes a busier forecast shorten the
  // ETA, which is directionally wrong. ETA therefore uses observed QR service
  // throughput, then the partner-configured conservative fallback.
  const throughputPer15Minutes = recentCheckins > 0
    ? recentCheckins
    : Math.max(
      1,
      Number(policy.fallbackThroughput15m)
        || Math.round(capacity * QUEUE_FALLBACK_THROUGHPUT_RATIO),
    );
  // ETA means time until this party is called, so only guests ahead belong in
  // the numerator. The party's own size affects people behind them, not their
  // wait to reach the gate.
  const guestsToServeBeforeTurn = Math.max(0, Number(guestsAhead) || 0);
  const rawWait = guestsToServeBeforeTurn === 0
    ? 1
    : Math.ceil(guestsToServeBeforeTurn / (throughputPer15Minutes / 15));

  return {
    estimatedWaitMinutes: Math.min(MAX_ESTIMATED_WAIT_MINUTES, Math.max(1, rawWait)),
    estimateBasis: recentCheckins > 0
      ? 'RECENT_QR_THROUGHPUT'
      : 'PARTNER_CONFIGURED_FALLBACK',
    confidence: recentCheckins >= 5 ? 'HIGH' : recentCheckins > 0 ? 'MEDIUM' : 'LOW',
  };
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
      maxReadyGuests: metrics?.policy?.maxReadyGuests
        ?? DEFAULT_QUEUE_POLICY.maxReadyGuests,
      maxActiveParties: metrics?.policy?.maxActiveParties
        ?? DEFAULT_QUEUE_POLICY.maxActiveParties,
      admissionMethod: 'STAFF_QR_CHECKIN',
      partyAdmissionRule: 'FIRST_VALID_QR_CLOSES_QUEUE_ENTRY',
      serviceScope: 'VIETTICKET_MANAGED_ARRIVAL_FLOW',
      mode: metrics?.policy?.mode || null,
      enabled: metrics?.policy?.enabled ?? false,
      configured: metrics?.policy?.configured ?? false,
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

async function findQueueEntryByBooking(prismaClient, bookingId) {
  if (!bookingId || !prismaClient?.smartQueueEntry?.findUnique) return null;
  return prismaClient.smartQueueEntry.findUnique({
    where: { bookingId },
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

async function getQueueAvailabilityForItem(item, {
  prismaClient = prisma,
  now = new Date(),
  pressure: providedPressure = null,
} = {}) {
  const referenceNow = normalizeNow(now);
  try {
    if (item?.smartQueueEntry) {
      return {
        eligible: false,
        code: 'QUEUE_ALREADY_ENROLLED',
        message: 'Hoạt động này đã có lịch sử SmartQueue.',
      };
    }
    const policy = item?.attractionId
      ? await getQueuePolicy(item.attractionId, { prismaClient })
      : { ...DEFAULT_QUEUE_POLICY };
    if (!policy.enabled) {
      throw createHttpError(
        409,
        'QUEUE_DISABLED',
        'Đối tác chưa kích hoạt luồng vào cổng SmartQueue cho điểm tham quan này.',
      );
    }
    if (policy.pausedAt) {
      throw createHttpError(
        409,
        'QUEUE_PAUSED',
        `SmartQueue đang tạm dừng${policy.pauseReason ? `: ${policy.pauseReason}` : '.'}`,
      );
    }
    const eligibility = assertQueueEligibility(item, referenceNow, policy);
    const rawPressure = providedPressure || await getAttractionPressure(
      item.attractionId,
      eligibility.visitDateKey,
      { prismaClient, now: referenceNow },
    );
    const pressure = selectQueuePressure(rawPressure, item);
    if (!pressure) {
      throw createHttpError(
        503,
        'QUEUE_PRESSURE_UNAVAILABLE',
        'Hệ thống chưa đủ dữ liệu áp lực trực tiếp để mở SmartQueue. Vui lòng thử lại sau ít phút.',
      );
    }
    if (pressure.isClosed) {
      throw createHttpError(
        409,
        'QUEUE_ATTRACTION_CLOSED',
        'Điểm tham quan đang đóng cửa, chưa thể tham gia SmartQueue.',
      );
    }
    if (Number(pressure.summary?.score || 0) < 70) {
      throw createHttpError(
        409,
        'QUEUE_NOT_NEEDED',
        'Khung giờ hiện chưa đông; bạn có thể đến cổng check-in trực tiếp.',
      );
    }
    await assertQueueHasCapacity({
      attractionId: item.attractionId,
      visitDate: eligibility.visitDate,
      policy,
      prismaClient,
      now: referenceNow,
    });
    return {
      eligible: true,
      code: 'QUEUE_AVAILABLE',
      message: 'SmartQueue đang nhận lượt cho booking này.',
      pressureScope: pressure.pressureScope || 'ATTRACTION_DAY',
      opensBeforeMinutes: policy.openBeforeMinutes,
    };
  } catch (error) {
    if (!error?.statusCode) throw error;
    return {
      eligible: false,
      code: error.code || 'QUEUE_UNAVAILABLE',
      message: error.message,
    };
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
    const expired = await runSerializableTransaction(prismaClient, async (tx) => {
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

  if (
    !policy.pausedAt
    && entry.status === 'READY'
    && entry.readyExpiresAt
    && referenceNow >= entry.readyExpiresAt
  ) {
    const noShow = await runSerializableTransaction(prismaClient, async (tx) => {
      const txPolicy = tx !== prismaClient && tx.smartQueuePolicy?.findUnique
        ? await getQueuePolicy(entry.attractionId, { prismaClient: tx })
        : policy;
      if (!txPolicy.enabled || txPolicy.pausedAt) return null;
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
  const ahead = await getAheadMetrics(entry, prismaClient, referenceNow);
  const hasRecentAdmission = Number(pressure.summary?.checkinsLast15Minutes || 0) > 0;
  const shouldAttemptReady = policy.enabled
    && !policy.pausedAt
    && policy.mode === 'AUTO'
    && entry.status === 'WAITING'
    && normalizedDate(entry.liveTripItem?.scheduledStart)
    && referenceNow >= new Date(
      normalizedDate(entry.liveTripItem.scheduledStart).getTime() - QUEUE_CALL_BEFORE_MS,
    )
    && !pressure.isClosed
    && (
      Number(pressure.summary?.score || 0) <= QUEUE_READY_MAX_PRESSURE
      || hasRecentAdmission
    );

  let current = entry;
  if (shouldAttemptReady) {
    const readyAt = referenceNow;
    let updated = null;
    try {
      updated = await runSerializableTransaction(prismaClient, async (tx) => {
        const canReReadState = Boolean(
          tx !== prismaClient
          && tx.smartQueueEntry?.findUnique,
        );
        const txEntry = canReReadState
          ? await tx.smartQueueEntry.findUnique({
            where: { id: entry.id },
            include: QUEUE_ENTRY_INCLUDE,
          })
          : entry;
        const txScheduledStart = normalizedDate(txEntry?.liveTripItem?.scheduledStart);
        const txExpiresAt = normalizedDate(txEntry?.expiresAt);
        if (
          !txEntry
          || txEntry.status !== 'WAITING'
          || !txExpiresAt
          || txExpiresAt <= referenceNow
          || txEntry.attraction?.operationalStatus === 'SUSPENDED'
          || (txEntry.booking?.status && txEntry.booking.status !== 'CONFIRMED')
          || (txEntry.booking?.ticketInstances?.length || 0) > 0
          || !txScheduledStart
          || referenceNow < new Date(txScheduledStart.getTime() - QUEUE_CALL_BEFORE_MS)
        ) return null;

        // Re-read operational policy after acquiring the serializable
        // transaction. A pause or mode switch may have committed after the
        // worker's preflight read.
        const txPolicy = tx.smartQueuePolicy?.findUnique
          ? await getQueuePolicy(txEntry.attractionId, { prismaClient: tx })
          : policy;
        if (!txPolicy.enabled || txPolicy.pausedAt || txPolicy.mode !== 'AUTO') return null;
        const graceExpiresAt = new Date(
          readyAt.getTime() + Math.max(1, Number(txPolicy.readyGraceMinutes) || 10) * 60 * 1000,
        );
        const readyExpiresAt = new Date(Math.min(
          txExpiresAt.getTime(),
          graceExpiresAt.getTime(),
        ));
        // The FIFO and gate-capacity reads must live in the same serializable
        // transaction as the transition. This prevents two app instances from
        // calling different parties concurrently and overfilling the return window.
        const [waitingAhead, readyCount, readyGuestsResult] = await Promise.all([
          getWaitingAheadCount(txEntry, tx, referenceNow),
          tx.smartQueueEntry.count({
            where: {
              attractionId: txEntry.attractionId,
              visitDate: txEntry.visitDate,
              ...queueScopeWhere(txEntry),
              status: 'READY',
              expiresAt: { gt: referenceNow },
              OR: [
                { readyExpiresAt: null },
                { readyExpiresAt: { gt: referenceNow } },
              ],
            },
          }),
          tx.smartQueueEntry.aggregate
            ? tx.smartQueueEntry.aggregate({
              where: {
                attractionId: txEntry.attractionId,
                visitDate: txEntry.visitDate,
                ...queueScopeWhere(txEntry),
                status: 'READY',
                expiresAt: { gt: referenceNow },
                OR: [
                  { readyExpiresAt: null },
                  { readyExpiresAt: { gt: referenceNow } },
                ],
              },
              _sum: { partySize: true },
            })
            : Promise.resolve({ _sum: { partySize: 0 } }),
        ]);
        const readyGuests = Number(readyGuestsResult?._sum?.partySize || 0);
        const incomingGuests = Math.max(1, Number(txEntry.partySize) || 1);
        if (
          Number(waitingAhead || 0) > 0
          || Number(readyCount || 0) >= Math.max(1, Number(txPolicy.maxReadyParties) || 3)
          || readyGuests + incomingGuests > Math.max(
            1,
            Number(txPolicy.maxReadyGuests) || DEFAULT_QUEUE_POLICY.maxReadyGuests,
          )
        ) return null;

        const result = await tx.smartQueueEntry.updateMany({
          where: { id: txEntry.id, status: 'WAITING', expiresAt: { gt: referenceNow } },
          data: {
            status: 'READY',
            readyAt,
            calledAt: readyAt,
            readyExpiresAt,
          },
        });
        if (result.count !== 1) return null;
        await recordLiveTripEvent({
          client: tx,
          liveTripId: txEntry.liveTripId,
          liveTripItemId: txEntry.liveTripItemId,
          userId: txEntry.userId,
          type: 'QUEUE_READY',
          severity: 'SUCCESS',
          title: 'Đã đến lượt vào cổng',
          message: 'Vui lòng di chuyển đến cổng và mở mã QR để nhân viên check-in.',
          data: { queueEntryId: txEntry.id, pressureScore: pressure.summary?.score ?? null },
        });
        return {
          ...txEntry,
          status: 'READY',
          readyAt,
          calledAt: readyAt,
          readyExpiresAt,
        };
      });
    } catch (error) {
      // A serialization conflict simply means another worker won the race.
      // The next sweep will re-evaluate FIFO from committed state.
      if (error?.code !== 'P2034') throw error;
    }
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
    policy,
  });
  return serializeQueueEntry(current, {
    ...ahead,
    ...estimate,
    policy: {
      mode: policy.mode,
      enabled: policy.enabled,
      configured: policy.configured,
      paused: Boolean(policy.pausedAt),
      pauseReason: policy.pauseReason,
      openBeforeMinutes: policy.openBeforeMinutes,
      readyGraceMinutes: policy.readyGraceMinutes,
      maxReadyGuests: policy.maxReadyGuests,
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
  const policy = await getQueuePolicy(entry.attractionId, { prismaClient });
  if (referenceNow >= entry.expiresAt) {
    return serializeQueueEntry({ ...entry, status: 'EXPIRED' });
  }
  if (
    !policy.pausedAt
    && entry.status === 'READY'
    && entry.readyExpiresAt
    && referenceNow >= entry.readyExpiresAt
  ) {
    return serializeQueueEntry({ ...entry, status: 'NO_SHOW', noShowAt: referenceNow });
  }

  const rawPressure = providedPressure || await getAttractionPressure(
    entry.attractionId,
    getDateKey(entry.visitDate),
    { prismaClient, now: referenceNow },
  );
  const pressure = selectQueuePressure(rawPressure, entry);
  const ahead = await getAheadMetrics(entry, prismaClient, referenceNow);
  const estimate = buildWaitEstimate({
    entry,
    guestsAhead: ahead.guestsAhead,
    pressure,
    policy,
  });
  return serializeQueueEntry(entry, {
    ...ahead,
    ...estimate,
    policy: {
      mode: policy.mode,
      enabled: policy.enabled,
      configured: policy.configured,
      paused: Boolean(policy.pausedAt),
      pauseReason: policy.pauseReason,
      openBeforeMinutes: policy.openBeforeMinutes,
      readyGraceMinutes: policy.readyGraceMinutes,
      maxReadyGuests: policy.maxReadyGuests,
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
  if (!policy.enabled) {
    throw createHttpError(
      409,
      'QUEUE_DISABLED',
      'Đối tác chưa kích hoạt luồng vào cổng SmartQueue cho điểm tham quan này.',
    );
  }
  if (policy.pausedAt) {
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

  let entry;
  let joinedExistingBooking = null;

  try {
    const outcome = await runSerializableTransaction(prismaClient, async (tx) => {
      // Preflight reads are only an early UX guard. Re-read the booking item
      // and policy inside the serializable transaction so a concurrent pause,
      // readiness change, cancellation, or QR admission cannot be followed by
      // a stale queue insert.
      let txItem = item;
      if (tx.liveTripItem?.findFirst) {
        const reloadedItem = await loadOwnedItem(tx, tripId, itemId, userId);
        if (!reloadedItem) {
          throw createHttpError(
            409,
            'QUEUE_STATE_CHANGED',
            'Booking hoặc chuyến đi vừa thay đổi. Vui lòng tải lại trạng thái.',
          );
        }
        txItem = reloadedItem;
      }
      const txPolicy = tx.smartQueuePolicy?.findUnique
        ? await getQueuePolicy(txItem.attractionId, { prismaClient: tx })
        : policy;
      if (!txPolicy.enabled) {
        throw createHttpError(
          409,
          'QUEUE_DISABLED',
          'SmartQueue vừa được tắt hoặc chưa xác nhận sẵn sàng vận hành.',
        );
      }
      if (txPolicy.pausedAt) {
        throw createHttpError(409, 'QUEUE_PAUSED', 'SmartQueue vừa được tạm dừng tại điểm tham quan.');
      }
      const txEligibility = assertQueueEligibility(txItem, referenceNow, txPolicy);
      if (txItem.booking?.userId !== userId) {
        throw createHttpError(403, 'QUEUE_BOOKING_FORBIDDEN', 'Booking không thuộc tài khoản hiện tại.');
      }

      const existingForBooking = tx.smartQueueEntry?.findUnique
        ? await tx.smartQueueEntry.findUnique({
          where: { bookingId: txItem.bookingId },
          select: { id: true, liveTripItemId: true, status: true },
        })
        : null;
      if (existingForBooking) {
        return { entry: null, existingForBooking };
      }
      await assertQueueHasCapacity({
        attractionId: txItem.attractionId,
        visitDate: txEligibility.visitDate,
        policy: txPolicy,
        prismaClient: tx,
        now: referenceNow,
      });
      const data = queueJoinData(txItem, txEligibility, userId, referenceNow);
      const saved = await tx.smartQueueEntry.create({
        data,
      });
      await recordQueueJoined({
        tx,
        item: txItem,
        userId,
        entry: saved,
        eligibility: txEligibility,
        pressure,
      });
      return { entry: saved, existingForBooking: null };
    });
    entry = outcome.entry;
    joinedExistingBooking = outcome.existingForBooking;
  } catch (error) {
    // unique(liveTripItemId) and unique(bookingId) enforce one enrolment;
    // serializable isolation keeps the capacity check correct under concurrent joins.
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
    const concurrentEntry = await findQueueEntryByItem(prismaClient, item.id)
      || await findQueueEntryByBooking(prismaClient, item.bookingId);
    if (joinedExistingBooking && !concurrentEntry && joinedExistingBooking.liveTripItemId !== item.id) {
      throw createHttpError(
        409,
        'QUEUE_BOOKING_ALREADY_ENROLLED',
        'Booking này đã được dùng để tham gia SmartQueue trong một lịch trình khác.',
      );
    }
    if (concurrentEntry && ACTIVE_QUEUE_STATUSES.includes(concurrentEntry.status)) {
      if (concurrentEntry.liveTripItemId !== item.id) {
        throw createHttpError(
          409,
          'QUEUE_BOOKING_ALREADY_ENROLLED',
          'Booking này đã có một lượt SmartQueue đang hoạt động trong lịch trình khác.',
        );
      }
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
  if ((entry.booking?.ticketInstances?.length || 0) > 0) {
    await markQueueAdmittedForBooking(entry.bookingId, {
      prismaClient,
      admittedAt: referenceNow,
    });
    const admitted = await findQueueEntryByItem(prismaClient, entry.liveTripItemId);
    if (admitted?.status === 'ADMITTED') return serializeQueueEntry(admitted);
    throw createHttpError(
      409,
      'QUEUE_ALREADY_ADMITTED',
      'Booking đã có vé check-in nên lượt SmartQueue không thể bị hủy.',
    );
  }

  const cancelledAt = referenceNow;
  const cancelled = await runSerializableTransaction(prismaClient, async (tx) => {
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
  {
    prismaClient = prisma,
    admittedAt = new Date(),
    emitRealtime = true,
  } = {},
) {
  const referenceNow = normalizeNow(admittedAt);
  if (!prismaClient?.smartQueueEntry?.findMany) {
    return { count: 0, entryIds: [], updates: [] };
  }
  const entries = await prismaClient.smartQueueEntry.findMany({
    // A successful QR scan is the source of truth for physical admission.
    // It must repair a stale CANCELLED/NO_SHOW/EXPIRED queue state as well as
    // close an active one when the two operations race.
    where: { bookingId, status: { not: 'ADMITTED' } },
    include: QUEUE_ENTRY_INCLUDE,
  });
  const admitted = [];
  const updates = [];

  for (const entry of entries || []) {
    const updated = await runSerializableTransaction(prismaClient, async (tx) => {
      const result = await tx.smartQueueEntry.updateMany({
        where: { id: entry.id, status: { not: 'ADMITTED' } },
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
        data: {
          queueEntryId: entry.id,
          bookingId,
          previousStatus: entry.status,
        },
      });
      return true;
    });
    if (!updated) continue;
    admitted.push(entry.id);
    updates.push({
      customerId: entry.userId,
      tripId: entry.liveTripId,
      itemId: entry.liveTripItemId,
      queueStatus: 'ADMITTED',
      reason: 'QUEUE_ADMITTED',
    });
  }

  if (emitRealtime) emitQueueAdmissionUpdates(updates);
  return { count: admitted.length, entryIds: admitted, updates };
}

function emitQueueAdmissionUpdates(updates = []) {
  for (const update of updates) emitLiveTripUpdated(update);
}

async function sweepSmartQueues({ prismaClient = prisma, now = new Date() } = {}) {
  const referenceNow = normalizeNow(now);
  let ready = 0;
  let expired = 0;
  let admitted = 0;
  let cancelled = 0;
  let scanned = 0;
  let lastId = null;

  // Process every active entry in bounded pages. A single global `take` with
  // updatedAt ordering can repeatedly select old waiting parties and starve
  // newer attractions indefinitely.
  while (true) {
    const entries = await prismaClient.smartQueueEntry.findMany({
      where: {
        status: { in: ACTIVE_QUEUE_STATUSES },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: QUEUE_SWEEP_LIMIT,
      include: QUEUE_ENTRY_INCLUDE,
    });
    if (!entries?.length) break;
    scanned += entries.length;

    for (const entry of entries) {
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
        if (entry.booking?.status && entry.booking.status !== 'CONFIRMED') {
          const cancelledAt = referenceNow;
          const didCancel = await runSerializableTransaction(prismaClient, async (tx) => {
            const txEntry = tx !== prismaClient && tx.smartQueueEntry?.findUnique
              ? await tx.smartQueueEntry.findUnique({
                where: { id: entry.id },
                include: QUEUE_ENTRY_INCLUDE,
              })
              : entry;
            if (
              !txEntry
              || !ACTIVE_QUEUE_STATUSES.includes(txEntry.status)
              || !txEntry.booking?.status
              || txEntry.booking.status === 'CONFIRMED'
              || (txEntry.booking.ticketInstances?.length || 0) > 0
            ) return false;
            const result = await tx.smartQueueEntry.updateMany({
              where: { id: txEntry.id, status: { in: ACTIVE_QUEUE_STATUSES } },
              data: { status: 'CANCELLED', cancelledAt },
            });
            if (result.count !== 1) return false;
            await recordLiveTripEvent({
              client: tx,
              liveTripId: txEntry.liveTripId,
              liveTripItemId: txEntry.liveTripItemId,
              userId: txEntry.userId,
              type: 'QUEUE_CANCELLED',
              severity: 'WARNING',
              title: 'SmartQueue đã kết thúc theo trạng thái booking',
              message: 'Booking không còn ở trạng thái xác nhận nên lượt SmartQueue được đóng tự động; quyền lợi vé áp dụng theo trạng thái booking hiện tại.',
              data: {
                queueEntryId: txEntry.id,
                bookingId: txEntry.bookingId,
                bookingStatus: txEntry.booking.status,
              },
            });
            return true;
          });
          if (didCancel) {
            cancelled += 1;
            emitLiveTripUpdated({
              customerId: entry.userId,
              tripId: entry.liveTripId,
              itemId: entry.liveTripItemId,
              queueStatus: 'CANCELLED',
              reason: 'QUEUE_BOOKING_INVALIDATED',
            });
          }
          continue;
        }
        const state = await refreshQueueRecord(entry, { prismaClient, now: referenceNow });
        if (entry.status === 'WAITING' && state.status === 'READY') ready += 1;
        if (ACTIVE_QUEUE_STATUSES.includes(entry.status) && state.status === 'EXPIRED') expired += 1;
      } catch (error) {
        console.error(`[smart-queue] Không thể làm mới ${entry.id}:`, error.message);
      }
    }
    lastId = entries[entries.length - 1].id;
    if (entries.length < QUEUE_SWEEP_LIMIT) break;
  }

  return { scanned, ready, admitted, expired, cancelled };
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
  getQueueAvailabilityForItem,
  getQueuePolicy,
  getQueueSnapshot,
  joinQueue,
  emitQueueAdmissionUpdates,
  markQueueAdmittedForBooking,
  refreshQueueRecord,
  runSerializableTransaction,
  selectQueuePressure,
  serializeQueueEntry,
  sweepSmartQueues,
};
