'use strict';

const { randomUUID } = require('crypto');
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
const { getActivityWindow, isBookingCutoffPassed } = require('../utils/activityTime');
const { parseVndInteger } = require('../utils/money');
const { writeAuditLog } = require('../utils/auditLog');
const { recordLiveTripEvent } = require('./liveTripEventService');
const {
  awardPointsForBooking,
  reversePointsForBooking,
} = require('./loyaltyService');

const { Decimal } = Prisma;
const DEFAULT_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const MAX_RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1000;
const configuredRecoveryWindow = Number(process.env.RECOVERY_WINDOW_MS);
const RECOVERY_WINDOW_MS = Number.isFinite(configuredRecoveryWindow)
  ? Math.min(
      Math.max(Math.round(configuredRecoveryWindow), MIN_RECOVERY_WINDOW_MS),
      MAX_RECOVERY_WINDOW_MS,
    )
  : DEFAULT_RECOVERY_WINDOW_MS;
const MAX_RECOVERY_OPTIONS = 8;

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

function haversineKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [aLat, aLon, bLat, bLon] = values;
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildOriginalSnapshot(booking) {
  const reservation = booking.reservation;
  const attraction = reservation.ticketProduct.attraction;
  return {
    bookingId: booking.id,
    attractionId: booking.snapshotAttractionId || attraction.id,
    attractionTitle: booking.snapshotAttractionTitle || attraction.title,
    attractionAddress: booking.snapshotAttractionAddress || attraction.address,
    city: booking.snapshotAttractionCity || attraction.city,
    district: booking.snapshotAttractionDistrict || attraction.district || null,
    imageUrl: booking.snapshotAttractionImage || attraction.images?.[0]?.imageUrl || null,
    latitude: attraction.latitude ?? null,
    longitude: attraction.longitude ?? null,
    environment: attraction.environment || 'MIXED',
    ticketName: booking.snapshotTicketName || reservation.ticketProduct.name,
    ticketType: booking.snapshotTicketType || reservation.ticketProduct.type,
    visitDate: dateKey(booking.snapshotVisitDate || reservation.date),
    timeSlotLabel: booking.snapshotTimeSlotLabel || (
      reservation.timeSlot
        ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
        : null
    ),
    startTime: reservation.timeSlot?.startTime || attraction.openTime || null,
    endTime: reservation.timeSlot?.endTime || attraction.closeTime || null,
    quantity: reservation.quantity,
    totalAmount: Number(booking.totalAmount),
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
    return unitPrice != null && unitPrice * original.quantity <= creditAmount;
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
        const rank = scoreOption({
          original,
          attraction: product.attraction,
          totalAmount,
          creditAmount,
          slot,
        });
        options.push({
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
          unitPrice,
          quantity: original.quantity,
          totalAmount,
          refundAmount,
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
        });
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
      completedAt: now,
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
    }
    const snapshot = item.snapshot && typeof item.snapshot === 'object'
      ? item.snapshot
      : {};
    await tx.liveTripItem.update({
      where: { id: item.id },
      data: {
        bookingId: replacementBookingId,
        attractionId: option.attractionId,
        scheduledStart: window.startsAt || item.scheduledStart,
        scheduledEnd: window.endsAt || item.scheduledEnd,
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
        },
      },
    });
    await recordLiveTripEvent({
      client: tx,
      liveTripId: item.liveTripId,
      liveTripItemId: item.id,
      userId,
      type: 'ITEM_RECOVERED',
      severity: 'SUCCESS',
      title: 'Đã cứu kế hoạch bằng vé thay thế',
      message: `${option.attractionTitle} đã thay cho hoạt động bị hủy và vé mới đã được cấp.`,
      data: { originalBookingId, replacementBookingId },
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
        snapshotTicketName: option.ticketName,
        snapshotTicketType: option.ticketType,
        snapshotTicketDescription: option.ticketDescription,
        snapshotUnitPrice: unitPrice,
        snapshotRefundPolicy: schedule.product.refundPolicy,
        snapshotRefundFeeRate: schedule.product.refundFeeRate,
        snapshotRefundCutoffHours: schedule.product.refundCutoffHours,
        snapshotVisitDate: date,
        snapshotTimeSlotLabel: option.startTime
          ? `${option.startTime} - ${option.endTime}`
          : null,
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
    return updated;
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

function serializeRecoveryCase(recoveryCase, { options } = {}) {
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
    acceptedAt: recoveryCase.acceptedAt,
    declinedAt: recoveryCase.declinedAt,
    completedAt: recoveryCase.completedAt,
    createdAt: recoveryCase.createdAt,
    ...(options ? { options } : {}),
  };
}

module.exports = {
  CASE_INCLUDE,
  DEFAULT_RECOVERY_WINDOW_MS,
  MAX_RECOVERY_OPTIONS,
  ORIGINAL_BOOKING_INCLUDE,
  RECOVERY_WINDOW_MS,
  acceptRecoveryOption,
  buildOriginalSnapshot,
  createRecoveryCaseForCancellation,
  createRecoveryError,
  declineRecoveryCase,
  expireRecoveryCase,
  findEligibleRecoveryOptions,
  getRecoveryExpiry,
  resolveRecoveryFundingBooking,
  serializeRecoveryCase,
  sweepExpiredRecoveryCases,
};
