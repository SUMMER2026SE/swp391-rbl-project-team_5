'use strict';

const prisma = require('../config/prisma');

const DEFAULT_SHOW_RATE = 0.9;
const MIN_SHOW_RATE = 0.6;
const MAX_SHOW_RATE = 1;
const CHECKIN_WINDOW_MINUTES = 15;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function parseDateKey(value, fieldName = 'date') {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw createHttpError(400, 'INVALID_DATE', `${fieldName} phải có định dạng YYYY-MM-DD.`);
  }

  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw createHttpError(400, 'INVALID_DATE', `${fieldName} không phải là ngày hợp lệ.`);
  }

  return { key: raw, date };
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(amount || 0));
  return next;
}

function getDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function getVietnamDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

function getVietnamTimeKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(11, 16);
}

function getPressureLevel(score, closed = false) {
  if (closed) return 'CLOSED';
  if (score >= 85) return 'VERY_BUSY';
  if (score >= 70) return 'BUSY';
  if (score >= 40) return 'MODERATE';
  return 'QUIET';
}

function getPressureLabel(level) {
  return {
    CLOSED: 'Đang đóng cửa',
    VERY_BUSY: 'Rất đông',
    BUSY: 'Đông',
    MODERATE: 'Vừa phải',
    QUIET: 'Thoáng',
  }[level] || 'Chưa xác định';
}

/**
 * Tính chỉ số áp lực lượt đến từ dữ liệu nghiệp vụ hiện có.
 * Đây là occupancy proxy, không phải phép đo số người bằng cảm biến.
 */
function calculatePressureScore({
  bookedQty = 0,
  heldQty = 0,
  capacity = 0,
  checkinsLast15Minutes = 0,
  waitingGuests = 0,
  showRate = DEFAULT_SHOW_RATE,
  expectedCheckinsPer15Minutes,
  closed = false,
} = {}) {
  const safeCapacity = Math.max(0, Number(capacity) || 0);
  if (closed || safeCapacity === 0) {
    return {
      score: 0,
      level: getPressureLevel(0, true),
      label: getPressureLabel('CLOSED'),
      scheduledRatio: 0,
      inventoryRatio: 0,
      arrivalBurstRatio: 0,
      queueRatio: 0,
    };
  }

  const numericShowRate = Number(showRate);
  const safeShowRate = Number.isFinite(numericShowRate)
    ? clamp(numericShowRate, MIN_SHOW_RATE, MAX_SHOW_RATE)
    : DEFAULT_SHOW_RATE;
  const adjustedScheduledGuests = Math.max(0, Number(bookedQty) || 0) * safeShowRate
    + Math.max(0, Number(heldQty) || 0) * 0.3;
  const scheduledRatio = adjustedScheduledGuests / safeCapacity;
  const inventoryRatio = (
    Math.max(0, Number(bookedQty) || 0)
    + Math.max(0, Number(heldQty) || 0)
  ) / safeCapacity;
  const expected = Math.max(
    1,
    Number(expectedCheckinsPer15Minutes) || safeCapacity * 0.25,
  );
  const arrivalBurstRatio = clamp(
    (Number(checkinsLast15Minutes) || 0) / expected,
    0,
    1.5,
  );
  const queueRatio = Math.max(0, Number(waitingGuests) || 0) / safeCapacity;
  const weightedScore = Math.round(
    clamp(
      100 * (
        0.65 * scheduledRatio
        + 0.2 * arrivalBurstRatio
        + 0.15 * queueRatio
      ),
      0,
      100,
    ),
  );
  // Tồn chỗ gần cạn là tín hiệu vận hành độc lập với show-rate. Sàn điểm này
  // tránh mô tả một khung đã bán hết là "vừa phải" chỉ vì chưa bắt đầu check-in.
  const inventoryFloor = inventoryRatio >= 1
    ? 85
    : inventoryRatio >= 0.85
      ? 70
      : 0;
  const score = Math.max(weightedScore, inventoryFloor);
  const level = getPressureLevel(score);

  return {
    score,
    level,
    label: getPressureLabel(level),
    scheduledRatio: round(scheduledRatio),
    inventoryRatio: round(inventoryRatio),
    arrivalBurstRatio: round(arrivalBurstRatio),
    queueRatio: round(queueRatio),
  };
}

async function getHistoricalShowRate(client, attractionId, date) {
  const where = {
    snapshotAttractionId: attractionId,
    snapshotVisitDate: { lt: date },
    status: { in: ['COMPLETED', 'NO_SHOW'] },
  };
  const [completed, noShow] = await Promise.all([
    client.booking.count({ where: { ...where, status: 'COMPLETED' } }),
    client.booking.count({ where: { ...where, status: 'NO_SHOW' } }),
  ]);
  const sampleBookings = completed + noShow;

  if (sampleBookings === 0) {
    return {
      showRate: DEFAULT_SHOW_RATE,
      sampleBookings: 0,
      basis: 'OPERATIONAL_DEFAULT',
    };
  }

  return {
    showRate: clamp(completed / sampleBookings, MIN_SHOW_RATE, MAX_SHOW_RATE),
    sampleBookings,
    basis: 'BOOKING_HISTORY',
  };
}

function serializeDate(date) {
  return date instanceof Date ? date.toISOString() : date;
}

async function getAttractionPressure(
  attractionId,
  dateValue,
  { prismaClient = prisma, now = new Date(), publicOnly = false } = {},
) {
  const normalizedAttractionId = String(attractionId || '').trim();
  if (!normalizedAttractionId) {
    throw createHttpError(400, 'INVALID_ATTRACTION', 'attractionId là bắt buộc.');
  }
  const { key: dateKey, date } = parseDateKey(dateValue);
  const referenceNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(referenceNow.getTime())) {
    throw createHttpError(400, 'INVALID_NOW', 'now must be a valid date-time.');
  }

  const attraction = await prismaClient.attraction.findUnique({
    where: { id: normalizedAttractionId },
    select: {
      id: true,
      title: true,
      city: true,
      defaultCapacity: true,
      operationalStatus: true,
      environment: true,
      status: true,
      publicationStatus: true,
      archivedAt: true,
    },
  });
  if (!attraction) {
    throw createHttpError(404, 'ATTRACTION_NOT_FOUND', 'Không tìm thấy điểm tham quan.');
  }
  if (
    publicOnly
    && (
      attraction.status !== 'APPROVED'
      || attraction.publicationStatus !== 'ACTIVE'
      || attraction.archivedAt
    )
  ) {
    throw createHttpError(404, 'ATTRACTION_NOT_FOUND', 'Không tìm thấy điểm tham quan.');
  }

  const [
    dayStock,
    specialDate,
    timeSlots,
    showRateData,
    checkinsLast15Minutes,
    activeQueueEntries,
  ] = await Promise.all([
    prismaClient.attractionDailyStock.findUnique({
      where: { attractionId_date: { attractionId: normalizedAttractionId, date } },
      select: { capacity: true, bookedQty: true, heldQty: true },
    }),
    prismaClient.specialDate.findUnique({
      where: { attractionId_date: { attractionId: normalizedAttractionId, date } },
      select: { closed: true, capacity: true, note: true },
    }),
    prismaClient.timeSlot.findMany({
      where: { attractionId: normalizedAttractionId, isActive: true },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        maxCapacity: true,
        timeSlotStocks: {
          where: { date },
          select: { bookedQty: true, heldQty: true },
        },
      },
    }),
    getHistoricalShowRate(prismaClient, normalizedAttractionId, date),
    prismaClient.ticketInstance.count({
      where: {
        status: 'USED',
        checkedInAt: {
          gte: new Date(referenceNow.getTime() - CHECKIN_WINDOW_MINUTES * 60 * 1000),
          lte: referenceNow,
        },
        booking: {
          snapshotAttractionId: normalizedAttractionId,
          snapshotVisitDate: date,
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
      },
    }),
    prismaClient.smartQueueEntry.findMany({
      where: {
        attractionId: normalizedAttractionId,
        visitDate: date,
        status: { in: ['WAITING', 'READY'] },
        expiresAt: { gt: referenceNow },
      },
      select: {
        partySize: true,
        liveTripItem: { select: { scheduledStart: true } },
      },
    }),
  ]);

  const slotRows = Array.isArray(timeSlots) ? timeSlots : [];
  const slotBookedQty = slotRows.reduce(
    (sum, slot) => sum + Number(slot.timeSlotStocks?.[0]?.bookedQty || 0),
    0,
  );
  const slotHeldQty = slotRows.reduce(
    (sum, slot) => sum + Number(slot.timeSlotStocks?.[0]?.heldQty || 0),
    0,
  );
  const defaultCapacity = Math.max(0, Number(attraction.defaultCapacity) || 0);
  const capacity = Math.max(
    0,
    Number(specialDate?.capacity ?? dayStock?.capacity ?? defaultCapacity),
  );
  const bookedQty = Number(dayStock?.bookedQty ?? slotBookedQty);
  const heldQty = Number(dayStock?.heldQty ?? slotHeldQty);
  const queueRows = Array.isArray(activeQueueEntries) ? activeQueueEntries : [];
  const waitingGuests = queueRows.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.partySize) || 0),
    0,
  );
  const isClosed = attraction.operationalStatus === 'SUSPENDED'
    || specialDate?.closed === true
    || capacity === 0;
  const commonScoreParams = {
    bookedQty,
    heldQty,
    capacity,
    checkinsLast15Minutes,
    waitingGuests,
    showRate: showRateData.showRate,
    closed: isClosed,
  };
  const summary = calculatePressureScore(commonScoreParams);

  const currentVietnamDate = getVietnamDateKey(referenceNow);
  const currentVietnamTime = getVietnamTimeKey(referenceNow);
  const slots = slotRows.map((slot) => {
    const slotStock = slot.timeSlotStocks?.[0] || {};
    const slotCapacity = Math.max(0, Number(slot.maxCapacity) || capacity);
    const slotIsHappeningNow = dateKey === currentVietnamDate
      && currentVietnamTime >= slot.startTime
      && currentVietnamTime < slot.endTime;
    const slotCheckinsLast15Minutes = slotIsHappeningNow ? checkinsLast15Minutes : 0;
    const slotWaitingGuests = queueRows.reduce((sum, entry) => {
      const scheduledTime = getVietnamTimeKey(entry.liveTripItem?.scheduledStart);
      if (!scheduledTime) return sum;
      return scheduledTime >= slot.startTime && scheduledTime < slot.endTime
        ? sum + Math.max(0, Number(entry.partySize) || 0)
        : sum;
    }, 0);
    const score = calculatePressureScore({
      ...commonScoreParams,
      bookedQty: slotStock.bookedQty,
      heldQty: slotStock.heldQty,
      capacity: slotCapacity,
      checkinsLast15Minutes: slotCheckinsLast15Minutes,
      waitingGuests: slotWaitingGuests,
    });
    return {
      timeSlotId: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      capacity: slotCapacity,
      bookedQty: Number(slotStock.bookedQty || 0),
      heldQty: Number(slotStock.heldQty || 0),
      checkinsLast15Minutes: slotCheckinsLast15Minutes,
      waitingGuests: slotWaitingGuests,
      availableTickets: Math.max(
        0,
        slotCapacity - Number(slotStock.bookedQty || 0) - Number(slotStock.heldQty || 0),
      ),
      ...score,
    };
  });

  return {
    attraction: {
      id: attraction.id,
      title: attraction.title,
      city: attraction.city,
      environment: attraction.environment,
      operationalStatus: attraction.operationalStatus,
    },
    date: dateKey,
    isClosed,
    closureNote: specialDate?.note || null,
    summary: {
      capacity,
      bookedQty,
      heldQty,
      availableTickets: Math.max(0, capacity - bookedQty - heldQty),
      checkinsLast15Minutes,
      waitingGuests,
      ...summary,
    },
    slots,
    confidence: showRateData.sampleBookings >= 20
      ? 'HIGH'
      : showRateData.sampleBookings >= 5
        ? 'MEDIUM'
        : 'LOW',
    showRate: round(showRateData.showRate, 3),
    showRateSampleBookings: showRateData.sampleBookings,
    showRateBasis: showRateData.basis,
    dataBasis: 'BOOKING_STOCK_QR_AND_SMART_QUEUE',
    measurementNote: 'Đây là chỉ số áp lực lượt đến từ booking, tồn chỗ, SmartQueue và QR check-in; không phải số người đếm bằng cảm biến.',
    calculatedAt: serializeDate(referenceNow),
  };
}

module.exports = {
  addDays,
  calculatePressureScore,
  getAttractionPressure,
  getDateKey,
  getPressureLabel,
  getPressureLevel,
  getVietnamDateKey,
  parseDateKey,
};
