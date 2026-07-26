'use strict';

const prisma = require('../config/prisma');
const { emitLiveTripUpdated } = require('../realtime/events');
const { getActivityWindow } = require('../utils/activityTime');
const {
  getAttractionPressure,
  getVietnamDateKey,
} = require('./arrivalPressureService');
const { recordLiveTripEvent } = require('./liveTripEventService');

const PRESSURE_RISK_THRESHOLD = 70;
const SAFE_SLOT_MAX_PRESSURE = PRESSURE_RISK_THRESHOLD - 1;
const AUTOPILOT_LOOKAHEAD_MS = 48 * 60 * 60 * 1000;
const PROPOSAL_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PROPOSAL_MIN_LIFETIME_MS = 10 * 60 * 1000;
const PROPOSAL_DECISION_BUFFER_MS = 30 * 60 * 1000;
const SCHEDULE_TRAVEL_BUFFER_MS = 30 * 60 * 1000;
const AUTOPILOT_SWEEP_LIMIT = 25;
const LIVE_PREDICTION_MAX_AGE_MS = 30 * 60 * 1000;

const AUTOPILOT_TRIP_INCLUDE = {
  items: {
    orderBy: [{ dayIndex: 'asc' }, { orderIndex: 'asc' }],
    include: {
      attraction: {
        select: {
          id: true,
          title: true,
          city: true,
          openTime: true,
          closeTime: true,
          operationalStatus: true,
        },
      },
      booking: {
        select: { id: true, status: true },
      },
    },
  },
  proposals: {
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  },
};

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeNow(now) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function getApplicableArrivalPrediction(prismaClient, item, pressure, now) {
  if (!prismaClient?.livePrediction?.findFirst) return null;
  const prediction = await prismaClient.livePrediction.findFirst({
    where: {
      attractionId: item.attractionId,
      predictionType: 'ARRIVALS',
      predictedAt: { gte: new Date(now.getTime() - LIVE_PREDICTION_MAX_AGE_MS) },
    },
    orderBy: { predictedAt: 'desc' },
    select: {
      predictedP50: true,
      predictedP90: true,
      confidence: true,
      modelVersion: true,
      usedFallback: true,
      horizonMinutes: true,
      predictedAt: true,
    },
  });
  if (
    !prediction
    || prediction.usedFallback
    || !['MEDIUM', 'HIGH'].includes(prediction.confidence)
  ) return null;

  const predictionEnd = new Date(
    new Date(prediction.predictedAt).getTime()
      + Number(prediction.horizonMinutes || 15) * 60 * 1000,
  );
  const scheduledStart = new Date(item.scheduledStart);
  if (scheduledStart > predictionEnd || itemEnd(item) <= now) return null;

  const capacity = Math.max(1, Number(pressure.summary?.capacity) || 1);
  const expectedArrivals = Math.max(1, capacity * 0.25);
  const burstRatioP90 = Number(prediction.predictedP90 || 0) / expectedArrivals;
  return {
    ...prediction,
    burstRatioP90: Math.round(burstRatioP90 * 1000) / 1000,
    pressureEquivalent: Math.min(100, Math.round(burstRatioP90 * PRESSURE_RISK_THRESHOLD)),
  };
}

function sameInstant(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return new Date(left).getTime() === new Date(right).getTime();
}

function vietnamTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function activityPartySize(item) {
  const ticketItems = item.snapshot?.activity?.ticketItems;
  if (!Array.isArray(ticketItems)) return 1;
  return Math.max(
    1,
    ticketItems.reduce((total, ticket) => total + Math.max(0, Number(ticket?.quantity) || 0), 0),
  );
}

function itemVisitDate(item) {
  return item.snapshot?.visitDate || getVietnamDateKey(item.scheduledStart);
}

function itemEnd(item) {
  const start = new Date(item.scheduledStart);
  const explicitEnd = item.scheduledEnd ? new Date(item.scheduledEnd) : null;
  return explicitEnd && explicitEnd > start
    ? explicitEnd
    : new Date(start.getTime() + 60 * 60 * 1000);
}

function intervalsConflict(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < new Date(rightEnd.getTime() + SCHEDULE_TRAVEL_BUFFER_MS)
    && leftEnd > new Date(rightStart.getTime() - SCHEDULE_TRAVEL_BUFFER_MS);
}

function hasTripScheduleConflict(tripItems, excludedItemId, startsAt, endsAt) {
  return tripItems.some((item) => {
    if (item.id === excludedItemId || item.status === 'SKIPPED') return false;
    const otherStart = new Date(item.scheduledStart);
    const otherEnd = itemEnd(item);
    if (getVietnamDateKey(otherStart) !== getVietnamDateKey(startsAt)) return false;
    return intervalsConflict(startsAt, endsAt, otherStart, otherEnd);
  });
}

function proposalExpiresAt(now, proposedStart) {
  const latestByLifetime = new Date(now.getTime() + PROPOSAL_MAX_LIFETIME_MS);
  const latestByActivity = new Date(proposedStart.getTime() - PROPOSAL_DECISION_BUFFER_MS);
  const desired = latestByActivity < latestByLifetime ? latestByActivity : latestByLifetime;
  const minimum = new Date(now.getTime() + PROPOSAL_MIN_LIFETIME_MS);
  return desired > minimum ? desired : minimum;
}

function findCurrentSlot(pressure, scheduledStart) {
  const currentTime = vietnamTime(scheduledStart);
  return (pressure.slots || []).find((slot) => slot.startTime === currentTime) || null;
}

function chooseSaferSlot({ item, tripItems, pressure, now, currentScoreOverride = null }) {
  const currentSlot = findCurrentSlot(pressure, item.scheduledStart);
  const currentScore = Math.max(
    Number(currentSlot?.score ?? pressure.summary?.score ?? 0),
    Number(currentScoreOverride || 0),
  );
  const partySize = activityPartySize(item);
  const date = new Date(`${itemVisitDate(item)}T00:00:00.000Z`);

  const candidates = (pressure.slots || [])
    .filter((slot) => (
      Number(slot.score) <= SAFE_SLOT_MAX_PRESSURE
      && Number(slot.score) < currentScore
      && Number(slot.availableTickets || 0) >= partySize
      && slot.startTime
      && slot.endTime
    ))
    .map((slot) => {
      const window = getActivityWindow({
        date,
        timeSlot: { startTime: slot.startTime, endTime: slot.endTime },
        attraction: item.attraction,
      });
      return { slot, startsAt: window.startsAt, endsAt: window.endsAt };
    })
    .filter((candidate) => (
      candidate.startsAt
      && candidate.endsAt
      && candidate.startsAt > new Date(
        now.getTime() + PROPOSAL_DECISION_BUFFER_MS + PROPOSAL_MIN_LIFETIME_MS,
      )
      && candidate.endsAt > candidate.startsAt
      && !hasTripScheduleConflict(
        tripItems,
        item.id,
        candidate.startsAt,
        candidate.endsAt,
      )
    ))
    .sort((left, right) => (
      Number(left.slot.score) - Number(right.slot.score)
      || left.startsAt - right.startsAt
    ));

  const selected = candidates[0] || null;
  return selected
    ? { ...selected, currentScore, partySize }
    : null;
}

async function expirePendingProposals(prismaClient, tripId, userId, now) {
  const expired = await prismaClient.liveTripProposal.findMany({
    where: { liveTripId: tripId, status: 'PENDING', expiresAt: { lte: now } },
    select: { id: true, liveTripItemId: true },
  });
  if (!expired?.length) return 0;

  const expiredItemIds = [];
  await prismaClient.$transaction(async (tx) => {
    for (const proposal of expired) {
      const updated = await tx.liveTripProposal.updateMany({
        where: { id: proposal.id, status: 'PENDING' },
        data: { status: 'EXPIRED', activeKey: null, decidedAt: now },
      });
      if (updated.count !== 1) continue;
      expiredItemIds.push(proposal.liveTripItemId);
      await tx.liveTripItem.updateMany({
        where: { id: proposal.liveTripItemId, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      await recordLiveTripEvent({
        client: tx,
        liveTripId: tripId,
        liveTripItemId: proposal.liveTripItemId,
        userId,
        type: 'AUTOPILOT_EXPIRED',
        severity: 'INFO',
        title: 'Đề xuất Autopilot đã hết hạn',
        message: 'Điều kiện vận hành đã thay đổi hoặc thời gian quyết định đã kết thúc.',
        data: { proposalId: proposal.id },
      });
    }
  });
  for (const itemId of expiredItemIds) {
    emitLiveTripUpdated({
      customerId: userId,
      tripId,
      itemId,
      reason: 'AUTOPILOT_EXPIRED',
    });
  }
  return expiredItemIds.length;
}

async function supersedePendingProposal({
  prismaClient,
  proposal,
  now,
}) {
  if (!proposal) return false;
  await prismaClient.$transaction(async (tx) => {
    await tx.liveTripProposal.updateMany({
      where: { id: proposal.id, status: 'PENDING' },
      data: { status: 'SUPERSEDED', activeKey: null, decidedAt: now },
    });
  });
  return true;
}

async function markItemAtRisk({
  prismaClient,
  trip,
  item,
  reasonCode,
  title,
  message,
  severity = 'WARNING',
  data = {},
}) {
  if (item.status === 'AT_RISK') return false;
  const result = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.liveTripItem.updateMany({
      where: { id: item.id, status: item.status },
      data: { status: 'AT_RISK' },
    });
    if (updated.count !== 1) return false;
    await recordLiveTripEvent({
      client: tx,
      liveTripId: trip.id,
      liveTripItemId: item.id,
      userId: trip.userId,
      type: 'ITEM_AT_RISK',
      severity,
      title,
      message,
      data: { reasonCode, ...data },
    });
    return true;
  });
  if (result) {
    emitLiveTripUpdated({
      customerId: trip.userId,
      tripId: trip.id,
      itemId: item.id,
      reason: 'ITEM_AT_RISK',
    });
  }
  return result;
}

async function markItemRecovered({ prismaClient, trip, item, proposal, now }) {
  if (proposal) {
    await supersedePendingProposal({ prismaClient, proposal, now });
  }
  if (item.status !== 'AT_RISK' && item.status !== 'REVISION_PROPOSED') return false;

  const changed = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.liveTripItem.updateMany({
      where: { id: item.id, status: { in: ['AT_RISK', 'REVISION_PROPOSED'] } },
      data: { status: 'PLANNED' },
    });
    if (updated.count !== 1) return false;
    await recordLiveTripEvent({
      client: tx,
      liveTripId: trip.id,
      liveTripItemId: item.id,
      userId: trip.userId,
      type: 'ITEM_RECOVERED',
      severity: 'SUCCESS',
      title: 'Điều kiện tham quan đã ổn định',
      message: 'Áp lực lượt đến đã giảm, hoạt động có thể tiếp tục theo lịch hiện tại.',
      data: { recoveredAt: now.toISOString() },
    });
    return true;
  });
  if (changed) {
    emitLiveTripUpdated({
      customerId: trip.userId,
      tripId: trip.id,
      itemId: item.id,
      reason: 'ITEM_RECOVERED',
    });
  }
  return changed;
}

async function markItemCompleted({ prismaClient, trip, item, proposal, now }) {
  if (proposal) await supersedePendingProposal({ prismaClient, proposal, now });
  const completed = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.liveTripItem.updateMany({
      where: { id: item.id, status: { notIn: ['COMPLETED', 'SKIPPED'] } },
      data: { status: 'COMPLETED' },
    });
    if (updated.count !== 1) return false;
    await recordLiveTripEvent({
      client: tx,
      liveTripId: trip.id,
      liveTripItemId: item.id,
      userId: trip.userId,
      type: 'ITEM_COMPLETED',
      severity: 'SUCCESS',
      title: 'Hoạt động đã hoàn thành',
      message: 'Booking đã hoàn tất check-in và hoạt động được đồng bộ vào hành trình trực tiếp.',
      data: { bookingId: item.bookingId, completedAt: now.toISOString() },
    });
    return true;
  });
  if (completed) {
    emitLiveTripUpdated({
      customerId: trip.userId,
      tripId: trip.id,
      itemId: item.id,
      reason: 'ITEM_COMPLETED',
    });
  }
  return completed;
}

async function markItemSkipped({
  prismaClient,
  trip,
  item,
  proposal,
  now,
  reasonCode = 'ACTIVITY_WINDOW_PASSED',
}) {
  if (proposal) await supersedePendingProposal({ prismaClient, proposal, now });
  if (['COMPLETED', 'SKIPPED'].includes(item.status)) return false;
  const skipped = await prismaClient.$transaction(async (tx) => {
    const updated = await tx.liveTripItem.updateMany({
      where: { id: item.id, status: { notIn: ['COMPLETED', 'SKIPPED'] } },
      data: { status: 'SKIPPED' },
    });
    if (updated.count !== 1) return false;
    await recordLiveTripEvent({
      client: tx,
      liveTripId: trip.id,
      liveTripItemId: item.id,
      userId: trip.userId,
      type: 'ITEM_SKIPPED',
      severity: 'INFO',
      title: 'Hoạt động đã được bỏ qua',
      message: 'Khung giờ tham quan đã kết thúc khi hoạt động chưa được liên kết booking; lịch sử được giữ lại để bạn theo dõi.',
      data: { reasonCode, skippedAt: now.toISOString(), bookingChanged: false },
    });
    return true;
  });
  if (skipped) {
    emitLiveTripUpdated({
      customerId: trip.userId,
      tripId: trip.id,
      itemId: item.id,
      reason: 'ITEM_SKIPPED',
    });
  }
  return skipped;
}

async function saveTimeShiftProposal({
  prismaClient,
  trip,
  item,
  candidate,
  pressure,
  existingProposal,
  now,
}) {
  const unchanged = existingProposal
    && sameInstant(existingProposal.originalStart, item.scheduledStart)
    && sameInstant(existingProposal.originalEnd, item.scheduledEnd)
    && sameInstant(existingProposal.proposedStart, candidate.startsAt)
    && sameInstant(existingProposal.proposedEnd, candidate.endsAt);
  if (unchanged) return { created: false, proposal: existingProposal };

  const rationale = `Khung ${candidate.slot.startTime} - ${candidate.slot.endTime} có áp lực ${candidate.slot.score}/100, thấp hơn mức ${candidate.currentScore}/100 của lịch hiện tại.`;
  const snapshot = {
    bookingChanged: false,
    currentPressure: {
      score: candidate.currentScore,
      level: pressure.summary?.level || null,
    },
    predictiveSignal: candidate.predictiveSignal || null,
    proposedSlot: {
      timeSlotId: candidate.slot.timeSlotId,
      startTime: candidate.slot.startTime,
      endTime: candidate.slot.endTime,
      score: candidate.slot.score,
      level: candidate.slot.level,
      availableTickets: candidate.slot.availableTickets,
    },
    partySize: candidate.partySize,
    safeguards: {
      requiresCustomerConfirmation: true,
      noLinkedBooking: true,
      noScheduleConflict: true,
      travelBufferMinutes: SCHEDULE_TRAVEL_BUFFER_MS / 60000,
    },
  };

  const result = await prismaClient.$transaction(async (tx) => {
    const proposal = await tx.liveTripProposal.upsert({
      where: { activeKey: item.id },
      create: {
        liveTripId: trip.id,
        liveTripItemId: item.id,
        activeKey: item.id,
        type: 'TIME_SHIFT',
        reasonCode: 'HIGH_ARRIVAL_PRESSURE',
        rationale,
        originalStart: item.scheduledStart,
        originalEnd: item.scheduledEnd,
        proposedStart: candidate.startsAt,
        proposedEnd: candidate.endsAt,
        snapshot,
        expiresAt: proposalExpiresAt(now, candidate.startsAt),
      },
      update: {
        type: 'TIME_SHIFT',
        status: 'PENDING',
        reasonCode: 'HIGH_ARRIVAL_PRESSURE',
        rationale,
        originalStart: item.scheduledStart,
        originalEnd: item.scheduledEnd,
        proposedStart: candidate.startsAt,
        proposedEnd: candidate.endsAt,
        snapshot,
        expiresAt: proposalExpiresAt(now, candidate.startsAt),
        decidedAt: null,
      },
    });
    await tx.liveTripItem.updateMany({
      where: { id: item.id, bookingId: null },
      data: { status: 'REVISION_PROPOSED' },
    });
    await recordLiveTripEvent({
      client: tx,
      liveTripId: trip.id,
      liveTripItemId: item.id,
      userId: trip.userId,
      type: 'AUTOPILOT_PROPOSED',
      severity: 'WARNING',
      title: 'Autopilot đề xuất đổi khung giờ',
      message: rationale,
      data: { proposalId: proposal.id, ...snapshot },
    });
    return proposal;
  });

  emitLiveTripUpdated({
    customerId: trip.userId,
    tripId: trip.id,
    itemId: item.id,
    proposalId: result.id,
    reason: 'AUTOPILOT_PROPOSED',
  });
  return { created: !existingProposal, proposal: result };
}

async function refreshTripAutopilot(
  tripId,
  userId,
  { prismaClient = prisma, now = new Date() } = {},
) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const referenceNow = normalizeNow(now);
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) throw createHttpError(400, 'TRIP_ID_REQUIRED', 'tripId là bắt buộc.');

  const trip = await prismaClient.liveTrip.findFirst({
    where: { id: normalizedTripId, userId, status: 'ACTIVE' },
    include: AUTOPILOT_TRIP_INCLUDE,
  });
  if (!trip) throw createHttpError(404, 'LIVE_TRIP_NOT_FOUND', 'Không tìm thấy chuyến đi đang hoạt động.');

  const expired = await expirePendingProposals(prismaClient, trip.id, trip.userId, referenceNow);
  const pendingByItem = new Map(
    (trip.proposals || [])
      .filter((proposal) => new Date(proposal.expiresAt) > referenceNow)
      .map((proposal) => [proposal.liveTripItemId, proposal]),
  );
  const lookaheadEnd = new Date(referenceNow.getTime() + AUTOPILOT_LOOKAHEAD_MS);
  const items = (trip.items || []).filter((item) => (
    !['COMPLETED', 'SKIPPED'].includes(item.status)
    && (
      item.booking?.status === 'COMPLETED'
      || itemEnd(item) <= referenceNow
      || (
        itemEnd(item) > referenceNow
        && new Date(item.scheduledStart) <= lookaheadEnd
      )
    )
  ));
  const stats = {
    evaluated: 0,
    atRisk: 0,
    protectedBookings: 0,
    skipped: 0,
    proposalsCreated: 0,
    proposalsReused: 0,
    recovered: 0,
    aiPredictionsUsed: 0,
    expired,
  };

  for (const item of items) {
    stats.evaluated += 1;
    const pendingProposal = pendingByItem.get(item.id) || null;

    if (item.booking?.status === 'COMPLETED') {
      await markItemCompleted({
        prismaClient,
        trip,
        item,
        proposal: pendingProposal,
        now: referenceNow,
      });
      continue;
    }

    if (item.booking && ['CANCELLED', 'REFUND_REQUESTED', 'REFUNDED', 'NO_SHOW'].includes(item.booking.status)) {
      await supersedePendingProposal({
        prismaClient,
        proposal: pendingProposal,
        now: referenceNow,
      });
      await markItemAtRisk({
        prismaClient,
        trip,
        item,
        reasonCode: 'BOOKING_NOT_USABLE',
        title: 'Booking không còn sử dụng được',
        message: 'Vui lòng kiểm tra trạng thái booking trước khi tiếp tục hoạt động này.',
        severity: 'CRITICAL',
        data: { bookingId: item.booking.id, bookingStatus: item.booking.status },
      });
      stats.atRisk += 1;
      continue;
    }

    if (itemEnd(item) <= referenceNow) {
      if (item.bookingId) {
        await markItemAtRisk({
          prismaClient,
          trip,
          item,
          reasonCode: 'BOOKING_WINDOW_PASSED',
          title: 'Khung giờ booking đã qua',
          message: 'Booking đã thanh toán được giữ nguyên; hoạt động cần được đối soát hoặc hỗ trợ thủ công vì chưa ghi nhận hoàn tất.',
          severity: 'WARNING',
          data: { bookingId: item.bookingId, bookingStatus: item.booking?.status || null },
        });
        stats.atRisk += 1;
      } else if (await markItemSkipped({
        prismaClient,
        trip,
        item,
        proposal: pendingProposal,
        now: referenceNow,
      })) {
        stats.skipped += 1;
      }
      continue;
    }

    if (!item.attractionId || !item.attraction || item.attraction.operationalStatus !== 'ACTIVE') {
      await supersedePendingProposal({
        prismaClient,
        proposal: pendingProposal,
        now: referenceNow,
      });
      await markItemAtRisk({
        prismaClient,
        trip,
        item,
        reasonCode: 'ATTRACTION_UNAVAILABLE',
        title: 'Điểm tham quan tạm ngưng',
        message: 'Autopilot không thay đổi booking; vui lòng theo dõi thông báo vận hành hoặc liên hệ hỗ trợ.',
        severity: 'CRITICAL',
      });
      stats.atRisk += 1;
      continue;
    }

    let pressure;
    try {
      pressure = await getAttractionPressure(
        item.attractionId,
        itemVisitDate(item),
        { prismaClient, now: referenceNow },
      );
    } catch (error) {
      if (error.statusCode === 404) continue;
      throw error;
    }

    const currentSlot = findCurrentSlot(pressure, item.scheduledStart);
    const currentScore = Number(currentSlot?.score ?? pressure.summary?.score ?? 0);
    const predictiveSignal = await getApplicableArrivalPrediction(
      prismaClient,
      item,
      pressure,
      referenceNow,
    );
    if (predictiveSignal) stats.aiPredictionsUsed += 1;
    const effectiveScore = Math.max(
      currentScore,
      Number(predictiveSignal?.pressureEquivalent || 0),
    );
    const isRisk = pressure.isClosed || effectiveScore >= PRESSURE_RISK_THRESHOLD;
    if (!isRisk) {
      if (await markItemRecovered({
        prismaClient,
        trip,
        item,
        proposal: pendingProposal,
        now: referenceNow,
      })) stats.recovered += 1;
      continue;
    }

    stats.atRisk += 1;
    if (item.bookingId) {
      await supersedePendingProposal({
        prismaClient,
        proposal: pendingProposal,
        now: referenceNow,
      });
      await markItemAtRisk({
        prismaClient,
        trip,
        item,
        reasonCode: pressure.isClosed ? 'ATTRACTION_CLOSED' : 'HIGH_ARRIVAL_PRESSURE',
        title: pressure.isClosed ? 'Điểm tham quan đang đóng cửa' : 'Khung giờ dự kiến đang đông',
        message: pressure.isClosed
          ? 'Booking được giữ nguyên để bảo vệ quyền lợi; hệ thống không tự ý đổi hoặc hủy vé.'
          : 'Booking đã thanh toán được giữ nguyên. Bạn có thể dùng SmartQueue khi đủ điều kiện trong ngày tham quan.',
        severity: pressure.isClosed ? 'CRITICAL' : 'WARNING',
        data: {
          bookingProtected: true,
          pressureScore: currentScore,
          effectivePressureScore: effectiveScore,
          predictiveSignal,
        },
      });
      stats.protectedBookings += 1;
      continue;
    }

    const candidate = pressure.isClosed
      ? null
      : chooseSaferSlot({
        item,
        tripItems: trip.items,
        pressure,
        now: referenceNow,
        currentScoreOverride: effectiveScore,
      });
    if (!candidate) {
      await supersedePendingProposal({
        prismaClient,
        proposal: pendingProposal,
        now: referenceNow,
      });
      await markItemAtRisk({
        prismaClient,
        trip,
        item,
        reasonCode: pressure.isClosed ? 'ATTRACTION_CLOSED' : 'NO_SAFE_SLOT',
        title: pressure.isClosed ? 'Điểm tham quan đang đóng cửa' : 'Chưa tìm thấy khung giờ thay thế an toàn',
        message: 'Autopilot chỉ đề xuất khi có đủ chỗ và không xung đột các hoạt động khác.',
        severity: pressure.isClosed ? 'CRITICAL' : 'WARNING',
        data: {
          pressureScore: currentScore,
          effectivePressureScore: effectiveScore,
          predictiveSignal,
        },
      });
      continue;
    }

    const saved = await saveTimeShiftProposal({
      prismaClient,
      trip,
      item,
      candidate: { ...candidate, predictiveSignal },
      pressure,
      existingProposal: pendingProposal,
      now: referenceNow,
    });
    if (saved.created) stats.proposalsCreated += 1;
    else stats.proposalsReused += 1;
  }

  const remainingItems = await prismaClient.liveTripItem.count({
    where: {
      liveTripId: trip.id,
      status: { notIn: ['COMPLETED', 'SKIPPED'] },
    },
  });
  let tripCompleted = false;
  if (remainingItems === 0) {
    const completed = await prismaClient.liveTrip.updateMany({
      where: { id: trip.id, userId: trip.userId, status: 'ACTIVE' },
      data: { status: 'COMPLETED' },
    });
    tripCompleted = completed.count === 1;
  }

  return {
    tripId: trip.id,
    calculatedAt: referenceNow.toISOString(),
    policy: {
      lookaheadHours: AUTOPILOT_LOOKAHEAD_MS / 3600000,
      requiresCustomerConfirmation: true,
      mutatesPaidBookings: false,
      travelBufferMinutes: SCHEDULE_TRAVEL_BUFFER_MS / 60000,
      decisionEngine: 'HYBRID_RULES_AND_ML_QUANTILES',
      predictionFreshnessMinutes: LIVE_PREDICTION_MAX_AGE_MS / 60000,
    },
    tripCompleted,
    stats,
  };
}

function serializeProposal(proposal) {
  return {
    id: proposal.id,
    liveTripId: proposal.liveTripId,
    liveTripItemId: proposal.liveTripItemId,
    type: proposal.type,
    status: proposal.status,
    reasonCode: proposal.reasonCode,
    rationale: proposal.rationale,
    originalStart: proposal.originalStart,
    originalEnd: proposal.originalEnd,
    proposedStart: proposal.proposedStart,
    proposedEnd: proposal.proposedEnd,
    snapshot: proposal.snapshot,
    expiresAt: proposal.expiresAt,
    decidedAt: proposal.decidedAt,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function snapshotAfterAcceptedProposal(item, proposal, now) {
  const snapshot = item.snapshot && typeof item.snapshot === 'object' && !Array.isArray(item.snapshot)
    ? item.snapshot
    : {};
  return {
    ...snapshot,
    visitDate: getVietnamDateKey(proposal.proposedStart),
    startTime: vietnamTime(proposal.proposedStart),
    endTime: vietnamTime(proposal.proposedEnd),
    timeSlotId: proposal.snapshot?.proposedSlot?.timeSlotId || snapshot.timeSlotId || null,
    autopilot: {
      proposalId: proposal.id,
      acceptedAt: now.toISOString(),
      bookingChanged: false,
      previousStart: proposal.originalStart,
      previousEnd: proposal.originalEnd,
    },
  };
}

async function decideProposal({
  tripId,
  proposalId,
  userId,
  decision,
  prismaClient = prisma,
  now = new Date(),
} = {}) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const normalizedDecision = String(decision || '').trim().toUpperCase();
  if (!['ACCEPT', 'REJECT'].includes(normalizedDecision)) {
    throw createHttpError(400, 'INVALID_PROPOSAL_DECISION', 'decision phải là ACCEPT hoặc REJECT.');
  }
  const referenceNow = normalizeNow(now);
  const normalizedTripId = String(tripId || '').trim();
  const normalizedProposalId = String(proposalId || '').trim();

  const outcome = await prismaClient.$transaction(async (tx) => {
    const proposal = await tx.liveTripProposal.findFirst({
      where: {
        id: normalizedProposalId,
        liveTripId: normalizedTripId,
        liveTrip: { userId, status: 'ACTIVE' },
      },
      include: {
        liveTripItem: {
          include: {
            attraction: { select: { operationalStatus: true } },
          },
        },
      },
    });
    if (!proposal) return { error: createHttpError(404, 'PROPOSAL_NOT_FOUND', 'Không tìm thấy đề xuất Autopilot.') };
    if (proposal.status !== 'PENDING') {
      return { error: createHttpError(409, 'PROPOSAL_ALREADY_DECIDED', 'Đề xuất này đã được xử lý trước đó.') };
    }

    const item = proposal.liveTripItem;
    if (referenceNow >= proposal.expiresAt || referenceNow >= proposal.proposedStart) {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'EXPIRED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      await recordLiveTripEvent({
        client: tx,
        liveTripId: normalizedTripId,
        liveTripItemId: item.id,
        userId,
        type: 'AUTOPILOT_EXPIRED',
        severity: 'INFO',
        title: 'Đề xuất Autopilot đã hết hạn',
        message: 'Đã quá thời hạn an toàn để áp dụng khung giờ được đề xuất.',
        data: { proposalId: proposal.id },
      });
      return { error: createHttpError(409, 'PROPOSAL_EXPIRED', 'Đề xuất đã hết thời hạn áp dụng.'), committed: true };
    }

    if (normalizedDecision === 'REJECT') {
      const updated = await tx.liveTripProposal.updateMany({
        where: { id: proposal.id, status: 'PENDING', activeKey: item.id },
        data: { status: 'REJECTED', activeKey: null, decidedAt: referenceNow },
      });
      if (updated.count !== 1) {
        return { error: createHttpError(409, 'PROPOSAL_STATE_CHANGED', 'Đề xuất vừa được xử lý. Vui lòng tải lại.') };
      }
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      await recordLiveTripEvent({
        client: tx,
        liveTripId: normalizedTripId,
        liveTripItemId: item.id,
        userId,
        type: 'AUTOPILOT_REJECTED',
        severity: 'INFO',
        title: 'Đã giữ lịch trình hiện tại',
        message: 'Bạn đã từ chối đề xuất đổi giờ; Autopilot không thay đổi lịch trình.',
        data: { proposalId: proposal.id, bookingChanged: false },
      });
      return {
        decision: 'REJECTED',
        itemId: item.id,
        proposal: { ...proposal, status: 'REJECTED', activeKey: null, decidedAt: referenceNow },
      };
    }

    if (item.bookingId) {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'SUPERSEDED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      return {
        error: createHttpError(409, 'PROPOSAL_BOOKING_PROTECTED', 'Hoạt động đã có booking nên Autopilot không được phép đổi giờ.'),
        committed: true,
      };
    }
    const proposedStart = new Date(proposal.proposedStart);
    const proposedEnd = proposal.proposedEnd ? new Date(proposal.proposedEnd) : null;
    if (
      Number.isNaN(proposedStart.getTime())
      || !proposedEnd
      || Number.isNaN(proposedEnd.getTime())
      || proposedEnd <= proposedStart
    ) {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'SUPERSEDED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      return {
        error: createHttpError(409, 'PROPOSAL_INVALID_WINDOW', 'Khung giờ đề xuất không còn hợp lệ.'),
        committed: true,
      };
    }
    if (item.attraction?.operationalStatus !== 'ACTIVE') {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'SUPERSEDED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      return {
        error: createHttpError(409, 'PROPOSAL_ATTRACTION_UNAVAILABLE', 'Điểm tham quan đang tạm ngưng vận hành.'),
        committed: true,
      };
    }
    if (
      !sameInstant(item.scheduledStart, proposal.originalStart)
      || !sameInstant(item.scheduledEnd, proposal.originalEnd)
    ) {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'SUPERSEDED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      return {
        error: createHttpError(409, 'PROPOSAL_STALE', 'Lịch trình đã thay đổi nên đề xuất cũ không còn hợp lệ.'),
        committed: true,
      };
    }

    const sameDayItems = await tx.liveTripItem.findMany({
      where: {
        liveTripId: normalizedTripId,
        id: { not: item.id },
        status: { not: 'SKIPPED' },
      },
      select: { id: true, scheduledStart: true, scheduledEnd: true, status: true, snapshot: true },
    });
    if (hasTripScheduleConflict(
      [item, ...(sameDayItems || [])],
      item.id,
      proposal.proposedStart,
      proposal.proposedEnd,
    )) {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'SUPERSEDED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      return {
        error: createHttpError(409, 'PROPOSAL_CONFLICT', 'Khung giờ mới xung đột thời gian di chuyển với hoạt động khác.'),
        committed: true,
      };
    }

    const latestPressure = await getAttractionPressure(
      item.attractionId,
      itemVisitDate(item),
      { prismaClient: tx, now: referenceNow },
    );
    const proposedSlotSnapshot = proposal.snapshot?.proposedSlot || {};
    const latestSlot = (latestPressure.slots || []).find((slot) => (
      (proposedSlotSnapshot.timeSlotId && slot.timeSlotId === proposedSlotSnapshot.timeSlotId)
      || (
        slot.startTime === vietnamTime(proposal.proposedStart)
        && slot.endTime === vietnamTime(proposal.proposedEnd)
      )
    ));
    const requiredCapacity = Math.max(1, Number(proposal.snapshot?.partySize) || 1);
    if (
      latestPressure.isClosed
      || !latestSlot
      || Number(latestSlot.score || 0) > SAFE_SLOT_MAX_PRESSURE
      || Number(latestSlot.availableTickets || 0) < requiredCapacity
    ) {
      await tx.liveTripProposal.update({
        where: { id: proposal.id },
        data: { status: 'SUPERSEDED', activeKey: null, decidedAt: referenceNow },
      });
      await tx.liveTripItem.updateMany({
        where: { id: item.id, status: 'REVISION_PROPOSED' },
        data: { status: 'AT_RISK' },
      });
      return {
        error: createHttpError(409, 'PROPOSAL_CAPACITY_CHANGED', 'Sức chứa hoặc áp lực khung giờ mới đã thay đổi. Autopilot không áp dụng đề xuất cũ.'),
        committed: true,
      };
    }

    const updated = await tx.liveTripProposal.updateMany({
      where: { id: proposal.id, status: 'PENDING', activeKey: item.id },
      data: { status: 'ACCEPTED', activeKey: null, decidedAt: referenceNow },
    });
    if (updated.count !== 1) {
      return { error: createHttpError(409, 'PROPOSAL_STATE_CHANGED', 'Đề xuất vừa được xử lý. Vui lòng tải lại.') };
    }
    const updatedItem = await tx.liveTripItem.update({
      where: { id: item.id },
      data: {
        scheduledStart: proposal.proposedStart,
        scheduledEnd: proposal.proposedEnd,
        status: 'UPDATED',
        snapshot: snapshotAfterAcceptedProposal(item, proposal, referenceNow),
      },
    });
    await recordLiveTripEvent({
      client: tx,
      liveTripId: normalizedTripId,
      liveTripItemId: item.id,
      userId,
      type: 'AUTOPILOT_ACCEPTED',
      severity: 'SUCCESS',
      title: 'Đã áp dụng khung giờ mới',
      message: 'Lịch hoạt động đã được cập nhật sau khi bạn xác nhận; không có booking nào bị thay đổi.',
      data: {
        proposalId: proposal.id,
        originalStart: proposal.originalStart,
        proposedStart: proposal.proposedStart,
        bookingChanged: false,
      },
    });
    return {
      decision: 'ACCEPTED',
      item: updatedItem,
      itemId: item.id,
      proposal: { ...proposal, status: 'ACCEPTED', activeKey: null, decidedAt: referenceNow },
    };
  });

  if (outcome.error) throw outcome.error;
  emitLiveTripUpdated({
    customerId: userId,
    tripId: normalizedTripId,
    itemId: outcome.itemId,
    proposalId: normalizedProposalId,
    reason: outcome.decision === 'ACCEPTED' ? 'AUTOPILOT_ACCEPTED' : 'AUTOPILOT_REJECTED',
  });
  return {
    decision: outcome.decision,
    proposal: serializeProposal(outcome.proposal),
    item: outcome.item || null,
    bookingChanged: false,
  };
}

async function sweepAutopilotTrips({ prismaClient = prisma, now = new Date() } = {}) {
  const referenceNow = normalizeNow(now);
  const lookaheadEnd = new Date(referenceNow.getTime() + AUTOPILOT_LOOKAHEAD_MS);
  const trips = await prismaClient.liveTrip.findMany({
    where: {
      status: 'ACTIVE',
      items: {
        some: {
          status: { notIn: ['COMPLETED', 'SKIPPED'] },
          OR: [
            { booking: { is: { status: 'COMPLETED' } } },
            {
              scheduledEnd: { lte: referenceNow },
            },
            {
              scheduledEnd: { gt: referenceNow },
              scheduledStart: { lte: lookaheadEnd },
            },
            {
              scheduledEnd: null,
              scheduledStart: { lte: lookaheadEnd },
            },
          ],
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: AUTOPILOT_SWEEP_LIMIT,
    select: { id: true, userId: true },
  });
  let refreshed = 0;
  for (const trip of trips || []) {
    try {
      await refreshTripAutopilot(trip.id, trip.userId, { prismaClient, now: referenceNow });
      refreshed += 1;
    } catch (error) {
      console.error(`[autopilot] Không thể làm mới chuyến ${trip.id}:`, error.message);
    }
  }
  return { scanned: trips?.length || 0, refreshed };
}

module.exports = {
  AUTOPILOT_LOOKAHEAD_MS,
  PRESSURE_RISK_THRESHOLD,
  SAFE_SLOT_MAX_PRESSURE,
  SCHEDULE_TRAVEL_BUFFER_MS,
  chooseSaferSlot,
  decideProposal,
  hasTripScheduleConflict,
  refreshTripAutopilot,
  serializeProposal,
  sweepAutopilotTrips,
};
