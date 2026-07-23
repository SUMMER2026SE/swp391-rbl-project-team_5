'use strict';

const prisma = require('../config/prisma');
const {
  getActivityWindow,
  parseSnapshotSlotLabel,
  parseTime,
} = require('../utils/activityTime');
const { todayInVietnam } = require('../utils/refundService');
const {
  addDays,
  getAttractionPressure,
  getDateKey,
  getVietnamDateKey,
  parseDateKey,
} = require('./arrivalPressureService');
const { serializeProposal } = require('./liveTripAutopilotService');
const { serializeLiveTripEvent } = require('./liveTripEventService');
const { getQueueSnapshot, serializeQueueEntry } = require('./smartQueueService');

const MAX_LIVE_TRIP_DAYS = 14;
const MAX_LIVE_TRIP_ITEMS = MAX_LIVE_TRIP_DAYS * 4;
const PRESSURE_QUERY_CONCURRENCY = 4;

const LIVE_TRIP_INCLUDE = {
  items: {
    orderBy: [{ dayIndex: 'asc' }, { orderIndex: 'asc' }],
    include: {
      attraction: {
        select: {
          id: true,
          title: true,
          city: true,
          environment: true,
          latitude: true,
          longitude: true,
          operationalStatus: true,
        },
      },
      booking: {
        select: {
          id: true,
          status: true,
          snapshotVisitDate: true,
          snapshotTimeSlotLabel: true,
        },
      },
      smartQueueEntry: {
        include: {
          attraction: {
            select: {
              id: true,
              title: true,
              city: true,
              operationalStatus: true,
            },
          },
        },
      },
    },
  },
  proposals: {
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  },
  events: {
    orderBy: { createdAt: 'desc' },
    take: 20,
  },
};

const TIME_ALIASES = {
  morning: '08:00',
  'buổi sáng': '08:00',
  sáng: '08:00',
  noon: '11:30',
  'buổi trưa': '11:30',
  trưa: '11:30',
  afternoon: '14:00',
  'buổi chiều': '14:00',
  chiều: '14:00',
  evening: '18:00',
  'buổi tối': '18:00',
  tối: '18:00',
};

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw createHttpError(422, 'INVALID_ITINERARY_DATA', 'Dữ liệu lịch trình không phải JSON hợp lệ.');
  }
}

function dateOnlyKey(date) {
  return date.toISOString().slice(0, 10);
}

function parseTimeValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (parseTime(raw)) return raw;
  return TIME_ALIASES[raw.toLowerCase()] || null;
}

function addMinutesToTime(value, minutes) {
  const parsed = parseTime(value);
  if (!parsed) return null;
  const total = parsed.hour * 60 + parsed.minute + Math.max(1, Number(minutes) || 60);
  const bounded = Math.min(total, 23 * 60 + 59);
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

function resolveActivityTimes(activity, attraction) {
  const suggestedSlot = activity?.suggestedTimeSlot;
  let startTime = parseTimeValue(suggestedSlot?.startTime);
  let endTime = parseTimeValue(suggestedSlot?.endTime);

  const candidates = [
    activity?.suggestedTime,
    activity?.timeSlot,
    activity?.time,
  ];
  for (const candidate of candidates) {
    if (startTime && endTime) break;
    if (isPlainObject(candidate)) {
      startTime ||= parseTimeValue(candidate.startTime || candidate.start);
      endTime ||= parseTimeValue(candidate.endTime || candidate.end);
      continue;
    }
    const aliasTime = parseTimeValue(candidate);
    if (aliasTime && !startTime) {
      startTime = aliasTime;
      continue;
    }
    const parsedRange = parseSnapshotSlotLabel(candidate);
    startTime ||= parseTimeValue(parsedRange.startTime);
    endTime ||= parseTimeValue(parsedRange.endTime);
  }

  startTime ||= parseTimeValue(attraction?.openTime) || '09:00';
  if (!endTime) {
    const isFullDay = activity?.isFullDay === true || attraction?.isFullDay === true;
    endTime = isFullDay
      ? parseTimeValue(attraction?.closeTime)
      : addMinutesToTime(
        startTime,
        activity?.recommendedVisitMinutes || attraction?.recommendedVisitMinutes || 60,
      );
  }

  return { startTime, endTime: endTime || startTime };
}

function resolvePlanData(savedItinerary) {
  const data = savedItinerary?.data;
  if (isPlainObject(data?.plan)) return data.plan;
  if (isPlainObject(data)) return data;
  throw createHttpError(422, 'INVALID_ITINERARY_DATA', 'Lịch trình đã lưu không có dữ liệu hợp lệ.');
}

function resolveStartDate({ plan, criteria, requestedStartDate }) {
  const raw = requestedStartDate || plan?.startDate || criteria?.startDate || criteria?.visitDate;
  if (!raw) {
    throw createHttpError(
      422,
      'LIVE_TRIP_START_DATE_REQUIRED',
      'Lịch trình chưa có ngày bắt đầu. Vui lòng chọn ngày bắt đầu trước khi kích hoạt Trip Mode.',
    );
  }
  return parseDateKey(raw, 'startDate');
}

function getDayActivities(day) {
  if (!isPlainObject(day)) return null;
  if (Array.isArray(day.activities)) return day.activities;
  if (Array.isArray(day.items)) return day.items;
  return [];
}

function extractActivityDescriptors(plan, criteria, requestedStartDate) {
  if (!Array.isArray(plan?.days) || plan.days.length === 0) {
    throw createHttpError(422, 'EMPTY_ITINERARY', 'Lịch trình phải có ít nhất một ngày.');
  }
  if (plan.days.length > MAX_LIVE_TRIP_DAYS) {
    throw createHttpError(422, 'LIVE_TRIP_TOO_LONG', `Trip Mode chỉ hỗ trợ tối đa ${MAX_LIVE_TRIP_DAYS} ngày.`);
  }

  const start = resolveStartDate({ plan, criteria, requestedStartDate });
  if (start.key < todayInVietnam()) {
    throw createHttpError(422, 'LIVE_TRIP_IN_THE_PAST', 'Chỉ có thể kích hoạt Trip Mode từ hôm nay trở đi.');
  }

  const descriptors = [];
  const dayDates = [];
  const latestAllowedDate = addDays(start.date, MAX_LIVE_TRIP_DAYS - 1);
  let previousDayDate = null;
  plan.days.forEach((day, dayIndex) => {
    const explicitDate = day?.visitDate || day?.date;
    const dateInfo = explicitDate
      ? parseDateKey(explicitDate, `plan.days[${dayIndex}].visitDate`)
      : { date: addDays(start.date, dayIndex), key: dateOnlyKey(addDays(start.date, dayIndex)) };

    if (dateInfo.date < start.date) {
      throw createHttpError(
        422,
        'LIVE_TRIP_DAY_BEFORE_START',
        `Day ${dayIndex + 1} cannot be before the trip start date.`,
      );
    }
    if (dateInfo.date > latestAllowedDate) {
      throw createHttpError(
        422,
        'LIVE_TRIP_DAY_OUT_OF_RANGE',
        `Day ${dayIndex + 1} exceeds the ${MAX_LIVE_TRIP_DAYS}-day tracking window.`,
      );
    }
    if (previousDayDate && dateInfo.date < previousDayDate) {
      throw createHttpError(
        422,
        'LIVE_TRIP_DAYS_NOT_ORDERED',
        'Trip days must be in ascending order.',
      );
    }
    previousDayDate = dateInfo.date;
    dayDates.push(dateInfo);

    const activities = getDayActivities(day);
    if (activities === null) {
      throw createHttpError(422, 'INVALID_ITINERARY_DAY', `Ngày thứ ${dayIndex + 1} của lịch trình không hợp lệ.`);
    }
    activities.forEach((activity, orderIndex) => {
      if (!isPlainObject(activity)) {
        throw createHttpError(422, 'INVALID_ITINERARY_ACTIVITY', `Hoạt động ${dayIndex + 1}.${orderIndex + 1} không hợp lệ.`);
      }
      const attractionId = String(activity.attractionId || activity.id || '').trim();
      if (!attractionId) {
        throw createHttpError(
          422,
          'ACTIVITY_ATTRACTION_REQUIRED',
          `Hoạt động ${dayIndex + 1}.${orderIndex + 1} chưa có attractionId nên không thể theo dõi vận hành.`,
        );
      }
      descriptors.push({
        activity,
        attractionId,
        dayIndex,
        orderIndex,
        dateInfo,
      });
    });
  });

  if (descriptors.length === 0) {
    throw createHttpError(422, 'EMPTY_ITINERARY_ACTIVITIES', 'Lịch trình chưa có hoạt động tham quan để theo dõi.');
  }
  if (descriptors.length > MAX_LIVE_TRIP_ITEMS) {
    throw createHttpError(422, 'LIVE_TRIP_TOO_MANY_ITEMS', `Trip Mode chỉ hỗ trợ tối đa ${MAX_LIVE_TRIP_ITEMS} hoạt động.`);
  }

  return { descriptors, start, dayDates };
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), values.length);

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function getOwnedBookings(client, userId, descriptors, startDate, endDate) {
  const attractionIds = [...new Set(descriptors.map((item) => item.attractionId))];
  const bookings = await client.booking.findMany({
    where: {
      userId,
      snapshotAttractionId: { in: attractionIds },
      snapshotVisitDate: { gte: startDate, lte: endDate },
      status: { in: ['PENDING_PARTNER', 'CONFIRMED', 'COMPLETED'] },
    },
    select: {
      id: true,
      status: true,
      snapshotAttractionId: true,
      snapshotVisitDate: true,
      snapshotTimeSlotLabel: true,
      reservation: {
        select: { ticketProductId: true, timeSlotId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return Array.isArray(bookings) ? bookings : [];
}

function getActivityTicketIds(activity) {
  return Array.isArray(activity?.ticketItems)
    ? activity.ticketItems.map((item) => String(item?.ticketId || '')).filter(Boolean)
    : [];
}

function getActivityTimeSlotId(activity) {
  return String(
    activity?.suggestedTimeSlot?.timeSlotId
      || activity?.timeSlotId
      || '',
  ).trim() || null;
}

function findMatchingBooking(descriptor, bookings, usedBookingIds) {
  const dateKey = descriptor.dateInfo.key;
  const ticketIds = getActivityTicketIds(descriptor.activity);
  const timeSlotId = getActivityTimeSlotId(descriptor.activity);
  const explicitBookingId = String(descriptor.activity.bookingId || '').trim();
  const candidates = bookings.filter((booking) => (
    !usedBookingIds.has(booking.id)
    && booking.snapshotAttractionId === descriptor.attractionId
    && getDateKey(booking.snapshotVisitDate) === dateKey
  ));

  if (explicitBookingId) {
    return candidates.find((booking) => booking.id === explicitBookingId) || null;
  }

  return candidates.sort((left, right) => {
    const leftTicketMatch = ticketIds.includes(left.reservation?.ticketProductId) ? 1 : 0;
    const rightTicketMatch = ticketIds.includes(right.reservation?.ticketProductId) ? 1 : 0;
    const leftSlotMatch = timeSlotId && left.reservation?.timeSlotId === timeSlotId ? 1 : 0;
    const rightSlotMatch = timeSlotId && right.reservation?.timeSlotId === timeSlotId ? 1 : 0;
    return (rightTicketMatch - leftTicketMatch) || (rightSlotMatch - leftSlotMatch);
  })[0] || null;
}

function buildSnapshot(descriptor, attraction, dateKey, startTime, endTime, bookingId) {
  return cloneJson({
    title: descriptor.activity.title
      || descriptor.activity.name
      || attraction.title,
    attractionId: descriptor.attractionId,
    attractionTitle: attraction.title,
    city: attraction.city,
    visitDate: dateKey,
    suggestedTime: descriptor.activity.suggestedTime || descriptor.activity.timeSlot || null,
    startTime,
    endTime,
    timeSlotId: getActivityTimeSlotId(descriptor.activity),
    bookingId: bookingId || null,
    activity: descriptor.activity,
  });
}

function serializeTrip(trip) {
  if (!trip) return null;
  return {
    id: trip.id,
    userId: trip.userId,
    savedItineraryId: trip.savedItineraryId,
    title: trip.title,
    startDate: getDateKey(trip.startDate),
    endDate: getDateKey(trip.endDate),
    status: trip.status,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    items: (trip.items || []).map((item) => ({
      id: item.id,
      dayIndex: item.dayIndex,
      orderIndex: item.orderIndex,
      attractionId: item.attractionId,
      bookingId: item.bookingId,
      scheduledStart: item.scheduledStart,
      scheduledEnd: item.scheduledEnd,
      status: item.status,
      snapshot: item.snapshot,
      attraction: item.attraction || null,
      booking: item.booking || null,
      smartQueue: item.smartQueueEntry
        ? serializeQueueEntry(item.smartQueueEntry)
        : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    proposals: (trip.proposals || []).map(serializeProposal),
    events: (trip.events || []).map(serializeLiveTripEvent),
  };
}

async function materializeItems({ client, descriptors, startDate, endDate, userId }) {
  const attractionIds = [...new Set(descriptors.map((item) => item.attractionId))];
  const attractions = await client.attraction.findMany({
    where: {
      id: { in: attractionIds },
      archivedAt: null,
    },
    select: {
      id: true,
      title: true,
      city: true,
      openTime: true,
      closeTime: true,
      recommendedVisitMinutes: true,
      isFullDay: true,
      operationalStatus: true,
    },
  });
  const attractionMap = new Map((attractions || []).map((attraction) => [attraction.id, attraction]));
  const missingAttractionId = attractionIds.find((id) => !attractionMap.has(id));
  if (missingAttractionId) {
    throw createHttpError(
      409,
      'ITINERARY_ATTRACTION_UNAVAILABLE',
      'Lịch trình chứa một điểm tham quan không còn tồn tại hoặc đã bị lưu trữ. Vui lòng tạo lại lịch trình.',
    );
  }

  const bookings = await getOwnedBookings(client, userId, descriptors, startDate, endDate);
  const usedBookingIds = new Set();
  return descriptors.map((descriptor) => {
    const attraction = attractionMap.get(descriptor.attractionId);
    const matchedBooking = findMatchingBooking(descriptor, bookings, usedBookingIds);
    if (matchedBooking) usedBookingIds.add(matchedBooking.id);
    const { startTime, endTime } = resolveActivityTimes(descriptor.activity, attraction);
    const window = getActivityWindow({
      date: descriptor.dateInfo.date,
      timeSlot: { startTime, endTime },
      attraction,
    });

    return {
      attractionId: descriptor.attractionId,
      bookingId: matchedBooking?.id || null,
      dayIndex: descriptor.dayIndex,
      orderIndex: descriptor.orderIndex,
      scheduledStart: window.startsAt,
      scheduledEnd: window.endsAt,
      snapshot: buildSnapshot(
        descriptor,
        attraction,
        descriptor.dateInfo.key,
        startTime,
        endTime,
        matchedBooking?.id,
      ),
    };
  });
}

async function activateLiveTrip({
  userId,
  planId,
  startDate: requestedStartDate,
  prismaClient = prisma,
} = {}) {
  const normalizedPlanId = String(planId || '').trim();
  if (!normalizedPlanId) {
    throw createHttpError(400, 'PLAN_ID_REQUIRED', 'planId là bắt buộc.');
  }
  if (!userId) {
    throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  }

  const saved = await prismaClient.savedItinerary.findUnique({
    where: { userId_planId: { userId, planId: normalizedPlanId } },
    select: { id: true, userId: true, planId: true, title: true, data: true, criteria: true },
  });
  if (!saved) {
    throw createHttpError(404, 'ITINERARY_NOT_FOUND', 'Không tìm thấy lịch trình đã lưu.');
  }

  const existing = await prismaClient.liveTrip.findUnique({
    where: { savedItineraryId: saved.id },
    include: LIVE_TRIP_INCLUDE,
  });
  if (existing) {
    return { created: false, trip: serializeTrip(existing) };
  }

  const plan = resolvePlanData(saved);
  const { descriptors, start, dayDates } = extractActivityDescriptors(
    plan,
    isPlainObject(saved.criteria) ? saved.criteria : {},
    requestedStartDate,
  );
  const endDate = dayDates[dayDates.length - 1].date;
  const items = await materializeItems({
    client: prismaClient,
    descriptors,
    startDate: start.date,
    endDate,
    userId,
  });

  let didCreate = true;
  const createdId = await prismaClient.$transaction(async (tx) => {
    const raceWinner = await tx.liveTrip.findUnique({
      where: { savedItineraryId: saved.id },
      select: { id: true },
    });
    if (raceWinner) {
      didCreate = false;
      return raceWinner.id;
    }

    const created = await tx.liveTrip.create({
      data: {
        userId,
        savedItineraryId: saved.id,
        title: saved.title || plan.title || 'Chuyến đi VietTicket',
        startDate: start.date,
        endDate,
        status: 'ACTIVE',
        items: { create: items },
      },
      select: { id: true },
    });
    return created.id;
  });
  const created = await prismaClient.liveTrip.findUnique({
    where: { id: createdId },
    include: LIVE_TRIP_INCLUDE,
  });
  if (!created) {
    throw createHttpError(409, 'LIVE_TRIP_STATE_CHANGED', 'Chuyến đi đã được tạo nhưng chưa thể đọc lại trạng thái. Vui lòng tải lại.');
  }

  return {
    created: didCreate,
    trip: serializeTrip(created),
  };
}

async function listLiveTrips(userId, { prismaClient = prisma } = {}) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const trips = await prismaClient.liveTrip.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { items: true } } },
  });
  return (trips || []).map((trip) => ({
    id: trip.id,
    savedItineraryId: trip.savedItineraryId,
    title: trip.title,
    startDate: getDateKey(trip.startDate),
    endDate: getDateKey(trip.endDate),
    status: trip.status,
    itemCount: trip._count?.items || 0,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  }));
}

async function findLiveTripForUser(tripId, userId, { prismaClient = prisma } = {}) {
  if (!userId) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');
  const trip = await prismaClient.liveTrip.findFirst({
    where: { id: String(tripId || '').trim(), userId },
    include: LIVE_TRIP_INCLUDE,
  });
  if (!trip) throw createHttpError(404, 'LIVE_TRIP_NOT_FOUND', 'Không tìm thấy chuyến đi đang theo dõi.');
  return trip;
}

async function getLiveTripForUser(tripId, userId, { prismaClient = prisma } = {}) {
  const trip = await findLiveTripForUser(tripId, userId, { prismaClient });
  return serializeTrip(trip);
}

async function getLiveTripOverview(tripId, userId, { prismaClient = prisma, now = new Date() } = {}) {
  const rawTrip = await findLiveTripForUser(tripId, userId, { prismaClient });
  const trip = serializeTrip(rawTrip);
  const itemVisitDate = (item) => item.snapshot?.visitDate || getVietnamDateKey(item.scheduledStart);
  const pressureTargets = [...new Map(
    trip.items
      .filter((item) => item.attractionId)
      .map((item) => [
        `${item.attractionId}:${itemVisitDate(item)}`,
        { attractionId: item.attractionId, date: itemVisitDate(item) },
      ]),
  ).values()];
  const pressureEntries = await mapWithConcurrency(pressureTargets, PRESSURE_QUERY_CONCURRENCY, async ({ attractionId, date }) => {
      try {
        return [
          `${attractionId}:${date}`,
          await getAttractionPressure(attractionId, date, { prismaClient, now }),
        ];
      } catch (error) {
        if (error.statusCode === 404) return [`${attractionId}:${date}`, null];
        throw error;
      }
    });
  const pressureByKey = new Map(pressureEntries);
  const rawItemsById = new Map((rawTrip.items || []).map((item) => [item.id, item]));
  const queueEntries = await mapWithConcurrency(
    trip.items.filter((item) => ['WAITING', 'READY'].includes(item.smartQueue?.status)),
    PRESSURE_QUERY_CONCURRENCY,
    async (item) => {
      const rawEntry = rawItemsById.get(item.id)?.smartQueueEntry;
      if (!rawEntry) return [item.id, item.smartQueue];
      const pressure = item.attractionId
        ? pressureByKey.get(`${item.attractionId}:${itemVisitDate(item)}`) || null
        : null;
      try {
        return [
          item.id,
          await getQueueSnapshot(rawEntry, { prismaClient, now, pressure }),
        ];
      } catch (error) {
        return [item.id, { ...item.smartQueue, refreshError: error.message }];
      }
    },
  );
  const queueByItemId = new Map(queueEntries);

  return {
    ...trip,
    items: trip.items.map((item) => ({
      ...item,
      pressure: item.attractionId
        ? pressureByKey.get(`${item.attractionId}:${itemVisitDate(item)}`) || null
        : null,
      smartQueue: queueByItemId.get(item.id) || item.smartQueue,
    })),
    dataBasis: 'LIVE_TRIP_MATERIALIZED_PLAN',
    measurementNote: 'Pressure là chỉ số áp lực lượt đến từ booking, tồn chỗ và QR check-in; không phải số người đếm bằng cảm biến.',
    calculatedAt: now.toISOString(),
  };
}

module.exports = {
  MAX_LIVE_TRIP_DAYS,
  MAX_LIVE_TRIP_ITEMS,
  activateLiveTrip,
  extractActivityDescriptors,
  findLiveTripForUser,
  getLiveTripForUser,
  getLiveTripOverview,
  listLiveTrips,
  resolveActivityTimes,
  serializeTrip,
};
