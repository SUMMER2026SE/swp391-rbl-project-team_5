'use strict';

const { isBookingCutoffPassed } = require('../utils/activityTime');
const { isTicketProductSaleEnabled } = require('./catalogVisibilityService');

function parseOpenDays(csv) {
  if (!csv) return [true, true, true, true, true, true, true];
  const values = String(csv)
    .split(',')
    .slice(0, 7)
    .map((value) => value.trim() === '1');
  while (values.length < 7) values.push(true);
  return values;
}

function mondayFirstDayIndex(date) {
  return (date.getUTCDay() + 6) % 7;
}

function buildScheduleFromProduct(product, date) {
  const attraction = product?.attraction;
  if (!isTicketProductSaleEnabled(product)) return null;

  const specialDate = attraction.specialDates[0] || null;
  const isRegularOpen = parseOpenDays(attraction.openDays)[mondayFirstDayIndex(date)];
  const isClosed = specialDate ? specialDate.closed : !isRegularOpen;
  const dayCapacity = Math.max(
    0,
    Number(specialDate?.capacity ?? attraction.defaultCapacity ?? 0),
  );
  const slots = product.timeSlots.length > 0
    ? product.timeSlots
    : attraction.timeSlots;

  return {
    product,
    attraction,
    specialDate,
    isClosed: isClosed || dayCapacity === 0,
    dayCapacity,
    slots,
    slotSource: product.timeSlots.length > 0 ? 'ticket' : 'attraction',
  };
}

async function getBookableSchedule(client, ticketProductId, date) {
  const product = await client.ticketProduct.findUnique({
    where: { id: ticketProductId },
    include: {
      timeSlots: {
        where: { isActive: true },
        orderBy: { startTime: 'asc' },
      },
      attraction: {
        include: {
          partner: { select: { status: true, commissionRate: true } },
          specialDates: { where: { date }, take: 1 },
          timeSlots: {
            where: { ticketProductId: null, isActive: true },
            orderBy: { startTime: 'asc' },
          },
        },
      },
    },
  });

  const schedule = buildScheduleFromProduct(product, date);
  if (!schedule) {
    const error = new Error('Gói vé hiện không khả dụng.');
    error.statusCode = 404;
    throw error;
  }
  return schedule;
}

function getProductCapacity(schedule) {
  if (schedule.slots.length === 0) return schedule.dayCapacity;
  const slotCapacity = schedule.slots.reduce(
    (total, slot) => total + Math.max(0, Number(slot.maxCapacity || 0)),
    0,
  );
  return Math.min(schedule.dayCapacity, slotCapacity);
}

function getSlotCapacity(schedule, slot) {
  return Math.min(
    schedule.dayCapacity,
    Math.max(0, Number(slot?.maxCapacity || 0)),
  );
}

function buildAvailabilityResult(
  schedule,
  date,
  { dailyStock, attractionStock, slotStocks = [] },
  { now = new Date() } = {},
) {
  if (schedule.isClosed) {
    return {
      closed: true,
      reason: 'Dia diem dong cua trong ngay da chon.',
      slots: [],
      availableTickets: 0,
      productAvailable: 0,
      attractionAvailable: 0,
      dayCapacity: schedule.dayCapacity,
      slotSource: schedule.slotSource,
    };
  }

  const productAvailable = Math.max(
    0,
    getProductCapacity(schedule)
      - Number(dailyStock?.bookedQuantity || 0)
      - Number(dailyStock?.heldQuantity || 0),
  );
  const attractionAvailable = Math.max(
    0,
    schedule.dayCapacity
      - Number(attractionStock?.bookedQty || 0)
      - Number(attractionStock?.heldQty || 0),
  );
  const stockBySlot = new Map(slotStocks.map((stock) => [stock.timeSlotId, stock]));

  const slots = schedule.slots.length > 0
    ? schedule.slots.map((slot) => {
        const stock = stockBySlot.get(slot.id);
        const cutoffPassed = isBookingCutoffPassed({
          date,
          timeSlot: slot,
          attraction: schedule.attraction,
          now,
        });
        const slotAvailable = Math.max(
          0,
          getSlotCapacity(schedule, slot)
            - Number(stock?.bookedQty || 0)
            - Number(stock?.heldQty || 0),
        );
        return {
          id: slot.id,
          timeSlotId: slot.id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          maxCapacity: getSlotCapacity(schedule, slot),
          slotAvailable,
          availableTickets: Math.min(
            cutoffPassed ? 0 : slotAvailable,
            cutoffPassed ? 0 : productAvailable,
            cutoffPassed ? 0 : attractionAvailable,
          ),
          bookingClosed: cutoffPassed,
        };
      })
    : (() => {
        const cutoffPassed = isBookingCutoffPassed({
          date,
          attraction: schedule.attraction,
          now,
        });
        return [{
          id: 'all-day',
          timeSlotId: null,
          startTime: schedule.attraction.openTime || null,
          endTime: schedule.attraction.closeTime || null,
          label: 'Ve su dung trong ngay',
          maxCapacity: Math.min(getProductCapacity(schedule), schedule.dayCapacity),
          availableTickets: cutoffPassed
            ? 0
            : Math.min(productAvailable, attractionAvailable),
          bookingClosed: cutoffPassed,
        }];
      })();

  return {
    closed: false,
    slots,
    availableTickets: slots.reduce(
      (max, slot) => Math.max(max, Number(slot.availableTickets || 0)),
      0,
    ),
    productAvailable,
    attractionAvailable,
    dayCapacity: schedule.dayCapacity,
    slotSource: schedule.slotSource,
  };
}

async function getTicketAvailability(client, ticketProductId, date, { now = new Date() } = {}) {
  const schedule = await getBookableSchedule(client, ticketProductId, date);

  if (schedule.isClosed) return buildAvailabilityResult(schedule, date, {}, { now });

  const [dailyStock, attractionStock, slotStocks] = await Promise.all([
    client.dailyStock.findUnique({
      where: { ticketProductId_date: { ticketProductId, date } },
    }),
    client.attractionDailyStock.findUnique({
      where: {
        attractionId_date: { attractionId: schedule.attraction.id, date },
      },
    }),
    schedule.slots.length > 0
      ? client.timeSlotStock.findMany({
          where: { timeSlotId: { in: schedule.slots.map((slot) => slot.id) }, date },
        })
      : Promise.resolve([]),
  ]);

  return buildAvailabilityResult(
    schedule,
    date,
    { dailyStock, attractionStock, slotStocks },
    { now },
  );
}

async function getTicketAvailabilityBatch(
  client,
  ticketProductIds,
  date,
  { now = new Date() } = {},
) {
  const ids = [...new Set((ticketProductIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const products = await client.ticketProduct.findMany({
    where: { id: { in: ids } },
    include: {
      timeSlots: {
        where: { isActive: true },
        orderBy: { startTime: 'asc' },
      },
      attraction: {
        include: {
          partner: { select: { status: true, commissionRate: true } },
          specialDates: { where: { date }, take: 1 },
          timeSlots: {
            where: { ticketProductId: null, isActive: true },
            orderBy: { startTime: 'asc' },
          },
        },
      },
    },
  });

  const schedules = (products || [])
    .map((product) => buildScheduleFromProduct(product, date))
    .filter(Boolean);
  const openSchedules = schedules.filter((schedule) => !schedule.isClosed);
  const attractionIds = [...new Set(openSchedules.map((schedule) => schedule.attraction.id))];
  const timeSlotIds = [
    ...new Set(openSchedules.flatMap((schedule) => schedule.slots.map((slot) => slot.id))),
  ];

  const [dailyStocks, attractionStocks, slotStocks] = await Promise.all([
    openSchedules.length > 0
      ? client.dailyStock.findMany({
          where: { ticketProductId: { in: openSchedules.map((item) => item.product.id) }, date },
        })
      : [],
    attractionIds.length > 0
      ? client.attractionDailyStock.findMany({
          where: { attractionId: { in: attractionIds }, date },
        })
      : [],
    timeSlotIds.length > 0
      ? client.timeSlotStock.findMany({
          where: { timeSlotId: { in: timeSlotIds }, date },
        })
      : [],
  ]);

  const dailyByProduct = new Map(
    (dailyStocks || []).map((stock) => [stock.ticketProductId, stock]),
  );
  const stockByAttraction = new Map(
    (attractionStocks || []).map((stock) => [stock.attractionId, stock]),
  );
  const stocksBySlot = new Map();
  (slotStocks || []).forEach((stock) => {
    const current = stocksBySlot.get(stock.timeSlotId) || [];
    current.push(stock);
    stocksBySlot.set(stock.timeSlotId, current);
  });

  return new Map(
    schedules.map((schedule) => [
      schedule.product.id,
      buildAvailabilityResult(
        schedule,
        date,
        {
          dailyStock: dailyByProduct.get(schedule.product.id) || null,
          attractionStock: stockByAttraction.get(schedule.attraction.id) || null,
          slotStocks: schedule.slots.flatMap(
            (slot) => stocksBySlot.get(slot.id) || [],
          ),
        },
        { now },
      ),
    ]),
  );
}

module.exports = {
  getBookableSchedule,
  getProductCapacity,
  getTicketAvailability,
  getTicketAvailabilityBatch,
  getSlotCapacity,
  parseOpenDays,
};
