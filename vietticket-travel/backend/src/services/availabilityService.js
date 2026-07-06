'use strict';

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
          specialDates: { where: { date }, take: 1 },
          timeSlots: {
            where: { ticketProductId: null, isActive: true },
            orderBy: { startTime: 'asc' },
          },
        },
      },
    },
  });

  const attraction = product?.attraction;
  if (
    !product ||
    product.status !== 'ACTIVE' ||
    product.archivedAt ||
    !attraction ||
    !attraction.publishedAt ||
    attraction.publicationStatus !== 'ACTIVE' ||
    attraction.status === 'SUSPENDED' ||
    attraction.archivedAt
  ) {
    const error = new Error('Gói vé hiện không khả dụng.');
    error.statusCode = 404;
    throw error;
  }

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

async function getTicketAvailability(client, ticketProductId, date) {
  const schedule = await getBookableSchedule(client, ticketProductId, date);

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

  const productAvailable = Math.max(
    0,
    Number(dailyStock?.capacity ?? getProductCapacity(schedule))
      - Number(dailyStock?.bookedQuantity || 0)
      - Number(dailyStock?.heldQuantity || 0),
  );
  const attractionAvailable = Math.max(
    0,
    Number(attractionStock?.capacity ?? schedule.dayCapacity)
      - Number(attractionStock?.bookedQty || 0)
      - Number(attractionStock?.heldQty || 0),
  );
  const stockBySlot = new Map(slotStocks.map((stock) => [stock.timeSlotId, stock]));

  const slots = schedule.slots.length > 0
    ? schedule.slots.map((slot) => {
        const stock = stockBySlot.get(slot.id);
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
            slotAvailable,
            productAvailable,
            attractionAvailable,
          ),
        };
      })
    : [{
        id: 'all-day',
        timeSlotId: null,
        startTime: schedule.attraction.openTime || null,
        endTime: schedule.attraction.closeTime || null,
        label: 'Ve su dung trong ngay',
        maxCapacity: Math.min(getProductCapacity(schedule), schedule.dayCapacity),
        availableTickets: Math.min(productAvailable, attractionAvailable),
      }];

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

module.exports = {
  getBookableSchedule,
  getProductCapacity,
  getTicketAvailability,
  getSlotCapacity,
  parseOpenDays,
};
