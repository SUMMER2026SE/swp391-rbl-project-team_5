'use strict';

const {
  getActivityWindow,
  getBookingActivityWindow,
  getCheckinTimeBlockReason,
  getManualApprovalDeadline,
  isBookingCutoffPassed,
  parseSnapshotSlotLabel,
} = require('../utils/activityTime');

const VISIT_DATE = new Date('2026-07-11T00:00:00.000Z');
const SLOT = { startTime: '08:00', endTime: '10:00' };

function makeBooking() {
  return {
    snapshotVisitDate: VISIT_DATE,
    payments: [{
      status: 'SUCCESS',
      isDuplicate: false,
      paidAt: new Date('2026-07-10T12:00:00.000Z'),
    }],
    reservation: {
      date: VISIT_DATE,
      timeSlot: SLOT,
      ticketProduct: { attraction: { openTime: '07:00', closeTime: '18:00' } },
    },
  };
}

test('converts a Vietnam activity slot to the correct UTC window', () => {
  expect(getActivityWindow({ date: VISIT_DATE, timeSlot: SLOT })).toEqual({
    startsAt: new Date('2026-07-11T01:00:00.000Z'),
    endsAt: new Date('2026-07-11T03:00:00.000Z'),
    startTime: '08:00',
    endTime: '10:00',
  });
});

test('closes booking exactly when the selected activity starts', () => {
  expect(isBookingCutoffPassed({
    date: VISIT_DATE,
    timeSlot: SLOT,
    now: new Date('2026-07-11T00:59:59.999Z'),
  })).toBe(false);
  expect(isBookingCutoffPassed({
    date: VISIT_DATE,
    timeSlot: SLOT,
    now: new Date('2026-07-11T01:00:00.000Z'),
  })).toBe(true);
});

test('limits manual approval by the earlier of 24 hours and activity start', () => {
  expect(getManualApprovalDeadline(makeBooking())).toEqual(
    new Date('2026-07-11T01:00:00.000Z'),
  );
});

test('keeps the sold booking slot immutable when a partner later changes the live slot', () => {
  const booking = makeBooking();
  booking.snapshotTimeSlotLabel = '08:00 - 10:00';
  booking.reservation.timeSlot = { startTime: '09:30', endTime: '11:30' };

  expect(getBookingActivityWindow(booking)).toEqual({
    startsAt: new Date('2026-07-11T01:00:00.000Z'),
    endsAt: new Date('2026-07-11T03:00:00.000Z'),
    startTime: '08:00',
    endTime: '10:00',
  });
});

test('keeps all-day activity hours immutable when attraction hours change later', () => {
  const booking = makeBooking();
  booking.reservation.timeSlot = null;
  booking.snapshotTimeSlotLabel = null;
  booking.snapshotActivityStartTime = '07:30';
  booking.snapshotActivityEndTime = '17:00';
  booking.reservation.ticketProduct.attraction.openTime = '09:00';
  booking.reservation.ticketProduct.attraction.closeTime = '16:00';

  expect(getBookingActivityWindow(booking)).toEqual({
    startsAt: new Date('2026-07-11T00:30:00.000Z'),
    endsAt: new Date('2026-07-11T10:00:00.000Z'),
    startTime: '07:30',
    endTime: '17:00',
  });
});

test('blocks check-in outside the slot and allows it during the slot', () => {
  const booking = makeBooking();
  expect(getCheckinTimeBlockReason(booking, new Date('2026-07-11T00:59:59.999Z')))
    .toEqual(expect.stringContaining('08:00'));
  expect(getCheckinTimeBlockReason(booking, new Date('2026-07-11T02:00:00.000Z')))
    .toBeNull();
  expect(getCheckinTimeBlockReason(booking, new Date('2026-07-11T03:00:00.001Z')))
    .toEqual(expect.stringContaining('10:00'));
});

test.each([
  ['08:00 - 10:00'],
  ['08:00 \u2013 10:00'],
  ['08:00 \u2014 10:00'],
])('parses supported snapshot slot separator: %s', (label) => {
  expect(parseSnapshotSlotLabel(label)).toEqual({ startTime: '08:00', endTime: '10:00' });
});
