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

module.exports = {
  getBookableSchedule,
  getProductCapacity,
  getSlotCapacity,
  parseOpenDays,
};
