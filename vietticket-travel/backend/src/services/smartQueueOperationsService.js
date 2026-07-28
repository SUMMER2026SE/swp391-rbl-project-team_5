'use strict';

const prisma = require('../config/prisma');
const { emitLiveTripUpdated } = require('../realtime/events');
const {
  getAttractionPressure,
  getDateKey,
  getVietnamDateKey,
} = require('./arrivalPressureService');
const { recordLiveTripEvent } = require('./liveTripEventService');
const {
  DEFAULT_QUEUE_POLICY,
  markQueueAdmittedForBooking,
  runSerializableTransaction,
  selectQueuePressure,
} = require('./smartQueueService');

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
  attraction: { select: { id: true, title: true, city: true, operationalStatus: true } },
  liveTripItem: { select: { scheduledStart: true, scheduledEnd: true } },
  booking: {
    select: {
      status: true,
      fullName: true,
      reservation: { select: { timeSlotId: true } },
      ticketInstances: {
        where: { status: 'USED' },
        select: { id: true },
        take: 1,
      },
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

function assertEntryOperationalState(entry) {
  if (entry.attraction?.operationalStatus === 'SUSPENDED') {
    throw httpError(
      409,
      'QUEUE_ATTRACTION_SUSPENDED',
      'Điểm tham quan đang tạm ngừng vận hành; không được gọi lượt hoặc ghi nhận no-show.',
    );
  }
  if (entry.booking?.status && entry.booking.status !== 'CONFIRMED') {
    throw httpError(
      409,
      'QUEUE_BOOKING_NOT_CONFIRMED',
      'Booking không còn ở trạng thái xác nhận; lượt SmartQueue sẽ được đóng theo booking.',
    );
  }
  if ((entry.booking?.ticketInstances?.length || 0) > 0) {
    throw httpError(
      409,
      'QUEUE_ALREADY_ADMITTED',
      'Booking đã check-in nên không thể gọi lượt hoặc ghi nhận no-show.',
    );
  }
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
    ['maxReadyGuests', 1, 1000],
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
  if (!prismaClient?.smartQueuePolicy?.findUnique) {
    return { ...DEFAULT_QUEUE_POLICY, configured: false };
  }
  const policy = await prismaClient.smartQueuePolicy.findUnique({ where: { attractionId } });
  const merged = { ...DEFAULT_QUEUE_POLICY, ...(policy || {}), configured: Boolean(policy) };
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

async function listQueueOperations({ attractionId, date, prismaClient = prisma, now = new Date() } = {}) {
  const normalizedAttractionId = String(attractionId || '').trim();
  if (!normalizedAttractionId) throw httpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  const visitDate = normalizeDateKey(date || getVietnamDateKey(now));
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
  const referenceNow = new Date(now);
  const liveReadyEntries = active.filter((entry) => (
    entry.status === 'READY'
    && (
      policy.pausedAt
      || !entry.readyExpiresAt
      || new Date(entry.readyExpiresAt) > referenceNow
    )
  ));
  const liveReadyIds = new Set(liveReadyEntries.map((entry) => entry.id));
  const waitingPositions = new Map();
  const readyCounts = active.reduce((counts, entry) => {
    if (!liveReadyIds.has(entry.id)) return counts;
    const scopeKey = entry.booking?.reservation?.timeSlotId || 'UNTIMED';
    counts.set(scopeKey, (counts.get(scopeKey) || 0) + 1);
    return counts;
  }, new Map());
  const readyGuestCounts = liveReadyEntries.reduce((counts, entry) => {
    const scopeKey = entry.booking?.reservation?.timeSlotId || 'UNTIMED';
    counts.set(scopeKey, (counts.get(scopeKey) || 0) + Math.max(1, Number(entry.partySize) || 1));
    return counts;
  }, new Map());
  return {
    date: getDateKey(visitDate),
    policy,
    pressure,
    summary: {
      waitingParties: active.filter((entry) => entry.status === 'WAITING').length,
      readyParties: liveReadyEntries.length,
      waitingGuests: active
        .filter((entry) => entry.status === 'WAITING')
        .reduce((sum, entry) => sum + Number(entry.partySize || 0), 0),
      readyGuests: liveReadyEntries
        .reduce((sum, entry) => sum + Number(entry.partySize || 0), 0),
      activeGuests: active
        .filter((entry) => entry.status === 'WAITING' || liveReadyIds.has(entry.id))
        .reduce((sum, entry) => sum + Number(entry.partySize || 0), 0),
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
        readyGuestsInScope: readyGuestCounts.get(scopeKey) || 0,
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
  if (
    ['WAITING', 'READY'].includes(entry.status)
    && (entry.booking?.ticketInstances?.length || 0) > 0
  ) {
    // QR check-in is the source of truth. Reconcile a rare hook failure before
    // staff can accidentally call or no-show an already admitted party.
    await markQueueAdmittedForBooking(entry.bookingId, { prismaClient, admittedAt: new Date(now) });
    throw httpError(
      409,
      'QUEUE_ALREADY_ADMITTED',
      'Booking đã có vé check-in; lượt SmartQueue đã được đồng bộ sang ADMITTED.',
    );
  }
  assertEntryOperationalState(entry);

  if (normalizedAction === 'CALL') {
    if (!policy.enabled) {
      throw httpError(
        409,
        'QUEUE_DISABLED',
        'SmartQueue chưa được đối tác xác nhận sẵn sàng vận hành.',
      );
    }
    if (policy.pausedAt) throw httpError(409, 'QUEUE_PAUSED', 'SmartQueue đang tạm dừng.');
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
    let calledResult;
    try {
      calledResult = await runSerializableTransaction(prismaClient, async (tx) => {
        // The outer entry/policy reads are an early validation only. Real
        // Prisma transactions expose both delegates, so re-read them here
        // before counting capacity and changing state. (Minimal legacy test
        // doubles may omit one delegate and intentionally fall back.)
        const canReReadState = Boolean(
          tx.smartQueueEntry?.findUnique
          && tx.smartQueuePolicy?.findUnique,
        );
        const txEntry = canReReadState
          ? await tx.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT })
          : entry;
        if (!txEntry) {
          throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt vừa được xử lý bởi nhân viên khác.');
        }
        assertEntryOperationalState(txEntry);
        const txPolicy = tx.smartQueuePolicy?.findUnique
          ? await getPolicy(txEntry.attractionId, { prismaClient: tx })
          : policy;
        if (!txPolicy.enabled) {
          throw httpError(409, 'QUEUE_DISABLED', 'SmartQueue vừa được tắt hoặc chưa sẵn sàng vận hành.');
        }
        if (txPolicy.pausedAt) {
          throw httpError(409, 'QUEUE_PAUSED', 'SmartQueue vừa được tạm dừng.');
        }
        if (txEntry.status !== 'WAITING') {
          if (txEntry.status === 'ADMITTED') {
            throw httpError(409, 'QUEUE_ALREADY_ADMITTED', 'Lượt này đã check-in.');
          }
          if (txEntry.status === 'READY') {
            throw httpError(409, 'QUEUE_ALREADY_CALLED', 'Lượt này đã được gọi và đang trong cửa sổ quay lại.');
          }
          throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt này không còn ở trạng thái có thể gọi.');
        }
        const txScheduledStart = new Date(txEntry.liveTripItem?.scheduledStart);
        if (!Number.isFinite(txScheduledStart.getTime())) {
          throw httpError(
            409,
            'QUEUE_SCHEDULE_UNAVAILABLE',
            'Không xác định được giờ tham quan nên chưa thể gọi khách an toàn.',
          );
        }
        if (calledAt < new Date(txScheduledStart.getTime() - QUEUE_CALL_BEFORE_MS)) {
          throw httpError(
            409,
            'QUEUE_CALL_TOO_EARLY',
            'Chỉ có thể gọi khách từ 15 phút trước giờ tham quan để tránh làm hết cửa sổ quay lại quá sớm.',
          );
        }
        const txGraceExpiresAt = new Date(
          calledAt.getTime() + Math.max(1, Number(txPolicy.readyGraceMinutes) || 10) * 60 * 1000,
        );
        const txReadyExpiresAt = new Date(Math.min(
          new Date(txEntry.expiresAt).getTime(),
          txGraceExpiresAt.getTime(),
        ));
        const [waitingAhead, readyCount, readyGuestsResult] = await Promise.all([
          tx.smartQueueEntry.count({
            where: {
              attractionId: txEntry.attractionId,
              visitDate: txEntry.visitDate,
              ...queueScopeWhere(txEntry),
              status: 'WAITING',
              expiresAt: { gt: calledAt },
              OR: [
                { joinedAt: { lt: txEntry.joinedAt } },
                { joinedAt: txEntry.joinedAt, id: { lt: txEntry.id } },
              ],
            },
          }),
          tx.smartQueueEntry.count({
            where: {
              attractionId: txEntry.attractionId,
              visitDate: txEntry.visitDate,
              ...queueScopeWhere(txEntry),
              status: 'READY',
              expiresAt: { gt: calledAt },
              OR: [
                { readyExpiresAt: null },
                { readyExpiresAt: { gt: calledAt } },
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
                expiresAt: { gt: calledAt },
                OR: [
                  { readyExpiresAt: null },
                  { readyExpiresAt: { gt: calledAt } },
                ],
              },
              _sum: { partySize: true },
            })
            : Promise.resolve({ _sum: { partySize: 0 } }),
        ]);
        if (Number(waitingAhead || 0) > 0) {
          throw httpError(
            409,
            'QUEUE_FIFO_VIOLATION',
            'Phải gọi nhóm đầu hàng chờ trước để bảo toàn FIFO.',
          );
        }
        if (Number(readyCount || 0) >= Math.max(1, Number(txPolicy.maxReadyParties) || 3)) {
          throw httpError(
            409,
            'QUEUE_READY_CAPACITY_REACHED',
            'Đã đạt số nhóm tối đa trong cửa sổ quay lại. Hãy check-in hoặc xử lý no-show trước.',
          );
        }
        const readyGuests = Number(readyGuestsResult?._sum?.partySize || 0);
        const incomingGuests = Math.max(1, Number(txEntry.partySize) || 1);
        if (
          readyGuests + incomingGuests
          > Math.max(1, Number(txPolicy.maxReadyGuests) || DEFAULT_QUEUE_POLICY.maxReadyGuests)
        ) {
          throw httpError(
            409,
            'QUEUE_READY_GUEST_CAPACITY_REACHED',
            'Số khách trong cửa sổ quay lại đã đạt giới hạn an toàn tại cổng.',
          );
        }

        const result = await tx.smartQueueEntry.updateMany({
          where: { id, status: 'WAITING', expiresAt: { gt: calledAt } },
          data: {
            status: 'READY',
            readyAt: txEntry.readyAt || calledAt,
            readyExpiresAt: txReadyExpiresAt,
            calledAt,
            calledById: actorId,
          },
        });
        if (result.count !== 1) {
          throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt vừa được xử lý bởi nhân viên khác.');
        }
        await recordLiveTripEvent({
          client: tx,
          liveTripId: txEntry.liveTripId,
          liveTripItemId: txEntry.liveTripItemId,
          userId: txEntry.userId,
          type: 'QUEUE_CALLED',
          severity: 'SUCCESS',
          title: 'Nhân viên đã gọi lượt SmartQueue',
          message: 'Vui lòng di chuyển đến cổng trong thời gian hiển thị.',
          data: { queueEntryId: id, calledById: actorId, readyExpiresAt: txReadyExpiresAt },
        });
        return tx.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT });
      });
    } catch (error) {
      if (error?.code !== 'P2034') throw error;
      throw httpError(
        409,
        'QUEUE_STATE_CHANGED',
        'Hàng chờ vừa được xử lý đồng thời. Vui lòng tải lại trước khi gọi lượt tiếp theo.',
      );
    }
    emitLiveTripUpdated({
      customerId: calledResult?.userId || entry.userId,
      tripId: calledResult?.liveTripId || entry.liveTripId,
      itemId: calledResult?.liveTripItemId || entry.liveTripItemId,
      queueStatus: 'READY',
      reason: 'QUEUE_CALLED',
    });
    return calledResult;
  }

  if (entry.status !== 'READY') {
    throw httpError(409, 'QUEUE_NOT_READY', 'Chỉ lượt đã được gọi mới có thể đánh dấu no-show.');
  }
  if (!policy.enabled) {
    throw httpError(
      409,
      'QUEUE_DISABLED',
      'SmartQueue chưa được đối tác xác nhận sẵn sàng vận hành; không được ghi nhận no-show.',
    );
  }
  if (policy.pausedAt) {
    throw httpError(
      409,
      'QUEUE_PAUSED',
      'SmartQueue đang tạm dừng; cửa sổ quay lại được bảo lưu và chưa thể ghi nhận no-show.',
    );
  }
  const noShowAt = new Date(now);
  if (!entry.readyExpiresAt || noShowAt < new Date(entry.readyExpiresAt)) {
    throw httpError(
      409,
      'QUEUE_RETURN_WINDOW_ACTIVE',
      'Chưa thể ghi nhận no-show khi cửa sổ quay lại vẫn còn hiệu lực.',
    );
  }
  const noShowResult = await runSerializableTransaction(prismaClient, async (tx) => {
    const canReReadState = Boolean(
      tx.smartQueueEntry?.findUnique
      && tx.smartQueuePolicy?.findUnique,
    );
    const txEntry = canReReadState
      ? await tx.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT })
      : entry;
    if (!txEntry || txEntry.status !== 'READY') {
      throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt vừa được xử lý bởi nhân viên khác.');
    }
    assertEntryOperationalState(txEntry);
    const txPolicy = tx.smartQueuePolicy?.findUnique
      ? await getPolicy(txEntry.attractionId, { prismaClient: tx })
      : policy;
    if (!txPolicy.enabled) {
      throw httpError(
        409,
        'QUEUE_DISABLED',
        'SmartQueue vừa được tắt hoặc chưa sẵn sàng vận hành; không được ghi nhận no-show.',
      );
    }
    if (txPolicy.pausedAt) {
      throw httpError(
        409,
        'QUEUE_PAUSED',
        'SmartQueue vừa được tạm dừng; chưa thể ghi nhận no-show.',
      );
    }
    if (!txEntry.readyExpiresAt || noShowAt < new Date(txEntry.readyExpiresAt)) {
      throw httpError(
        409,
        'QUEUE_RETURN_WINDOW_ACTIVE',
        'Cửa sổ quay lại vẫn còn hiệu lực.',
      );
    }
    const result = await tx.smartQueueEntry.updateMany({
      // Keep the deadline guard in the UPDATE predicate as well as in the
      // preflight check; this makes stale staff clicks fail safely.
      where: {
        id,
        status: 'READY',
        readyExpiresAt: { lte: noShowAt },
      },
      data: { status: 'NO_SHOW', noShowAt },
    });
    if (result.count !== 1) throw httpError(409, 'QUEUE_STATE_CHANGED', 'Lượt vừa được xử lý bởi nhân viên khác.');
    await recordLiveTripEvent({
      client: tx,
      liveTripId: txEntry.liveTripId,
      liveTripItemId: txEntry.liveTripItemId,
      userId: txEntry.userId,
      type: 'QUEUE_NO_SHOW',
      severity: 'WARNING',
      title: 'Nhân viên xác nhận khách no-show',
      message: 'Lượt đã đóng do khách không đến cổng trong thời gian cho phép.',
      data: { queueEntryId: id, actorId },
    });
    return tx.smartQueueEntry.findUnique({ where: { id }, select: QUEUE_ENTRY_SELECT });
  });
  emitLiveTripUpdated({
    customerId: noShowResult?.userId || entry.userId,
    tripId: noShowResult?.liveTripId || entry.liveTripId,
    itemId: noShowResult?.liveTripItemId || entry.liveTripItemId,
    queueStatus: 'NO_SHOW',
    reason: 'QUEUE_NO_SHOW',
  });
  return noShowResult;
}

async function saveQueuePolicy({ attractionId, payload, actorId, prismaClient = prisma } = {}) {
  const id = String(attractionId || '').trim();
  if (!id) throw httpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  const data = normalizePolicyInput(payload);
  const referenceNow = new Date();
  return runSerializableTransaction(prismaClient, async (tx) => {
    const previous = await tx.smartQueuePolicy.findUnique({
      where: { attractionId: id },
    });
    const hasReadinessColumn = Boolean(
      previous && Object.prototype.hasOwnProperty.call(previous, 'operationalReadinessConfirmedAt'),
    );
    const previousOperationallyEnabled = previous?.enabled === true
      && (!hasReadinessColumn || Boolean(previous.operationalReadinessConfirmedAt));
    if (
      data.enabled === true
      && !previousOperationallyEnabled
      && payload?.operationalReadinessConfirmed !== true
    ) {
      throw httpError(
        409,
        'QUEUE_OPERATIONAL_READINESS_REQUIRED',
        'Cần xác nhận có nhân sự và luồng check-in VietTicket tại cổng trước khi bật SmartQueue.',
      );
    }
    if (data.enabled === false && previous?.enabled === true) {
      const activeEntries = await tx.smartQueueEntry.count({
        where: {
          attractionId: id,
          status: { in: ['WAITING', 'READY'] },
          expiresAt: { gt: referenceNow },
        },
      });
      if (Number(activeEntries || 0) > 0) {
        throw httpError(
          409,
          'QUEUE_ACTIVE_ENTRIES_EXIST',
          'Không thể tắt khi còn khách đang chờ. Hãy dùng tạm dừng khẩn cấp để bảo lưu quyền lợi và xử lý hết các lượt hiện tại.',
        );
      }
    }
    const readinessData = data.enabled === true && payload?.operationalReadinessConfirmed === true
      ? { operationalReadinessConfirmedAt: referenceNow }
      : {};
    return tx.smartQueuePolicy.upsert({
      where: { attractionId: id },
      create: { attractionId: id, ...data, ...readinessData, updatedById: actorId || null },
      update: { ...data, ...readinessData, updatedById: actorId || null },
    });
  });
}

async function setQueuePause({
  attractionId,
  paused,
  reason,
  actorId,
  prismaClient = prisma,
  now = new Date(),
} = {}) {
  const id = String(attractionId || '').trim();
  const text = String(reason || '').trim();
  const referenceNow = new Date(now);
  if (!id) throw httpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  if (paused && (text.length < 5 || text.length > 300)) {
    throw httpError(400, 'INVALID_QUEUE_REASON', 'Lý do tạm dừng phải có 5-300 ký tự.');
  }
  const result = await runSerializableTransaction(prismaClient, async (tx) => {
    const previous = tx.smartQueuePolicy?.findUnique
      ? await tx.smartQueuePolicy.findUnique({ where: { attractionId: id } })
      : prismaClient?.smartQueuePolicy?.findUnique
        ? await prismaClient.smartQueuePolicy.findUnique({ where: { attractionId: id } })
        : null;
    const hasReadinessColumn = Boolean(
      previous && Object.prototype.hasOwnProperty.call(
        previous,
        'operationalReadinessConfirmedAt',
      ),
    );
    const operationallyEnabled = previous?.enabled === true
      && (!hasReadinessColumn || Boolean(previous.operationalReadinessConfirmedAt));
    if (!operationallyEnabled) {
      throw httpError(
        409,
        'QUEUE_DISABLED',
        'SmartQueue chưa được đối tác xác nhận sẵn sàng vận hành nên không thể tạm dừng hoặc tiếp tục.',
      );
    }
    const wasPaused = Boolean(previous?.pausedAt);
    const pauseDurationMs = !paused && previous?.pausedAt
      ? Math.max(0, referenceNow.getTime() - new Date(previous.pausedAt).getTime())
      : 0;
    const stateChanged = wasPaused !== Boolean(paused);
    // Treat retries as idempotent. In particular, repeating PAUSE after a
    // successful response was lost must not reset pausedAt and shorten the
    // READY-window extension that will be applied on resume.
    if (!stateChanged) return { policy: previous, entries: [] };
    const data = paused
      ? { pausedAt: referenceNow, pausedById: actorId || null, pauseReason: text, updatedById: actorId || null }
      : { pausedAt: null, pausedById: null, pauseReason: null, updatedById: actorId || null };
    const policy = await tx.smartQueuePolicy.upsert({
      where: { attractionId: id },
      create: { attractionId: id, ...data },
      update: data,
    });

    const entries = await tx.smartQueueEntry.findMany({
      where: {
        attractionId: id,
        status: { in: ['WAITING', 'READY'] },
        expiresAt: { gt: referenceNow },
      },
      select: {
        id: true,
        liveTripId: true,
        liveTripItemId: true,
        userId: true,
        status: true,
        readyExpiresAt: true,
        expiresAt: true,
      },
      take: 10000,
    });
    if (!paused && pauseDurationMs > 0) {
      for (const entry of entries || []) {
        if (entry.status !== 'READY' || !entry.readyExpiresAt) continue;
        const extendedReadyDeadline = new Date(Math.min(
          new Date(entry.expiresAt).getTime(),
          new Date(entry.readyExpiresAt).getTime() + pauseDurationMs,
        ));
        if (extendedReadyDeadline > new Date(entry.readyExpiresAt)) {
          await tx.smartQueueEntry.updateMany({
            where: { id: entry.id, status: 'READY' },
            data: { readyExpiresAt: extendedReadyDeadline },
          });
        }
      }
    }
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
          ? `Hàng chờ đang tạm dừng: ${text}. Thứ tự và thời gian quay lại được bảo lưu trong giới hạn giờ vé.`
          : 'Hàng chờ đã hoạt động trở lại; thứ tự và thời gian quay lại đã được khôi phục trong giới hạn giờ vé.',
        data: {
          queueEntryId: entry.id,
          attractionId: id,
          reason: text || null,
          pauseDurationMs: paused ? null : pauseDurationMs,
        },
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
