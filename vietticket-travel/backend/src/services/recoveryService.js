'use strict';

const { createHash, randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const {
  getBookableSchedule,
  getProductCapacity,
  getSlotCapacity,
  getTicketAvailabilityBatch,
} = require('./availabilityService');
const {
  getCapturedPayment,
  queueRecoveryDifferenceRefund,
  queueRecoveryFullRefund,
} = require('./mandatoryRefundService');
const {
  getActivityWindow,
  isBookingCutoffPassed,
  parseSnapshotSlotLabel,
} = require('../utils/activityTime');
const { parseVndInteger } = require('../utils/money');
const { writeAuditLog } = require('../utils/auditLog');
const { recordLiveTripEvent } = require('./liveTripEventService');
const {
  awardPointsForBooking,
  reversePointsForBooking,
} = require('./loyaltyService');
const {
  buildTicketRestrictions,
  hasTicketRestrictions,
} = require('../utils/ticketRestrictions');

const { Decimal } = Prisma;
const DEFAULT_RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const MIN_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeRecoveryWindowMs(value) {
  if (value == null || String(value).trim() === '') return DEFAULT_RECOVERY_WINDOW_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RECOVERY_WINDOW_MS;
  return Math.min(
    MAX_RECOVERY_WINDOW_MS,
    Math.max(MIN_RECOVERY_WINDOW_MS, Math.trunc(parsed)),
  );
}

const RECOVERY_WINDOW_MS = normalizeRecoveryWindowMs(process.env.RECOVERY_WINDOW_MS);
const MAX_RECOVERY_OPTIONS = 8;
const RECOVERY_DETAIL_MAX_ATTEMPTS = 3;
const REFUND_POLICY_RANK = Object.freeze({
  NON_REFUNDABLE: 1,
  REFUND_WITH_FEE: 2,
  FREE_CANCELLATION: 3,
});
const DEFAULT_REFUND_CUTOFF_HOURS = 24;

const ORIGINAL_BOOKING_INCLUDE = {
  payments: {
    where: { status: 'SUCCESS', isDuplicate: false },
    orderBy: { createdAt: 'asc' },
  },
  ticketInstances: true,
  reservation: {
    include: {
      timeSlot: true,
      ticketProduct: {
        include: {
          attraction: {
            include: {
              partner: { select: { status: true, commissionRate: true } },
              images: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
      },
    },
  },
};

const CASE_INCLUDE = {
  originalBooking: { include: ORIGINAL_BOOKING_INCLUDE },
  fundingBooking: {
    include: {
      payments: {
        where: { status: 'SUCCESS', isDuplicate: false },
        orderBy: { createdAt: 'asc' },
      },
      refundRequests: {
        where: { requestKey: { startsWith: 'recovery-' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          requestKey: true,
          status: true,
          amount: true,
          createdAt: true,
          processingStartedAt: true,
          processedAt: true,
          refundTransactions: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              gatewayResponseCode: true,
              submittedAt: true,
              reconciledAt: true,
              processedAt: true,
              createdAt: true,
            },
          },
        },
      },
    },
  },
  replacementBooking: {
    include: {
      ticketInstances: true,
      reservation: {
        include: {
          timeSlot: true,
          ticketProduct: {
            include: {
              attraction: {
                include: {
                  images: {
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

async function resolveRecoveryFundingBooking(tx, booking) {
  if (getCapturedPayment(booking)) return booking;

  const sourceCase = await tx.recoveryCase.findFirst({
    where: { replacementBookingId: booking.id },
    include: {
      fundingBooking: {
        include: {
          payments: {
            where: { status: 'SUCCESS', isDuplicate: false },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  const fundingBooking = sourceCase?.fundingBooking || null;
  if (
    !booking?.userId
    || !fundingBooking?.userId
    || fundingBooking.userId !== booking.userId
  ) {
    return null;
  }
  return getCapturedPayment(fundingBooking) ? fundingBooking : null;
}

function createRecoveryError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN');
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeRefundPolicy(value) {
  return Object.prototype.hasOwnProperty.call(REFUND_POLICY_RANK, value)
    ? value
    : 'NON_REFUNDABLE';
}

function normalizeRefundFeeRate(policy, value) {
  if (policy !== 'REFUND_WITH_FEE') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeRefundCutoffHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REFUND_CUTOFF_HOURS;
  return Math.min(720, Math.max(0, Math.trunc(parsed)));
}

function getRefundTerms(source = {}) {
  const policy = normalizeRefundPolicy(
    source.refundPolicy
      ?? source.snapshotRefundPolicy
      ?? source.ticketProduct?.refundPolicy,
  );
  return {
    refundPolicy: policy,
    refundFeeRate: normalizeRefundFeeRate(
      policy,
      source.refundFeeRate
        ?? source.snapshotRefundFeeRate
        ?? source.ticketProduct?.refundFeeRate,
    ),
    refundCutoffHours: normalizeRefundCutoffHours(
      source.refundCutoffHours
        ?? source.snapshotRefundCutoffHours
        ?? source.ticketProduct?.refundCutoffHours,
    ),
  };
}

function cutoffMinutesFromVisitStart(source, cutoffHours) {
  const start = timeToMinutes(source.startTime);
  if (start == null) return null;
  const date = String(source.visitDate || '');
  // Comparing an absolute UTC timestamp is unnecessary here because Rescue
  // options are constrained to the same visit date and Vietnam has no DST.
  // The date component still prevents a future/previous-day quote from
  // accidentally passing a time-only comparison.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00Z`) / 86400000
    : 0;
  return day * 1440 + start - cutoffHours * 60;
}

function isNoWorseRefundTerms(candidate, original, { compareCutoff = true } = {}) {
  const candidateTerms = getRefundTerms(candidate);
  const originalTerms = getRefundTerms(original);
  if (
    REFUND_POLICY_RANK[candidateTerms.refundPolicy]
    < REFUND_POLICY_RANK[originalTerms.refundPolicy]
  ) {
    return false;
  }
  // A NON_REFUNDABLE original has no cancellation right to preserve. For
  // refundable originals, compare the actual deadline (activity start minus
  // cutoff) rather than cutoff hours alone; a replacement may start earlier.
  if (compareCutoff && originalTerms.refundPolicy !== 'NON_REFUNDABLE') {
    const originalDeadline = cutoffMinutesFromVisitStart(
      original,
      originalTerms.refundCutoffHours,
    );
    const candidateDeadline = cutoffMinutesFromVisitStart(
      candidate,
      candidateTerms.refundCutoffHours,
    );
    if (
      originalDeadline != null
      && candidateDeadline != null
      && candidateDeadline < originalDeadline
    ) {
      return false;
    }
    if (originalDeadline != null && candidateDeadline == null) {
      // Never promise a replacement cancellation right that cannot be
      // proven from its selected slot/activity start.
      return false;
    }
    if (
      originalDeadline == null
      && candidateDeadline == null
      && candidateTerms.refundCutoffHours > originalTerms.refundCutoffHours
    ) {
      return false;
    }
  }
  if (
    candidateTerms.refundPolicy === originalTerms.refundPolicy
    && candidateTerms.refundPolicy === 'REFUND_WITH_FEE'
    && candidateTerms.refundFeeRate > originalTerms.refundFeeRate + 1e-9
  ) {
    return false;
  }
  return true;
}

function buildRecoveryOptionFingerprint(option = {}) {
  const terms = getRefundTerms(option);
  const payload = {
    ticketProductId: option.ticketProductId || null,
    timeSlotId: option.timeSlotId || null,
    attractionId: option.attractionId || null,
    attractionTitle: normalizeText(option.attractionTitle),
    address: normalizeText(option.address),
    latitude: option.latitude == null ? null : Number(option.latitude),
    longitude: option.longitude == null ? null : Number(option.longitude),
    ticketName: normalizeText(option.ticketName),
    visitDate: option.visitDate || null,
    quantity: Number(option.quantity || 0),
    unitPrice: Math.round(Number(option.unitPrice || 0)),
    totalAmount: Math.round(Number(option.totalAmount || 0)),
    refundAmount: Math.round(Number(option.refundAmount || 0)),
    creditAmount: Math.round(Number(option.creditAmount || 0)),
    startTime: option.startTime || null,
    endTime: option.endTime || null,
    ...terms,
    restrictions: buildTicketRestrictions(option.restrictions || {}),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isNoStricterThanOriginal(candidateTicket, originalSnapshot) {
  const candidate = buildTicketRestrictions(candidateTicket);
  const hasOriginalRestrictionSnapshot = Object.prototype.hasOwnProperty.call(
    originalSnapshot || {},
    'restrictions',
  );

  // Legacy cases did not retain the original eligibility rules. In that case,
  // only an unrestricted replacement is safe to recommend automatically.
  if (!hasOriginalRestrictionSnapshot) return !hasTicketRestrictions(candidate);

  const original = buildTicketRestrictions(originalSnapshot.restrictions || {});
  if (
    candidate.minAgeYears != null
    && (original.minAgeYears == null || candidate.minAgeYears > original.minAgeYears)
  ) {
    return false;
  }
  if (
    candidate.maxAgeYears != null
    && (original.maxAgeYears == null || candidate.maxAgeYears < original.maxAgeYears)
  ) {
    return false;
  }
  if (
    candidate.minHeightCm != null
    && (original.minHeightCm == null || candidate.minHeightCm > original.minHeightCm)
  ) {
    return false;
  }
  if (
    candidate.maxHeightCm != null
    && (original.maxHeightCm == null || candidate.maxHeightCm < original.maxHeightCm)
  ) {
    return false;
  }
  return !candidate.requiresAdult || original.requiresAdult;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map((value) => {
    if (value == null || String(value).trim() === '') return null;
    return Number(value);
  });
  if (!values.every(Number.isFinite)) return null;
  const [aLat, aLon, bLat, bLon] = values;
  if (
    aLat < -90 || aLat > 90
    || bLat < -90 || bLat > 90
    || aLon < -180 || aLon > 180
    || bLon < -180 || bLon > 180
  ) {
    return null;
  }
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildOriginalSnapshot(booking) {
  const reservation = booking.reservation;
  const ticketProduct = reservation.ticketProduct;
  const attraction = ticketProduct.attraction;
  const timeSlotLabel = booking.snapshotTimeSlotLabel || (
    reservation.timeSlot
      ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
      : null
  );
  const snapshotSlot = parseSnapshotSlotLabel(timeSlotLabel);
  const persistedRestrictions = booking.snapshotTicketRestrictions;
  const hasPersistedRestrictions = persistedRestrictions
    && typeof persistedRestrictions === 'object'
    && !Array.isArray(persistedRestrictions);
  return {
    bookingId: booking.id,
    attractionId: booking.snapshotAttractionId || attraction.id,
    attractionTitle: booking.snapshotAttractionTitle || attraction.title,
    attractionAddress: booking.snapshotAttractionAddress || attraction.address,
    city: booking.snapshotAttractionCity || attraction.city,
    district: booking.snapshotAttractionDistrict || attraction.district || null,
    imageUrl: booking.snapshotAttractionImage || attraction.images?.[0]?.imageUrl || null,
    latitude: booking.snapshotAttractionLatitude ?? attraction.latitude ?? null,
    longitude: booking.snapshotAttractionLongitude ?? attraction.longitude ?? null,
    environment: booking.snapshotAttractionEnvironment
      || attraction.environment
      || 'MIXED',
    ticketName: booking.snapshotTicketName || ticketProduct.name,
    ticketType: booking.snapshotTicketType || ticketProduct.type,
    visitDate: dateKey(booking.snapshotVisitDate || reservation.date),
    timeSlotLabel,
    startTime: snapshotSlot.startTime
      || booking.snapshotActivityStartTime
      || reservation.timeSlot?.startTime
      || attraction.openTime
      || null,
    endTime: snapshotSlot.endTime
      || booking.snapshotActivityEndTime
      || reservation.timeSlot?.endTime
      || attraction.closeTime
      || null,
    activityStartTime: booking.snapshotActivityStartTime
      || attraction.openTime
      || null,
    activityEndTime: booking.snapshotActivityEndTime
      || attraction.closeTime
      || null,
    quantity: reservation.quantity,
    totalAmount: Number(booking.totalAmount),
    refundPolicy: normalizeRefundPolicy(
      booking.snapshotRefundPolicy ?? ticketProduct.refundPolicy,
    ),
    refundFeeRate: normalizeRefundFeeRate(
      booking.snapshotRefundPolicy ?? ticketProduct.refundPolicy,
      booking.snapshotRefundFeeRate ?? ticketProduct.refundFeeRate,
    ),
    refundCutoffHours: normalizeRefundCutoffHours(
      booking.snapshotRefundCutoffHours ?? ticketProduct.refundCutoffHours,
    ),
    ...(hasPersistedRestrictions
      ? { restrictions: buildTicketRestrictions(persistedRestrictions) }
      : {}),
  };
}

function getRecoveryExpiry(originalSnapshot, now = new Date()) {
  const configuredExpiry = new Date(now.getTime() + RECOVERY_WINDOW_MS);
  if (!originalSnapshot?.visitDate) return configuredExpiry;

  // A Rescue choice is useful only on the affected visit date. For trips farther
  // in the future customers receive up to 24 hours; for same-day incidents the
  // offer closes at the end of that local day and automatically falls back to a refund.
  const { endsAt } = getActivityWindow({
    date: new Date(`${originalSnapshot.visitDate}T00:00:00.000Z`),
    attraction: { openTime: '00:00', closeTime: '23:59' },
  });
  return endsAt && endsAt > now && endsAt < configuredExpiry
    ? endsAt
    : configuredExpiry;
}

function toOptionContext(recoveryCaseOrContext) {
  if (recoveryCaseOrContext.originalSnapshot) {
    return {
      creditAmount: Number(recoveryCaseOrContext.creditAmount),
      originalSnapshot: recoveryCaseOrContext.originalSnapshot,
    };
  }
  throw new Error('Recovery context is missing its original snapshot.');
}

function scoreOption({ original, attraction, totalAmount, creditAmount, slot }) {
  const distanceKm = haversineKm(
    original.latitude,
    original.longitude,
    attraction.latitude,
    attraction.longitude,
  );
  const sameEnvironment = attraction.environment === original.environment;
  const priceRatio = creditAmount > 0 ? totalAmount / creditAmount : 1;
  const oldMinutes = timeToMinutes(original.startTime);
  const newMinutes = timeToMinutes(slot.startTime);
  const timeDelta = oldMinutes == null || newMinutes == null
    ? null
    : Math.abs(oldMinutes - newMinutes);

  let score = sameEnvironment ? 35 : 18;
  score += distanceKm == null ? 10 : Math.max(0, 25 - distanceKm * 2.5);
  score += Math.min(20, Math.max(0, Number(attraction.averageRating || 0) * 4));
  score += Math.max(0, 15 - Math.abs(1 - priceRatio) * 15);
  score += timeDelta == null ? 2 : Math.max(0, 5 - timeDelta / 60);

  return { distanceKm, sameEnvironment, score: Number(score.toFixed(2)) };
}

function buildRecommendationReasons({
  original,
  attraction,
  distanceKm,
  sameEnvironment,
  refundAmount,
  slot,
}) {
  const reasons = [];
  if (sameEnvironment) reasons.push('Giữ phong cách trải nghiệm tương tự');
  if (distanceKm != null && distanceKm <= 10) {
    reasons.push(`Cách địa điểm cũ khoảng ${distanceKm.toFixed(1)} km`);
  } else if (normalizeText(attraction.district) === normalizeText(original.district)) {
    reasons.push('Cùng khu vực với kế hoạch ban đầu');
  }
  if (Number(attraction.averageRating || 0) >= 4) {
    reasons.push(`Được đánh giá ${Number(attraction.averageRating).toFixed(1)}/5`);
  }
  if (refundAmount > 0) reasons.push('Được hoàn lại phần tiền chênh lệch');
  if (slot.startTime) reasons.push(`Còn chỗ lúc ${slot.startTime}`);
  return reasons.slice(0, 3);
}

async function findEligibleRecoveryOptions(
  client,
  recoveryCaseOrContext,
  { now = new Date(), limit = MAX_RECOVERY_OPTIONS } = {},
) {
  const { creditAmount, originalSnapshot: original } = toOptionContext(recoveryCaseOrContext);
  const visitDate = new Date(`${original.visitDate}T00:00:00.000Z`);
  if (!original.visitDate || Number.isNaN(visitDate.getTime())) return [];

  const products = await client.ticketProduct.findMany({
    where: {
      status: 'ACTIVE',
      archivedAt: null,
      type: original.ticketType,
      attraction: {
        id: { not: original.attractionId },
        city: { equals: original.city, mode: 'insensitive' },
        requiresManualApproval: false,
        status: 'APPROVED',
        publicationStatus: 'ACTIVE',
        operationalStatus: 'ACTIVE',
        archivedAt: null,
        publishedAt: { not: null },
        partner: { status: 'APPROVED' },
      },
    },
    include: {
      attraction: {
        include: {
          partner: { select: { status: true, commissionRate: true } },
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: [
      { attraction: { averageRating: 'desc' } },
      { sellingPrice: 'asc' },
    ],
    take: 100,
  });

  const affordableProducts = products.filter((product) => {
    const unitPrice = parseVndInteger(product.sellingPrice);
    return isNoStricterThanOriginal(product, original)
      // Cutoff comparison needs the selected slot's actual start time; the
      // product row alone has no visit date/slot and must only be screened for
      // policy rank and fee here.
      && isNoWorseRefundTerms(product, original, { compareCutoff: false })
      && unitPrice != null
      && unitPrice * original.quantity <= creditAmount;
  });
  const availabilityByProduct = await getTicketAvailabilityBatch(
    client,
    affordableProducts.map((product) => product.id),
    visitDate,
    { now },
  );

  const options = [];
  affordableProducts.forEach((product) => {
    const availability = availabilityByProduct.get(product.id);
    if (!availability || availability.closed) return;
    const unitPrice = Number(product.sellingPrice);
    const totalAmount = unitPrice * original.quantity;
    const refundAmount = creditAmount - totalAmount;

    availability.slots
      .filter((slot) => (
        !slot.bookingClosed
        && Number(slot.availableTickets || 0) >= original.quantity
      ))
      .forEach((slot) => {
        const candidateRefundTerms = {
          ...product,
          visitDate: original.visitDate,
          startTime: slot.startTime || product.attraction.openTime || null,
        };
        if (!isNoWorseRefundTerms(candidateRefundTerms, original)) return;
        const rank = scoreOption({
          original,
          attraction: product.attraction,
          totalAmount,
          creditAmount,
          slot,
        });
        const option = {
          ticketProductId: product.id,
          timeSlotId: slot.timeSlotId || null,
          attractionId: product.attraction.id,
          attractionTitle: product.attraction.title,
          address: product.attraction.address,
          city: product.attraction.city,
          district: product.attraction.district || null,
          imageUrl: product.attraction.images?.[0]?.imageUrl || null,
          latitude: product.attraction.latitude ?? null,
          longitude: product.attraction.longitude ?? null,
          environment: product.attraction.environment,
          averageRating: Number(product.attraction.averageRating || 0),
          totalReviews: product.attraction.totalReviews,
          ticketName: product.name,
          ticketType: product.type,
          ticketDescription: product.description,
          restrictions: buildTicketRestrictions(product),
          refundPolicy: normalizeRefundPolicy(product.refundPolicy),
          refundFeeRate: normalizeRefundFeeRate(
            product.refundPolicy,
            product.refundFeeRate,
          ),
          refundCutoffHours: normalizeRefundCutoffHours(product.refundCutoffHours),
          unitPrice,
          quantity: original.quantity,
          totalAmount,
          refundAmount,
          creditAmount,
          availableTickets: Number(slot.availableTickets || 0),
          visitDate: original.visitDate,
          startTime: slot.startTime || null,
          endTime: slot.endTime || null,
          distanceKm: rank.distanceKm == null
            ? null
            : Number(rank.distanceKm.toFixed(1)),
          matchScore: rank.score,
          recommendationReasons: buildRecommendationReasons({
            original,
            attraction: product.attraction,
            distanceKm: rank.distanceKm,
            sameEnvironment: rank.sameEnvironment,
            refundAmount,
            slot,
          }),
        };
        option.quoteFingerprint = buildRecoveryOptionFingerprint(option);
        options.push(option);
      });
  });

  return options
    .sort((a, b) => (
      b.matchScore - a.matchScore
      || a.refundAmount - b.refundAmount
      || b.averageRating - a.averageRating
      || a.attractionTitle.localeCompare(b.attractionTitle, 'vi')
    ))
    .slice(0, limit);
}

async function createRecoveryCaseForCancellation(
  tx,
  booking,
  {
    reason,
    trigger = 'PARTNER_CANCELLATION',
    now = new Date(),
  },
) {
  const fundingBooking = await resolveRecoveryFundingBooking(tx, booking);
  const capturedPayment = getCapturedPayment(fundingBooking);
  if (!capturedPayment) return null;

  const creditAmount = Math.min(
    Number(capturedPayment.amount),
    Number(booking.totalAmount),
  );
  const context = {
    creditAmount,
    originalSnapshot: buildOriginalSnapshot(booking),
  };
  const options = await findEligibleRecoveryOptions(tx, context, { now, limit: 1 });
  if (options.length === 0) return null;

  return tx.recoveryCase.upsert({
    where: { originalBookingId: booking.id },
    update: {},
    create: {
      userId: booking.userId,
      originalBookingId: booking.id,
      fundingBookingId: fundingBooking.id,
      status: 'OPEN',
      trigger,
      reason,
      creditAmount,
      expiresAt: getRecoveryExpiry(context.originalSnapshot, now),
      originalSnapshot: context.originalSnapshot,
    },
  });
}

async function queueFullRecoveryRefund(tx, recoveryCase, {
  now = new Date(),
  reason,
} = {}) {
  const refundReason = reason || `Khách không chọn phương án thay thế cho sự cố: ${recoveryCase.reason}`;
  const fundingBooking = recoveryCase.fundingBooking;
  const queuedRefund = await queueRecoveryFullRefund(tx, fundingBooking, {
    recoveryCaseId: recoveryCase.id,
    targetBookingId: recoveryCase.originalBookingId,
    amount: Number(recoveryCase.creditAmount),
    type: recoveryCase.trigger,
    reason: refundReason,
    now,
  });
  if (!queuedRefund.refundRequest) {
    throw createRecoveryError(
      409,
      'RECOVERY_FUNDING_UNAVAILABLE',
      'Không tìm thấy giao dịch thanh toán gốc để hoàn tiền an toàn.',
    );
  }
  if (fundingBooking.id !== recoveryCase.originalBookingId) {
    await tx.booking.update({
      where: { id: fundingBooking.id },
      data: { refundRequired: true },
    });
  }
  return tx.recoveryCase.update({
    where: { id: recoveryCase.id },
    data: {
      status: 'REFUND_PENDING',
      refundAmount: recoveryCase.creditAmount,
      // completedAt is reserved for an actually confirmed gateway outcome.
      // The request/transaction timestamps expose queue progress meanwhile.
      version: { increment: 1 },
    },
  });
}

async function expireRecoveryCase(recoveryCaseId, { now = new Date() } = {}) {
  return prisma.$transaction(async (tx) => {
    const recoveryCase = await tx.recoveryCase.findUnique({
      where: { id: recoveryCaseId },
      include: CASE_INCLUDE,
    });
    if (
      !recoveryCase
      || recoveryCase.status !== 'OPEN'
      || recoveryCase.expiresAt > now
    ) {
      return null;
    }

    const claimed = await tx.recoveryCase.updateMany({
      where: { id: recoveryCase.id, status: 'OPEN', expiresAt: { lte: now } },
      data: { version: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;

    const updated = await queueFullRecoveryRefund(
      tx,
      recoveryCase,
      {
        now,
        reason: 'Hết thời hạn chọn phương án thay thế. Hoàn tiền 100% tự động.',
      },
    );
    await writeAuditLog({
      client: tx,
      actorId: recoveryCase.userId,
      action: 'RECOVERY_CASE_EXPIRED',
      entityType: 'RecoveryCase',
      entityId: recoveryCase.id,
      metadata: { originalBookingId: recoveryCase.originalBookingId },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function sweepExpiredRecoveryCases({
  userId = null,
  now = new Date(),
  limit = 100,
} = {}) {
  const candidates = await prisma.recoveryCase.findMany({
    where: {
      status: 'OPEN',
      expiresAt: { lte: now },
      ...(userId ? { userId } : {}),
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let count = 0;
  for (const candidate of candidates) {
    try {
      const expired = await expireRecoveryCase(candidate.id, { now });
      if (expired) count += 1;
    } catch (error) {
      console.error(`[Rescue] Không thể xử lý case quá hạn ${candidate.id}:`, error.message);
    }
  }
  return count;
}

async function getRecoveryCaseDetail({
  recoveryCaseId,
  userId,
  now = new Date(),
  req = null,
}) {
  let lastError;

  // Terminal cases are read-only. Avoid opening a SERIALIZABLE transaction
  // (and pinning a PostgreSQL connection) just to render the success/refund
  // page; only OPEN cases need the transactional fallback below.
  const terminalProbe = prisma.recoveryCase?.findUnique
    ? await prisma.recoveryCase.findUnique({
      where: { id: recoveryCaseId, userId },
      select: { id: true, userId: true, status: true },
    })
    : null;
  if (terminalProbe && terminalProbe.status !== 'OPEN') {
    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { id: recoveryCaseId, userId },
      include: CASE_INCLUDE,
    });
    if (!recoveryCase || recoveryCase.userId !== userId) {
      throw createRecoveryError(
        404,
        'RECOVERY_NOT_FOUND',
        'Không tìm thấy yêu cầu cứu chuyến.',
      );
    }
    return {
      recoveryCase,
      options: [],
      transitionedToRefundPending: false,
    };
  }

  for (let attempt = 0; attempt < RECOVERY_DETAIL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const recoveryCase = await tx.recoveryCase.findUnique({
          where: { id: recoveryCaseId, userId },
          include: CASE_INCLUDE,
        });
        if (!recoveryCase || recoveryCase.userId !== userId) {
          throw createRecoveryError(
            404,
            'RECOVERY_NOT_FOUND',
            'Không tìm thấy yêu cầu cứu chuyến.',
          );
        }
        if (recoveryCase.status !== 'OPEN') {
          return {
            recoveryCase,
            options: [],
            transitionedToRefundPending: false,
          };
        }

        const options = await findEligibleRecoveryOptions(
          tx,
          recoveryCase,
          { now },
        );
        if (options.length > 0) {
          return {
            recoveryCase,
            options,
            transitionedToRefundPending: false,
            optionsUnavailable: false,
          };
        }

        // Inventory and operating hours are live data. A temporary stock
        // reservation, catalog sync, or partner outage must not irreversibly
        // forfeit the customer's Rescue window. Keep the case OPEN so the
        // customer can retry (or explicitly choose the guaranteed refund);
        // the expiry sweep remains the only automatic fallback.
        if (recoveryCase.expiresAt > now) {
          return {
            recoveryCase,
            options: [],
            transitionedToRefundPending: false,
            optionsUnavailable: true,
          };
        }

        const claimed = await tx.recoveryCase.updateMany({
          where: {
            id: recoveryCase.id,
            userId,
            status: 'OPEN',
            version: recoveryCase.version,
          },
          data: { version: { increment: 1 } },
        });
        if (claimed.count !== 1) {
          throw createRecoveryError(
            409,
            'RECOVERY_STATE_CHANGED',
            'Yêu cầu vừa được xử lý ở thiết bị khác. Vui lòng tải lại.',
          );
        }

        const updated = await queueFullRecoveryRefund(
          tx,
          recoveryCase,
          {
            now,
            reason: 'Không còn phương án thay thế hợp lệ. Hoàn tiền 100% tự động.',
          },
        );
        await writeAuditLog({
          client: tx,
          req,
          actorId: userId,
          action: 'RECOVERY_NO_OPTIONS_REFUND_QUEUED',
          entityType: 'RecoveryCase',
          entityId: recoveryCase.id,
          metadata: {
            originalBookingId: recoveryCase.originalBookingId,
            fundingBookingId: recoveryCase.fundingBookingId,
            creditAmount: Number(recoveryCase.creditAmount),
          },
        });

        return {
          recoveryCase: { ...recoveryCase, ...updated },
          options: [],
          transitionedToRefundPending: true,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      lastError = error;
      const retryable = error?.code === 'P2034'
        || error?.code === 'RECOVERY_STATE_CHANGED';
      if (!retryable || attempt === RECOVERY_DETAIL_MAX_ATTEMPTS - 1) throw error;
    }
  }

  throw lastError;
}

async function claimConfirmedInventory(tx, {
  ticketProductId,
  timeSlotId,
  date,
  quantity,
  now,
}) {
  const schedule = await getBookableSchedule(tx, ticketProductId, date);
  if (schedule.isClosed) {
    throw createRecoveryError(409, 'OPTION_UNAVAILABLE', 'Địa điểm vừa ngừng nhận khách trong ngày này.');
  }

  const selectedSlot = timeSlotId
    ? schedule.slots.find((slot) => slot.id === timeSlotId)
    : null;
  if ((timeSlotId && !selectedSlot) || (!timeSlotId && schedule.slots.length > 0)) {
    throw createRecoveryError(409, 'OPTION_UNAVAILABLE', 'Khung giờ thay thế không còn khả dụng.');
  }
  if (isBookingCutoffPassed({
    date,
    timeSlot: selectedSlot,
    attraction: schedule.attraction,
    now,
  })) {
    throw createRecoveryError(409, 'OPTION_UNAVAILABLE', 'Đã qua giờ nhận đặt cho phương án này.');
  }

  const productCapacity = getProductCapacity(schedule);
  await tx.dailyStock.upsert({
    where: { ticketProductId_date: { ticketProductId, date } },
    update: { capacity: productCapacity },
    create: {
      ticketProductId,
      date,
      capacity: productCapacity,
      bookedQuantity: 0,
      heldQuantity: 0,
    },
  });
  const daily = await tx.dailyStock.findUnique({
    where: { ticketProductId_date: { ticketProductId, date } },
  });
  const claimedDaily = await tx.dailyStock.updateMany({
    where: {
      id: daily.id,
      bookedQuantity: daily.bookedQuantity,
      heldQuantity: daily.heldQuantity,
      capacity: daily.capacity,
      ...(daily.bookedQuantity + daily.heldQuantity + quantity <= daily.capacity
        ? {}
        : { id: '__insufficient__' }),
    },
    data: { bookedQuantity: { increment: quantity } },
  });
  if (claimedDaily.count !== 1) {
    throw createRecoveryError(409, 'OPTION_UNAVAILABLE', 'Phương án vừa hết vé.');
  }

  await tx.attractionDailyStock.upsert({
    where: {
      attractionId_date: { attractionId: schedule.attraction.id, date },
    },
    update: { capacity: schedule.dayCapacity },
    create: {
      attractionId: schedule.attraction.id,
      date,
      capacity: schedule.dayCapacity,
    },
  });
  const attractionStock = await tx.attractionDailyStock.findUnique({
    where: {
      attractionId_date: { attractionId: schedule.attraction.id, date },
    },
  });
  const claimedAttraction = await tx.attractionDailyStock.updateMany({
    where: {
      id: attractionStock.id,
      bookedQty: attractionStock.bookedQty,
      heldQty: attractionStock.heldQty,
      capacity: attractionStock.capacity,
      ...(attractionStock.bookedQty + attractionStock.heldQty + quantity
        <= attractionStock.capacity
        ? {}
        : { id: '__insufficient__' }),
    },
    data: { bookedQty: { increment: quantity } },
  });
  if (claimedAttraction.count !== 1) {
    throw createRecoveryError(409, 'OPTION_UNAVAILABLE', 'Địa điểm vừa đạt giới hạn sức chứa.');
  }

  if (selectedSlot) {
    await tx.timeSlotStock.upsert({
      where: { timeSlotId_date: { timeSlotId, date } },
      update: {},
      create: { timeSlotId, date, bookedQty: 0, heldQty: 0 },
    });
    const slotStock = await tx.timeSlotStock.findUnique({
      where: { timeSlotId_date: { timeSlotId, date } },
    });
    const slotCapacity = getSlotCapacity(schedule, selectedSlot);
    const claimedSlot = await tx.timeSlotStock.updateMany({
      where: {
        id: slotStock.id,
        bookedQty: slotStock.bookedQty,
        heldQty: slotStock.heldQty,
        ...(slotStock.bookedQty + slotStock.heldQty + quantity <= slotCapacity
          ? {}
          : { id: '__insufficient__' }),
      },
      data: { bookedQty: { increment: quantity } },
    });
    if (claimedSlot.count !== 1) {
      throw createRecoveryError(409, 'OPTION_UNAVAILABLE', 'Khung giờ vừa hết chỗ.');
    }
  }

  return { schedule, selectedSlot };
}

async function synchronizeLiveTrip(tx, {
  userId,
  originalBookingId,
  replacementBookingId,
  option,
  now,
}) {
  const items = await tx.liveTripItem.findMany({
    where: { bookingId: originalBookingId },
    include: { smartQueueEntry: true },
  });
  const updatedTrips = new Set();
  const window = getActivityWindow({
    date: new Date(`${option.visitDate}T00:00:00.000Z`),
    timeSlot: option.timeSlotId
      ? { startTime: option.startTime, endTime: option.endTime }
      : null,
    attraction: { openTime: option.startTime, closeTime: option.endTime },
  });

  for (const item of items) {
    if (item.smartQueueEntry && ['WAITING', 'READY'].includes(item.smartQueueEntry.status)) {
      await tx.smartQueueEntry.update({
        where: { id: item.smartQueueEntry.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await recordLiveTripEvent({
        client: tx,
        liveTripId: item.liveTripId,
        liveTripItemId: item.id,
        userId,
        type: 'QUEUE_CANCELLED',
        severity: 'INFO',
        title: 'SmartQueue cũ đã được đóng an toàn',
        message: 'Booking cũ được thay thế nên lượt SmartQueue liên quan đã kết thúc; booking mới vẫn có thể đăng ký một lượt riêng.',
        data: {
          queueEntryId: item.smartQueueEntry.id,
          originalBookingId,
          replacementBookingId,
          reason: 'BOOKING_RECOVERED',
        },
      });
    }
    const snapshot = item.snapshot && typeof item.snapshot === 'object'
      ? item.snapshot
      : {};
    const replacementItem = await tx.liveTripItem.create({
      data: {
        liveTripId: item.liveTripId,
        bookingId: replacementBookingId,
        attractionId: option.attractionId,
        dayIndex: item.dayIndex,
        orderIndex: item.orderIndex,
        scheduledStart: window.startsAt || item.scheduledStart,
        scheduledEnd: window.endsAt || item.scheduledEnd,
        status: 'PLANNED',
        snapshot: {
          ...snapshot,
          title: option.attractionTitle,
          attractionId: option.attractionId,
          attractionTitle: option.attractionTitle,
          city: option.city,
          visitDate: option.visitDate,
          startTime: option.startTime,
          endTime: option.endTime,
          timeSlotId: option.timeSlotId,
          bookingId: replacementBookingId,
          recoveredFromBookingId: originalBookingId,
          recoveredFromLiveTripItemId: item.id,
        },
      },
    });
    if (tx.liveTripProposal?.updateMany) {
      await tx.liveTripProposal.updateMany({
        where: { liveTripItemId: item.id, status: 'PENDING' },
        data: {
          status: 'SUPERSEDED',
          activeKey: null,
          decidedAt: now,
        },
      });
    }
    await tx.liveTripItem.update({
      where: { id: item.id },
      data: {
        status: 'SKIPPED',
        snapshot: {
          ...snapshot,
          hiddenFromPlan: true,
          recoveredByBookingId: replacementBookingId,
          recoveredByLiveTripItemId: replacementItem.id,
        },
      },
    });
    await recordLiveTripEvent({
      client: tx,
      liveTripId: item.liveTripId,
      liveTripItemId: replacementItem.id,
      userId,
      type: 'ITEM_RECOVERED',
      severity: 'SUCCESS',
      title: 'Đã cứu kế hoạch bằng vé thay thế',
      message: `${option.attractionTitle} đã thay cho hoạt động bị hủy và vé mới đã được cấp.`,
      data: {
        originalBookingId,
        replacementBookingId,
        originalLiveTripItemId: item.id,
        replacementLiveTripItemId: replacementItem.id,
      },
    });
    updatedTrips.add(item.liveTripId);
  }
  return [...updatedTrips];
}

async function acceptRecoveryOption({
  recoveryCaseId,
  userId,
  ticketProductId,
  timeSlotId = null,
  quoteFingerprint = null,
  now = new Date(),
  req = null,
}) {
  return prisma.$transaction(async (tx) => {
    const recoveryCase = await tx.recoveryCase.findUnique({
      where: { id: recoveryCaseId },
      include: CASE_INCLUDE,
    });
    if (!recoveryCase || recoveryCase.userId !== userId) {
      throw createRecoveryError(404, 'RECOVERY_NOT_FOUND', 'Không tìm thấy yêu cầu cứu chuyến.');
    }
    if (recoveryCase.status === 'REPLACED') {
      const selectedOption = recoveryCase.selectedOptionSnapshot || {};
      const isSameDecision = Boolean(recoveryCase.replacementBookingId)
        && selectedOption.ticketProductId === ticketProductId
        && (selectedOption.timeSlotId || null) === (timeSlotId || null);
      if (isSameDecision) {
        return {
          expired: false,
          replayed: true,
          recoveryCaseId: recoveryCase.id,
          originalBookingId: recoveryCase.originalBookingId,
          replacementBookingId: recoveryCase.replacementBookingId,
          refundDifference: Number(recoveryCase.refundAmount || 0),
          liveTripIds: [],
        };
      }
    }
    if (recoveryCase.status !== 'OPEN') {
      throw createRecoveryError(409, 'RECOVERY_ALREADY_DECIDED', 'Yêu cầu này đã được xử lý.');
    }
    if (recoveryCase.expiresAt <= now) {
      await queueFullRecoveryRefund(
        tx,
        recoveryCase,
        { now, reason: 'Hết thời hạn chọn phương án thay thế. Hoàn tiền 100% tự động.' },
      );
      return { expired: true, recoveryCaseId };
    }

    const options = await findEligibleRecoveryOptions(
      tx,
      recoveryCase,
      { now, limit: 100 },
    );
    const option = options.find((candidate) => (
      candidate.ticketProductId === ticketProductId
      && (candidate.timeSlotId || null) === (timeSlotId || null)
    ));
    if (!option) {
      throw createRecoveryError(
        409,
        'OPTION_UNAVAILABLE',
        'Phương án này không còn đáp ứng giá, lịch hoặc tồn kho. Vui lòng chọn lại.',
      );
    }
    if (!/^[a-f0-9]{64}$/i.test(String(quoteFingerprint || ''))) {
      throw createRecoveryError(
        400,
        'OPTION_QUOTE_REQUIRED',
        'Báº£ng giÃ¡ Ä‘Ã£ chá» hoáº·c khÃ´ng há»£p lá»‡. Vui lÃ²ng táº£i láº¡i phÆ°Æ¡ng Ã¡n trÆ°á»›c khi xÃ¡c nháº­n.',
      );
    }
    if (String(quoteFingerprint).toLowerCase() !== option.quoteFingerprint) {
      throw createRecoveryError(
        409,
        'OPTION_CHANGED',
        'GiÃ¡, lá»‹ch hoáº·c Ä‘iá»u kiá»‡n vÃ© Ä‘Ã£ thay Ä‘á»•i. Vui lÃ²ng táº£i láº¡i vÃ  xÃ¡c nháº­n láº¡i.',
      );
    }

    const claimedCase = await tx.recoveryCase.updateMany({
      where: {
        id: recoveryCase.id,
        userId,
        status: 'OPEN',
        expiresAt: { gt: now },
        version: recoveryCase.version,
      },
      data: { version: { increment: 1 } },
    });
    if (claimedCase.count !== 1) {
      throw createRecoveryError(409, 'RECOVERY_ALREADY_DECIDED', 'Yêu cầu vừa được xử lý ở thiết bị khác.');
    }

    const date = new Date(`${option.visitDate}T00:00:00.000Z`);
    const quantity = Number(recoveryCase.originalSnapshot.quantity);
    const { schedule, selectedSlot } = await claimConfirmedInventory(tx, {
      ticketProductId,
      timeSlotId,
      date,
      quantity,
      now,
    });

    const unitPrice = parseVndInteger(schedule.product.sellingPrice);
    const totalAmountNumber = unitPrice * quantity;
    const creditAmountNumber = Number(recoveryCase.creditAmount);
    if (unitPrice == null || totalAmountNumber > creditAmountNumber) {
      throw createRecoveryError(422, 'OPTION_NOT_ELIGIBLE', 'Giá phương án mới vượt khoản tiền đã thanh toán.');
    }
    const totalAmount = new Decimal(totalAmountNumber);
    const rawCommissionRate = Number(schedule.attraction.partner?.commissionRate ?? 0.10);
    const commissionRate = Number.isFinite(rawCommissionRate)
      ? Math.min(Math.max(rawCommissionRate, 0), 1)
      : 0.10;
    const commissionAmount = totalAmount
      .mul(commissionRate)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const partnerNetAmount = totalAmount.minus(commissionAmount);

    const reservation = await tx.reservation.create({
      data: {
        userId,
        ticketProductId,
        timeSlotId: selectedSlot?.id || null,
        date,
        quantity,
        status: 'CONFIRMED',
        expiresAt: now,
        paymentDeadline: now,
        snapshotUnitPrice: unitPrice,
        snapshotRefundPolicy: schedule.product.refundPolicy,
        snapshotRefundFeeRate: schedule.product.refundFeeRate,
        snapshotRefundCutoffHours: schedule.product.refundCutoffHours,
        snapshotTicketRestrictions: buildTicketRestrictions(schedule.product),
        snapshotCommissionRate: commissionRate,
      },
    });

    const original = recoveryCase.originalBooking;
    const fundingBooking = recoveryCase.fundingBooking;
    const replacementBooking = await tx.booking.create({
      data: {
        userId,
        reservationId: reservation.id,
        subtotalAmount: totalAmount,
        discountAmount: 0,
        totalAmount,
        status: 'CONFIRMED',
        paymentMethod: 'recovery_credit',
        fullName: original.fullName,
        email: original.email,
        phone: original.phone,
        note: `VietTicket Rescue thay thế booking ${original.id}`,
        snapshotAt: now,
        snapshotAttractionId: option.attractionId,
        snapshotAttractionTitle: option.attractionTitle,
        snapshotAttractionAddress: option.address,
        snapshotAttractionCity: option.city,
        snapshotAttractionDistrict: option.district,
        snapshotAttractionImage: option.imageUrl,
        snapshotAttractionLatitude: option.latitude ?? null,
        snapshotAttractionLongitude: option.longitude ?? null,
        snapshotAttractionEnvironment: option.environment || null,
        snapshotPartnerId: schedule.attraction.partnerId
          || schedule.attraction.partner?.id
          || null,
        snapshotPartnerName: schedule.attraction.partner?.businessName || null,
        snapshotTicketName: option.ticketName,
        snapshotTicketType: option.ticketType,
        snapshotTicketDescription: option.ticketDescription,
        snapshotTicketRestrictions: buildTicketRestrictions(schedule.product),
        snapshotUnitPrice: unitPrice,
        snapshotRefundPolicy: schedule.product.refundPolicy,
        snapshotRefundFeeRate: schedule.product.refundFeeRate,
        snapshotRefundCutoffHours: schedule.product.refundCutoffHours,
        snapshotVisitDate: date,
        snapshotTimeSlotLabel: option.startTime
          ? `${option.startTime} - ${option.endTime}`
          : null,
        snapshotActivityStartTime: schedule.attraction.openTime || null,
        snapshotActivityEndTime: schedule.attraction.closeTime || null,
        commissionRateSnapshot: commissionRate,
        commissionAmountSnapshot: commissionAmount,
        partnerNetAmountSnapshot: partnerNetAmount,
      },
    });
    await tx.payment.create({
      data: {
        bookingId: replacementBooking.id,
        amount: totalAmount,
        paymentGateway: 'RECOVERY_CREDIT',
        transactionId: `RECOVERY:${recoveryCase.id}`,
        status: 'SUCCESS',
        paidAt: now,
        rawResponse: {
          recoveryCaseId: recoveryCase.id,
          sourceBookingId: original.id,
          fundingBookingId: fundingBooking.id,
          sourceGateway: getCapturedPayment(fundingBooking)?.paymentGateway || 'VNPAY',
        },
      },
    });
    await tx.ticketInstance.createMany({
      data: Array.from({ length: quantity }, () => ({
        bookingId: replacementBooking.id,
        ticketProductId,
        qrCodeToken: randomUUID(),
      })),
    });

    // Loyalty follows the final service the customer keeps, not the cancelled
    // booking that originally funded the Rescue exchange.
    await reversePointsForBooking(tx, { id: original.id });
    await awardPointsForBooking(tx, {
      id: replacementBooking.id,
      userId: replacementBooking.userId,
      totalAmount: replacementBooking.totalAmount,
      isForecastTrainingSample: replacementBooking.isForecastTrainingSample,
    });

    const refundDifference = creditAmountNumber - totalAmountNumber;
    if (refundDifference > 0) {
      const queuedRefund = await queueRecoveryDifferenceRefund(tx, fundingBooking, {
        recoveryCaseId: recoveryCase.id,
        targetBookingId: original.id,
        amount: refundDifference,
        type: recoveryCase.trigger,
        reason: `Hoàn chênh lệch sau khi đổi sang booking ${replacementBooking.id}.`,
        now,
      });
      if (!queuedRefund.refundRequest) {
        throw createRecoveryError(
          409,
          'RECOVERY_FUNDING_UNAVAILABLE',
          'Không tìm thấy giao dịch thanh toán gốc để hoàn phần chênh lệch.',
        );
      }
    }
    if (fundingBooking.id === original.id) {
      await tx.booking.update({
        where: { id: original.id },
        data: { refundRequired: refundDifference > 0 },
      });
    } else {
      await tx.booking.update({
        where: { id: original.id },
        data: { refundRequired: false },
      });
      if (refundDifference > 0) {
        await tx.booking.update({
          where: { id: fundingBooking.id },
          data: { refundRequired: true },
        });
      }
    }
    await tx.recoveryCase.update({
      where: { id: recoveryCase.id },
      data: {
        replacementBookingId: replacementBooking.id,
        status: 'REPLACED',
        replacementAmount: totalAmount,
        refundAmount: refundDifference,
        selectedOptionSnapshot: option,
        acceptedAt: now,
        completedAt: now,
      },
    });
    const liveTripIds = await synchronizeLiveTrip(tx, {
      userId,
      originalBookingId: original.id,
      replacementBookingId: replacementBooking.id,
      option,
      now,
    });
    await writeAuditLog({
      client: tx,
      req,
      action: 'RECOVERY_OPTION_ACCEPTED',
      entityType: 'RecoveryCase',
      entityId: recoveryCase.id,
      metadata: {
        originalBookingId: original.id,
        fundingBookingId: fundingBooking.id,
        replacementBookingId: replacementBooking.id,
        refundDifference,
        ticketProductId,
        timeSlotId,
      },
    });

    return {
      expired: false,
      replayed: false,
      recoveryCaseId: recoveryCase.id,
      originalBookingId: original.id,
      replacementBookingId: replacementBooking.id,
      refundDifference,
      liveTripIds,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function declineRecoveryCase({
  recoveryCaseId,
  userId,
  now = new Date(),
  req = null,
}) {
  return prisma.$transaction(async (tx) => {
    const recoveryCase = await tx.recoveryCase.findUnique({
      where: { id: recoveryCaseId },
      include: CASE_INCLUDE,
    });
    if (!recoveryCase || recoveryCase.userId !== userId) {
      throw createRecoveryError(404, 'RECOVERY_NOT_FOUND', 'Không tìm thấy yêu cầu cứu chuyến.');
    }
    if (
      recoveryCase.declinedAt
      && ['REFUND_PENDING', 'REFUNDED'].includes(recoveryCase.status)
    ) {
      return { ...recoveryCase, replayed: true };
    }
    if (recoveryCase.status !== 'OPEN') {
      throw createRecoveryError(409, 'RECOVERY_ALREADY_DECIDED', 'Yêu cầu này đã được xử lý.');
    }

    const claimed = await tx.recoveryCase.updateMany({
      where: { id: recoveryCase.id, userId, status: 'OPEN', version: recoveryCase.version },
      data: { declinedAt: now, version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw createRecoveryError(409, 'RECOVERY_ALREADY_DECIDED', 'Yêu cầu vừa được xử lý ở thiết bị khác.');
    }

    const updated = await queueFullRecoveryRefund(
      tx,
      recoveryCase,
      { now, reason: 'Khách chọn nhận hoàn tiền 100% thay vì đổi vé.' },
    );
    await writeAuditLog({
      client: tx,
      req,
      action: 'RECOVERY_REFUND_SELECTED',
      entityType: 'RecoveryCase',
      entityId: recoveryCase.id,
      metadata: { originalBookingId: recoveryCase.originalBookingId },
    });
    return { ...updated, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function serializeReplacementBooking(booking) {
  if (!booking) return null;
  return {
    id: booking.id,
    status: booking.status,
    totalAmount: Number(booking.totalAmount),
    attractionTitle: booking.snapshotAttractionTitle,
    visitDate: dateKey(booking.snapshotVisitDate),
    timeSlotLabel: booking.snapshotTimeSlotLabel,
    ticketCount: booking.ticketInstances?.length || 0,
  };
}

function serializeRecoveryRefund(recoveryCase) {
  const requests = recoveryCase?.fundingBooking?.refundRequests || [];
  const expectedKeys = new Set([
    `recovery-full:${recoveryCase.id}`,
    `recovery-difference:${recoveryCase.id}`,
  ]);
  const request = requests.find((item) => expectedKeys.has(item.requestKey));
  if (!request) return null;
  const transaction = request.refundTransactions?.[0] || null;
  return {
    requestId: request.id,
    type: request.requestKey.startsWith('recovery-difference:')
      ? 'DIFFERENCE'
      : 'FULL',
    status: request.status,
    amount: Number(request.amount),
    requestedAt: request.createdAt,
    processingStartedAt: request.processingStartedAt,
    processedAt: request.processedAt,
    transaction: transaction
      ? {
        id: transaction.id,
        status: transaction.status,
        gatewayResponseCode: transaction.gatewayResponseCode,
        submittedAt: transaction.submittedAt,
        reconciledAt: transaction.reconciledAt,
        processedAt: transaction.processedAt,
      }
      : null,
  };
}

function serializeRecoveryCase(
  recoveryCase,
  { options, optionsUnavailable = undefined } = {},
) {
  return {
    id: recoveryCase.id,
    status: recoveryCase.status,
    trigger: recoveryCase.trigger,
    reason: recoveryCase.reason,
    creditAmount: Number(recoveryCase.creditAmount),
    replacementAmount: recoveryCase.replacementAmount == null
      ? null
      : Number(recoveryCase.replacementAmount),
    refundAmount: Number(recoveryCase.refundAmount),
    expiresAt: recoveryCase.expiresAt,
    originalBookingId: recoveryCase.originalBookingId,
    replacementBookingId: recoveryCase.replacementBookingId,
    original: recoveryCase.originalSnapshot,
    selectedOption: recoveryCase.selectedOptionSnapshot || null,
    replacementBooking: serializeReplacementBooking(recoveryCase.replacementBooking),
    refundProgress: serializeRecoveryRefund(recoveryCase),
    acceptedAt: recoveryCase.acceptedAt,
    declinedAt: recoveryCase.declinedAt,
    completedAt: recoveryCase.completedAt,
    createdAt: recoveryCase.createdAt,
    ...(options ? { options } : {}),
    ...(typeof optionsUnavailable === 'boolean' ? { optionsUnavailable } : {}),
  };
}

module.exports = {
  CASE_INCLUDE,
  DEFAULT_RECOVERY_WINDOW_MS,
  MAX_RECOVERY_OPTIONS,
  MAX_RECOVERY_WINDOW_MS,
  MIN_RECOVERY_WINDOW_MS,
  ORIGINAL_BOOKING_INCLUDE,
  RECOVERY_WINDOW_MS,
  acceptRecoveryOption,
  buildOriginalSnapshot,
  buildRecoveryOptionFingerprint,
  buildTicketRestrictions,
  createRecoveryCaseForCancellation,
  createRecoveryError,
  declineRecoveryCase,
  expireRecoveryCase,
  findEligibleRecoveryOptions,
  getRecoveryExpiry,
  getRecoveryCaseDetail,
  isNoWorseRefundTerms,
  isNoStricterThanOriginal,
  normalizeRecoveryWindowMs,
  resolveRecoveryFundingBooking,
  serializeRecoveryCase,
  serializeRecoveryRefund,
  sweepExpiredRecoveryCases,
  synchronizeLiveTrip,
};
