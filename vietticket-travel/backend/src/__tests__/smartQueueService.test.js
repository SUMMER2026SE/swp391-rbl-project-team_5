'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  assertQueueEligibility,
  buildWaitEstimate,
  getQueueSnapshot,
  joinQueue,
  markQueueAdmittedForBooking,
  refreshQueueRecord,
  selectQueuePressure,
  sweepSmartQueues,
} = require('../services/smartQueueService');

const NOW = new Date('2099-03-10T02:00:00.000Z'); // 09:00 tại Việt Nam
const VISIT_DATE = new Date('2099-03-10T00:00:00.000Z');

function queueItem(overrides = {}) {
  return {
    id: 'item-1',
    liveTripId: 'trip-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    scheduledStart: new Date('2099-03-10T03:00:00.000Z'),
    scheduledEnd: new Date('2099-03-10T05:00:00.000Z'),
    snapshot: { visitDate: '2099-03-10', title: 'Bảo tàng Chăm' },
    attraction: {
      id: 'attraction-1',
      title: 'Bảo tàng Chăm',
      city: 'Đà Nẵng',
      operationalStatus: 'ACTIVE',
    },
    booking: {
      id: 'booking-1',
      userId: 'user-1',
      status: 'CONFIRMED',
      snapshotVisitDate: VISIT_DATE,
      reservation: { date: VISIT_DATE, quantity: 3 },
      ticketInstances: [{ status: 'VALID' }, { status: 'VALID' }, { status: 'VALID' }],
    },
    smartQueueEntry: null,
    ...overrides,
  };
}

function pressureMocks() {
  mockPrisma.attraction.findUnique.mockResolvedValue({
    id: 'attraction-1',
    title: 'Bảo tàng Chăm',
    city: 'Đà Nẵng',
    defaultCapacity: 100,
    operationalStatus: 'ACTIVE',
    environment: 'INDOOR',
    status: 'APPROVED',
    publicationStatus: 'ACTIVE',
    archivedAt: null,
  });
  mockPrisma.attractionDailyStock.findUnique.mockResolvedValue({
    capacity: 100,
    bookedQty: 100,
    heldQty: 0,
  });
  mockPrisma.specialDate.findUnique.mockResolvedValue(null);
  mockPrisma.timeSlot.findMany.mockResolvedValue([]);
  mockPrisma.booking.count.mockResolvedValueOnce(20).mockResolvedValueOnce(0);
  mockPrisma.ticketInstance.count.mockResolvedValue(40);
  mockPrisma.smartQueueEntry.findMany.mockResolvedValue([]);
  mockPrisma.smartQueueEntry.aggregate.mockResolvedValue({ _sum: { partySize: 0 } });
  mockPrisma.smartQueueEntry.count.mockResolvedValue(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  mockPrisma.liveTripEvent.create.mockResolvedValue({ id: 'event-1' });
});

test('queue eligibility requires a confirmed owned booking on the visit date', () => {
  expect(assertQueueEligibility(queueItem(), NOW)).toMatchObject({
    partySize: 3,
    visitDateKey: '2099-03-10',
  });

  expect(() => assertQueueEligibility(queueItem({ bookingId: null, booking: null }), NOW))
    .toThrow('đã liên kết booking');
  expect(() => assertQueueEligibility(queueItem({
    booking: { ...queueItem().booking, status: 'REFUNDED' },
  }), NOW)).toThrow('đã xác nhận');
});

test('wait estimate uses recent QR throughput and caps the result', () => {
  expect(buildWaitEstimate({
    entry: { status: 'WAITING', partySize: 2 },
    guestsAhead: 8,
    pressure: { summary: { capacity: 100, checkinsLast15Minutes: 5 } },
  })).toEqual({
    estimatedWaitMinutes: 30,
    estimateBasis: 'RECENT_QR_THROUGHPUT',
    confidence: 'HIGH',
  });

  expect(buildWaitEstimate({
    entry: { status: 'READY', partySize: 2 },
    guestsAhead: 20,
    pressure: { summary: { capacity: 100, checkinsLast15Minutes: 0 } },
  }).estimatedWaitMinutes).toBe(0);
});

test('wait estimate never labels fallback or low-confidence predictions as ML', () => {
  const fallbackEstimate = buildWaitEstimate({
    entry: { status: 'WAITING', partySize: 2 },
    guestsAhead: 8,
    pressure: { summary: { capacity: 100, checkinsLast15Minutes: 5 } },
    arrivalPrediction: {
      predictedP50: 20,
      confidence: 'HIGH',
      usedFallback: true,
    },
  });
  expect(fallbackEstimate).toEqual({
    estimatedWaitMinutes: 30,
    estimateBasis: 'RECENT_QR_THROUGHPUT',
    confidence: 'HIGH',
  });

  const lowConfidenceEstimate = buildWaitEstimate({
    entry: { status: 'WAITING', partySize: 2 },
    guestsAhead: 8,
    pressure: { summary: { capacity: 100, checkinsLast15Minutes: 0 } },
    arrivalPrediction: {
      predictedP50: 20,
      confidence: 'LOW',
      usedFallback: false,
    },
    policy: { fallbackThroughput15m: 10 },
  });
  expect(lowConfidenceEstimate).toEqual({
    estimatedWaitMinutes: 15,
    estimateBasis: 'CAPACITY_FALLBACK',
    confidence: 'LOW',
  });
});

test('queue pressure follows the booked time slot instead of the day aggregate', () => {
  const pressure = {
    summary: { score: 25, label: 'Thoáng', capacity: 500 },
    slots: [
      {
        timeSlotId: 'slot-busy',
        startTime: '09:00',
        endTime: '10:00',
        score: 82,
        label: 'Đông',
        capacity: 50,
      },
    ],
  };

  expect(selectQueuePressure(pressure, {
    booking: { reservation: { timeSlotId: 'slot-busy' } },
  })).toMatchObject({
    summary: { score: 82, label: 'Đông', capacity: 50 },
    pressureScope: 'TIME_SLOT',
    selectedTimeSlot: { timeSlotId: 'slot-busy', startTime: '09:00', endTime: '10:00' },
  });
});

test('joins a busy attraction queue without calling the party before the gate window', async () => {
  const item = queueItem();
  const savedEntry = {
    id: 'queue-1',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    userId: 'user-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    visitDate: VISIT_DATE,
    partySize: 3,
    status: 'WAITING',
    joinedAt: NOW,
    readyAt: null,
    admittedAt: null,
    cancelledAt: null,
    expiresAt: item.scheduledEnd,
    attraction: item.attraction,
  };
  mockPrisma.liveTripItem.findFirst.mockResolvedValue(item);
  pressureMocks();
  mockPrisma.smartQueueEntry.create.mockResolvedValue(savedEntry);
  mockPrisma.smartQueueEntry.findUnique.mockResolvedValue(savedEntry);
  mockPrisma.smartQueueEntry.updateMany.mockResolvedValue({ count: 1 });

  const result = await joinQueue({
    tripId: 'trip-1',
    itemId: 'item-1',
    userId: 'user-1',
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result.created).toBe(true);
  expect(result.queue).toMatchObject({
    status: 'WAITING',
    partySize: 3,
    position: 1,
    estimateBasis: 'RECENT_QR_THROUGHPUT',
  });
  expect(mockPrisma.smartQueueEntry.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ partySize: 3, bookingId: 'booking-1' }),
  }));
  expect(mockPrisma.liveTripEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'QUEUE_JOINED' }),
  }));
});

test('a concurrent duplicate join preserves the original FIFO time and event', async () => {
  const item = queueItem();
  const existingEntry = {
    id: 'queue-existing',
    liveTripId: item.liveTripId,
    liveTripItemId: item.id,
    userId: 'user-1',
    attractionId: item.attractionId,
    bookingId: item.bookingId,
    visitDate: VISIT_DATE,
    partySize: 3,
    status: 'WAITING',
    joinedAt: new Date(NOW.getTime() - 5000),
    readyAt: null,
    admittedAt: null,
    cancelledAt: null,
    expiresAt: item.scheduledEnd,
    attraction: item.attraction,
  };
  mockPrisma.liveTripItem.findFirst.mockResolvedValue(item);
  pressureMocks();
  mockPrisma.smartQueueEntry.create.mockRejectedValue({ code: 'P2002' });
  mockPrisma.smartQueueEntry.findUnique.mockResolvedValue(existingEntry);
  mockPrisma.smartQueueEntry.updateMany.mockResolvedValue({ count: 1 });

  const result = await joinQueue({
    tripId: item.liveTripId,
    itemId: item.id,
    userId: 'user-1',
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result.created).toBe(false);
  expect(result.queue.joinedAt).toEqual(existingEntry.joinedAt);
  const eventTypes = mockPrisma.liveTripEvent.create.mock.calls
    .map(([call]) => call.data.type);
  expect(eventTypes).not.toContain('QUEUE_JOINED');
  expect(mockPrisma.smartQueueEntry.update).not.toHaveBeenCalled();
});

test('enforces one SmartQueue enrolment per booked experience', async () => {
  const cancelledEntry = {
    id: 'queue-cancelled',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    userId: 'user-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    visitDate: VISIT_DATE,
    partySize: 3,
    status: 'CANCELLED',
    joinedAt: new Date(NOW.getTime() - 60_000),
    cancelledAt: new Date(NOW.getTime() - 30_000),
    expiresAt: new Date('2099-03-10T05:00:00.000Z'),
  };
  const item = queueItem({ smartQueueEntry: cancelledEntry });
  mockPrisma.liveTripItem.findFirst.mockResolvedValue(item);

  await expect(joinQueue({
    tripId: item.liveTripId,
    itemId: item.id,
    userId: 'user-1',
    prismaClient: mockPrisma,
    now: NOW,
  })).rejects.toMatchObject({ code: 'QUEUE_DAILY_LIMIT_REACHED', statusCode: 409 });
  expect(mockPrisma.smartQueueEntry.updateMany).not.toHaveBeenCalled();
  expect(mockPrisma.liveTripEvent.create).not.toHaveBeenCalled();
});

test('rejects a new enrolment when the finite queue capacity is full', async () => {
  const item = queueItem();
  mockPrisma.liveTripItem.findFirst.mockResolvedValue(item);
  pressureMocks();
  mockPrisma.smartQueuePolicy.findUnique.mockResolvedValue({
    enabled: true,
    mode: 'AUTO',
    openBeforeMinutes: 120,
    maxActiveParties: 1,
  });
  mockPrisma.smartQueueEntry.count.mockResolvedValueOnce(1);

  await expect(joinQueue({
    tripId: item.liveTripId,
    itemId: item.id,
    userId: 'user-1',
    prismaClient: mockPrisma,
    now: NOW,
  })).rejects.toMatchObject({ code: 'QUEUE_FULL', statusCode: 409 });
  expect(mockPrisma.smartQueueEntry.create).not.toHaveBeenCalled();
});

test('QR admission closes every active queue entry for the booking', async () => {
  mockPrisma.smartQueueEntry.findMany.mockResolvedValue([{
    id: 'queue-1',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    userId: 'user-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    visitDate: VISIT_DATE,
    partySize: 3,
    status: 'READY',
    joinedAt: NOW,
    expiresAt: new Date('2099-03-10T05:00:00.000Z'),
  }]);
  mockPrisma.smartQueueEntry.updateMany.mockResolvedValue({ count: 1 });

  const result = await markQueueAdmittedForBooking('booking-1', {
    prismaClient: mockPrisma,
    admittedAt: NOW,
  });

  expect(result).toEqual({ count: 1, entryIds: ['queue-1'] });
  expect(mockPrisma.smartQueueEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'ADMITTED', admittedAt: NOW },
  }));
  expect(mockPrisma.liveTripEvent.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ type: 'QUEUE_ADMITTED' }),
  }));
});

test('worker self-heals an active queue when QR check-in succeeded but its hook failed', async () => {
  const entry = {
    id: 'queue-1',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    userId: 'user-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    visitDate: VISIT_DATE,
    partySize: 3,
    status: 'READY',
    joinedAt: NOW,
    expiresAt: new Date('2099-03-10T05:00:00.000Z'),
    booking: {
      status: 'CONFIRMED',
      ticketInstances: [{ id: 'used-ticket-1' }],
    },
  };
  mockPrisma.smartQueueEntry.findMany
    .mockResolvedValueOnce([entry])
    .mockResolvedValueOnce([entry]);
  mockPrisma.smartQueueEntry.updateMany.mockResolvedValue({ count: 1 });

  const result = await sweepSmartQueues({ prismaClient: mockPrisma, now: NOW });

  expect(result).toEqual({ scanned: 1, ready: 0, admitted: 1, expired: 0 });
  expect(mockPrisma.smartQueueEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: entry.id, status: { in: ['WAITING', 'READY'] } },
    data: { status: 'ADMITTED', admittedAt: NOW },
  }));
});

test('reading queue state computes position without mutating queue status', async () => {
  const entry = {
    id: 'queue-1',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    userId: 'user-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    visitDate: VISIT_DATE,
    partySize: 2,
    status: 'WAITING',
    joinedAt: NOW,
    expiresAt: new Date('2099-03-10T05:00:00.000Z'),
    liveTripItem: {
      scheduledStart: new Date('2099-03-10T02:10:00.000Z'),
    },
  };
  mockPrisma.smartQueueEntry.count.mockResolvedValue(2);
  mockPrisma.smartQueueEntry.aggregate.mockResolvedValue({ _sum: { partySize: 5 } });

  const state = await getQueueSnapshot(entry, {
    prismaClient: mockPrisma,
    now: NOW,
    pressure: { summary: { capacity: 100, checkinsLast15Minutes: 5, score: 80 } },
  });

  expect(state).toMatchObject({ status: 'WAITING', position: 3, guestsAhead: 5 });
  expect(mockPrisma.smartQueueEntry.updateMany).not.toHaveBeenCalled();
});

test('AUTO can release the next FIFO party while an earlier party is already READY', async () => {
  const entry = {
    id: 'queue-2',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-2',
    userId: 'user-2',
    attractionId: 'attraction-1',
    bookingId: 'booking-2',
    visitDate: VISIT_DATE,
    partySize: 2,
    status: 'WAITING',
    joinedAt: NOW,
    expiresAt: new Date('2099-03-10T05:00:00.000Z'),
    liveTripItem: {
      scheduledStart: new Date('2099-03-10T02:10:00.000Z'),
    },
  };
  mockPrisma.smartQueuePolicy.findUnique.mockResolvedValue({
    enabled: true,
    mode: 'AUTO',
    maxReadyParties: 3,
    readyGraceMinutes: 10,
  });
  // Customer position sees one READY party ahead, but FIFO release only checks
  // older WAITING parties and therefore sees zero.
  mockPrisma.smartQueueEntry.count
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(1);
  mockPrisma.smartQueueEntry.aggregate.mockResolvedValue({ _sum: { partySize: 4 } });
  mockPrisma.smartQueueEntry.updateMany.mockResolvedValue({ count: 1 });

  const state = await refreshQueueRecord(entry, {
    prismaClient: mockPrisma,
    now: NOW,
    pressure: {
      isClosed: false,
      summary: { capacity: 100, checkinsLast15Minutes: 0, score: 80 },
    },
  });

  expect(state).toMatchObject({
    status: 'READY',
    readyExpiresAt: new Date('2099-03-10T02:10:00.000Z'),
  });
});

test('AUTO does not call a party before the 15-minute gate window', async () => {
  const entry = {
    id: 'queue-early',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-early',
    userId: 'user-1',
    attractionId: 'attraction-1',
    bookingId: 'booking-1',
    visitDate: VISIT_DATE,
    partySize: 2,
    status: 'WAITING',
    joinedAt: NOW,
    expiresAt: new Date('2099-03-10T05:00:00.000Z'),
    liveTripItem: {
      scheduledStart: new Date('2099-03-10T03:00:00.000Z'),
    },
  };
  mockPrisma.smartQueuePolicy.findUnique.mockResolvedValue({
    enabled: true,
    mode: 'AUTO',
    maxReadyParties: 3,
    readyGraceMinutes: 10,
  });
  mockPrisma.smartQueueEntry.count
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0);
  mockPrisma.smartQueueEntry.aggregate.mockResolvedValue({ _sum: { partySize: null } });

  const state = await refreshQueueRecord(entry, {
    prismaClient: mockPrisma,
    now: NOW,
    pressure: {
      isClosed: false,
      summary: { capacity: 100, checkinsLast15Minutes: 0, score: 80 },
    },
  });

  expect(state.status).toBe('WAITING');
  expect(mockPrisma.smartQueueEntry.updateMany).not.toHaveBeenCalled();
});
