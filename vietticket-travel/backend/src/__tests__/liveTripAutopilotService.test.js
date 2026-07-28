'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  chooseSaferSlot,
  decideProposal,
  refreshTripAutopilot,
  sweepAutopilotTrips,
} = require('../services/liveTripAutopilotService');

const NOW = new Date('2099-03-10T01:00:00.000Z'); // 08:00 tại Việt Nam

function tripItem(overrides = {}) {
  return {
    id: 'item-1',
    liveTripId: 'trip-1',
    attractionId: 'attraction-1',
    bookingId: null,
    dayIndex: 0,
    orderIndex: 0,
    scheduledStart: new Date('2099-03-10T02:00:00.000Z'), // 09:00 VN
    scheduledEnd: new Date('2099-03-10T03:00:00.000Z'),
    status: 'PLANNED',
    snapshot: {
      visitDate: '2099-03-10',
      title: 'Bảo tàng Chăm',
      activity: { ticketItems: [{ ticketId: 'ticket-1', quantity: 2 }] },
    },
    attraction: {
      id: 'attraction-1',
      title: 'Bảo tàng Chăm',
      city: 'Đà Nẵng',
      openTime: '08:00',
      closeTime: '18:00',
      operationalStatus: 'ACTIVE',
    },
    booking: null,
    ...overrides,
  };
}

function pressureResponse() {
  return {
    isClosed: false,
    summary: { score: 85, level: 'VERY_BUSY' },
    slots: [
      {
        timeSlotId: 'slot-current',
        startTime: '09:00',
        endTime: '10:00',
        score: 85,
        level: 'VERY_BUSY',
        availableTickets: 10,
      },
      {
        timeSlotId: 'slot-safe',
        startTime: '15:00',
        endTime: '16:00',
        score: 30,
        level: 'QUIET',
        availableTickets: 20,
      },
    ],
  };
}

function pressureDbMocks() {
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
    bookedQty: 90,
    heldQty: 0,
  });
  mockPrisma.specialDate.findUnique.mockResolvedValue(null);
  mockPrisma.timeSlot.findMany.mockResolvedValue([
    {
      id: 'slot-current',
      startTime: '09:00',
      endTime: '10:00',
      maxCapacity: 100,
      timeSlotStocks: [{ bookedQty: 90, heldQty: 0 }],
    },
    {
      id: 'slot-safe',
      startTime: '15:00',
      endTime: '16:00',
      maxCapacity: 100,
      timeSlotStocks: [{ bookedQty: 10, heldQty: 0 }],
    },
  ]);
  mockPrisma.booking.count.mockResolvedValueOnce(20).mockResolvedValueOnce(0);
  mockPrisma.ticketInstance.count.mockResolvedValue(20);
  mockPrisma.smartQueueEntry.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  mockPrisma.liveTripEvent.create.mockResolvedValue({ id: 'event-1' });
  mockPrisma.liveTripItem.updateMany.mockResolvedValue({ count: 1 });
});

test('chooses only a lower-pressure slot with capacity and travel buffer', () => {
  const item = tripItem();
  const candidate = chooseSaferSlot({
    item,
    tripItems: [
      item,
      tripItem({
        id: 'item-2',
        scheduledStart: new Date('2099-03-10T04:00:00.000Z'),
        scheduledEnd: new Date('2099-03-10T05:00:00.000Z'),
      }),
    ],
    pressure: pressureResponse(),
    now: NOW,
  });

  expect(candidate).toMatchObject({
    currentScore: 85,
    partySize: 2,
    slot: { timeSlotId: 'slot-safe', score: 30 },
  });
  expect(candidate.startsAt).toEqual(new Date('2099-03-10T08:00:00.000Z'));
});

test('creates a customer-confirmed proposal but never changes the item automatically', async () => {
  const item = tripItem();
  mockPrisma.liveTripItem.findUnique.mockResolvedValue(item);
  mockPrisma.liveTrip.findFirst.mockResolvedValue({
    id: 'trip-1',
    userId: 'user-1',
    status: 'ACTIVE',
    items: [item],
    proposals: [],
  });
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  pressureDbMocks();
  mockPrisma.liveTripProposal.upsert.mockImplementation(({ create }) => ({
    id: 'proposal-1',
    status: 'PENDING',
    createdAt: NOW,
    updatedAt: NOW,
    ...create,
  }));

  const result = await refreshTripAutopilot('trip-1', 'user-1', {
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result.stats.proposalsCreated).toBe(1);
  expect(result.policy.mutatesPaidBookings).toBe(false);
  expect(mockPrisma.liveTripProposal.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({
      liveTripItemId: 'item-1',
      type: 'TIME_SHIFT',
      activeKey: 'item-1',
    }),
  }));
  expect(mockPrisma.liveTripItem.update).not.toHaveBeenCalled();
  expect(mockPrisma.liveTripItem.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'item-1',
      liveTripId: 'trip-1',
      bookingId: null,
      scheduledStart: item.scheduledStart,
      scheduledEnd: item.scheduledEnd,
      status: { notIn: ['COMPLETED', 'SKIPPED'] },
    },
    data: { status: 'REVISION_PROPOSED' },
  });
});

test('does not publish a proposal when a booking is linked after the optimizer read', async () => {
  const item = tripItem();
  mockPrisma.liveTrip.findFirst.mockResolvedValue({
    id: 'trip-1',
    userId: 'user-1',
    status: 'ACTIVE',
    items: [item],
    proposals: [],
  });
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  pressureDbMocks();
  mockPrisma.liveTripItem.findUnique.mockResolvedValue({
    ...item,
    bookingId: 'booking-linked-concurrently',
  });

  const result = await refreshTripAutopilot('trip-1', 'user-1', {
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result.stats.proposalsCreated).toBe(0);
  expect(result.stats.proposalsReused).toBe(0);
  expect(mockPrisma.liveTripProposal.upsert).not.toHaveBeenCalled();
});

test('Autopilot rejects a stored HIGH prediction when runtime drift degrades it', async () => {
  const item = tripItem();
  mockPrisma.liveTrip.findFirst.mockResolvedValue({
    id: 'trip-1',
    userId: 'user-1',
    status: 'ACTIVE',
    items: [item],
    proposals: [],
  });
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  pressureDbMocks();
  mockPrisma.liveTripItem.findUnique.mockResolvedValue(item);
  mockPrisma.livePrediction.findFirst.mockResolvedValue({
    predictedP50: 10,
    predictedP90: 12,
    confidence: 'HIGH',
    modelVersion: 'arrival_gbr_conformal_v3',
    trainingSource: 'live_operational_history',
    usedFallback: false,
    horizonMinutes: 15,
    predictedAt: NOW,
    featureContributions: {},
    qualityMetrics: {},
  });
  mockPrisma.livePrediction.findMany.mockResolvedValue(
    Array.from({ length: 12 }, () => ({
      predictedP50: 10,
      predictedP90: 12,
      actualValue: 100,
    })),
  );
  mockPrisma.liveTripProposal.upsert.mockImplementation(({ create }) => ({
    id: 'proposal-1',
    status: 'PENDING',
    ...create,
  }));

  const result = await refreshTripAutopilot('trip-1', 'user-1', {
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result.stats.proposalsCreated).toBe(1);
  expect(result.stats.aiPredictionsUsed).toBe(0);
});

test('accepting a fresh proposal updates only the live item in one transaction', async () => {
  const item = tripItem({ status: 'REVISION_PROPOSED' });
  const proposal = {
    id: 'proposal-1',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    activeKey: 'item-1',
    type: 'TIME_SHIFT',
    status: 'PENDING',
    reasonCode: 'HIGH_ARRIVAL_PRESSURE',
    rationale: 'Khung mới ít đông hơn.',
    originalStart: item.scheduledStart,
    originalEnd: item.scheduledEnd,
    proposedStart: new Date('2099-03-10T08:00:00.000Z'),
    proposedEnd: new Date('2099-03-10T09:00:00.000Z'),
    snapshot: {
      bookingChanged: false,
      partySize: 2,
      proposedSlot: { timeSlotId: 'slot-safe', startTime: '15:00', endTime: '16:00' },
    },
    expiresAt: new Date('2099-03-10T07:30:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
    liveTripItem: item,
  };
  mockPrisma.liveTripProposal.findFirst.mockResolvedValue(proposal);
  mockPrisma.liveTripProposal.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.liveTripItem.findMany.mockResolvedValue([]);
  pressureDbMocks();
  mockPrisma.liveTripItem.update.mockResolvedValue({
    ...item,
    scheduledStart: proposal.proposedStart,
    scheduledEnd: proposal.proposedEnd,
    status: 'UPDATED',
  });

  const result = await decideProposal({
    tripId: 'trip-1',
    proposalId: 'proposal-1',
    userId: 'user-1',
    decision: 'ACCEPT',
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result).toMatchObject({ decision: 'ACCEPTED', bookingChanged: false });
  expect(mockPrisma.liveTripItem.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'item-1' },
    data: expect.objectContaining({
      scheduledStart: proposal.proposedStart,
      scheduledEnd: proposal.proposedEnd,
      status: 'UPDATED',
      snapshot: expect.objectContaining({ timeSlotId: 'slot-safe' }),
    }),
  }));
  expect(mockPrisma.booking.update).not.toHaveBeenCalled();
});

test('a stale proposal can never change an item that now has a paid booking', async () => {
  const item = tripItem({
    status: 'REVISION_PROPOSED',
    bookingId: 'booking-1',
  });
  mockPrisma.liveTripProposal.findFirst.mockResolvedValue({
    id: 'proposal-1',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    activeKey: 'item-1',
    status: 'PENDING',
    originalStart: item.scheduledStart,
    originalEnd: item.scheduledEnd,
    proposedStart: new Date('2099-03-10T08:00:00.000Z'),
    proposedEnd: new Date('2099-03-10T09:00:00.000Z'),
    expiresAt: new Date('2099-03-10T07:30:00.000Z'),
    liveTripItem: item,
  });
  mockPrisma.liveTripProposal.update.mockResolvedValue({});

  await expect(decideProposal({
    tripId: 'trip-1',
    proposalId: 'proposal-1',
    userId: 'user-1',
    decision: 'ACCEPT',
    prismaClient: mockPrisma,
    now: NOW,
  })).rejects.toMatchObject({ code: 'PROPOSAL_BOOKING_PROTECTED', statusCode: 409 });

  expect(mockPrisma.liveTripItem.update).not.toHaveBeenCalled();
  expect(mockPrisma.liveTripProposal.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'SUPERSEDED', activeKey: null }),
  }));
});

test('rechecks capacity at acceptance time and safely supersedes a stale proposal', async () => {
  const item = tripItem({ status: 'REVISION_PROPOSED' });
  mockPrisma.liveTripProposal.findFirst.mockResolvedValue({
    id: 'proposal-1',
    liveTripId: 'trip-1',
    liveTripItemId: item.id,
    activeKey: item.id,
    status: 'PENDING',
    originalStart: item.scheduledStart,
    originalEnd: item.scheduledEnd,
    proposedStart: new Date('2099-03-10T08:00:00.000Z'),
    proposedEnd: new Date('2099-03-10T09:00:00.000Z'),
    snapshot: {
      partySize: 2,
      proposedSlot: { timeSlotId: 'slot-safe', startTime: '15:00', endTime: '16:00' },
    },
    expiresAt: new Date('2099-03-10T07:30:00.000Z'),
    liveTripItem: item,
  });
  mockPrisma.liveTripItem.findMany.mockResolvedValue([]);
  mockPrisma.liveTripProposal.update.mockResolvedValue({});
  pressureDbMocks();
  mockPrisma.timeSlot.findMany.mockResolvedValue([
    {
      id: 'slot-current',
      startTime: '09:00',
      endTime: '10:00',
      maxCapacity: 100,
      timeSlotStocks: [{ bookedQty: 90, heldQty: 0 }],
    },
    {
      id: 'slot-safe',
      startTime: '15:00',
      endTime: '16:00',
      maxCapacity: 100,
      timeSlotStocks: [{ bookedQty: 99, heldQty: 0 }],
    },
  ]);

  await expect(decideProposal({
    tripId: 'trip-1',
    proposalId: 'proposal-1',
    userId: 'user-1',
    decision: 'ACCEPT',
    prismaClient: mockPrisma,
    now: NOW,
  })).rejects.toMatchObject({ code: 'PROPOSAL_CAPACITY_CHANGED', statusCode: 409 });

  expect(mockPrisma.liveTripItem.update).not.toHaveBeenCalled();
  expect(mockPrisma.liveTripProposal.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'SUPERSEDED', activeKey: null }),
  }));
});

test('completes a checked-in item even when the worker runs after its scheduled end', async () => {
  const completedBookingItem = tripItem({
    scheduledStart: new Date('2099-03-09T23:00:00.000Z'),
    scheduledEnd: new Date('2099-03-10T00:00:00.000Z'),
    bookingId: 'booking-1',
    booking: { id: 'booking-1', status: 'COMPLETED' },
  });
  mockPrisma.liveTrip.findFirst.mockResolvedValue({
    id: 'trip-1',
    userId: 'user-1',
    status: 'ACTIVE',
    items: [completedBookingItem],
    proposals: [],
  });
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  mockPrisma.liveTripItem.count.mockResolvedValue(0);
  mockPrisma.liveTrip.updateMany.mockResolvedValue({ count: 1 });

  const result = await refreshTripAutopilot('trip-1', 'user-1', {
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result).toMatchObject({
    tripCompleted: true,
    stats: { evaluated: 1 },
  });
  expect(mockPrisma.liveTripItem.updateMany).toHaveBeenCalledWith({
    where: { id: completedBookingItem.id, status: { notIn: ['COMPLETED', 'SKIPPED'] } },
    data: { status: 'COMPLETED' },
  });
  expect(mockPrisma.liveTripEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ type: 'ITEM_COMPLETED' }),
  });
  expect(mockPrisma.attraction.findUnique).not.toHaveBeenCalled();
});

test('skips an unbooked item after its activity window and completes the trip', async () => {
  const expiredUnbookedItem = tripItem({
    scheduledStart: new Date('2099-03-09T23:00:00.000Z'),
    scheduledEnd: new Date('2099-03-10T00:00:00.000Z'),
  });
  mockPrisma.liveTrip.findFirst.mockResolvedValue({
    id: 'trip-1',
    userId: 'user-1',
    status: 'ACTIVE',
    items: [expiredUnbookedItem],
    proposals: [],
  });
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  mockPrisma.liveTripItem.count.mockResolvedValue(0);
  mockPrisma.liveTrip.updateMany.mockResolvedValue({ count: 1 });

  const result = await refreshTripAutopilot('trip-1', 'user-1', {
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result).toMatchObject({
    tripCompleted: true,
    stats: { evaluated: 1, skipped: 1 },
  });
  expect(mockPrisma.liveTripItem.updateMany).toHaveBeenCalledWith({
    where: { id: expiredUnbookedItem.id, status: { notIn: ['COMPLETED', 'SKIPPED'] } },
    data: { status: 'SKIPPED' },
  });
  expect(mockPrisma.liveTripEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ type: 'ITEM_SKIPPED' }),
  });
  expect(mockPrisma.attraction.findUnique).not.toHaveBeenCalled();
});

test('archives an ended trip after flagging an unresolved paid booking for review', async () => {
  const unresolvedBookingItem = tripItem({
    scheduledStart: new Date('2099-03-09T23:00:00.000Z'),
    scheduledEnd: new Date('2099-03-10T00:00:00.000Z'),
    bookingId: 'booking-unresolved',
    booking: { id: 'booking-unresolved', status: 'CONFIRMED' },
  });
  mockPrisma.liveTrip.findFirst.mockResolvedValue({
    id: 'trip-ended',
    userId: 'user-1',
    status: 'ACTIVE',
    items: [unresolvedBookingItem],
    proposals: [],
  });
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  mockPrisma.liveTripItem.count.mockResolvedValue(1);
  mockPrisma.liveTrip.updateMany.mockResolvedValue({ count: 1 });

  const result = await refreshTripAutopilot('trip-ended', 'user-1', {
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result).toMatchObject({
    tripCompleted: true,
    stats: { atRisk: 1 },
  });
  expect(mockPrisma.liveTripItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'AT_RISK' },
  }));
  expect(mockPrisma.liveTrip.updateMany).toHaveBeenCalledWith({
    where: { id: 'trip-ended', userId: 'user-1', status: 'ACTIVE' },
    data: { status: 'COMPLETED' },
  });
});

test('sweep closes ACTIVE trips whose items are already terminal', async () => {
  mockPrisma.liveTrip.updateMany.mockResolvedValue({ count: 2 });
  mockPrisma.liveTrip.findMany.mockResolvedValue([]);

  const result = await sweepAutopilotTrips({
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(mockPrisma.liveTrip.updateMany).toHaveBeenCalledWith({
    where: {
      status: 'ACTIVE',
      items: {
        none: {
          status: { notIn: ['COMPLETED', 'SKIPPED'] },
        },
      },
    },
    data: { status: 'COMPLETED' },
  });
  expect(result).toEqual({ scanned: 0, refreshed: 0, completed: 2 });
});

test('sweep cursor-pages every active trip instead of starving trips after the first 25', async () => {
  const pageOne = Array.from({ length: 25 }, (_, index) => ({
    id: `trip-${String(index + 1).padStart(2, '0')}`,
    userId: `user-${index + 1}`,
  }));
  const pageTwo = [{ id: 'trip-26', userId: 'user-26' }];
  mockPrisma.liveTrip.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.liveTrip.findMany
    .mockResolvedValueOnce(pageOne)
    .mockResolvedValueOnce(pageTwo);
  mockPrisma.liveTrip.findFirst.mockImplementation(({ where }) => Promise.resolve({
    id: where.id,
    userId: where.userId,
    status: 'ACTIVE',
    items: [],
    proposals: [],
  }));
  mockPrisma.liveTripProposal.findMany.mockResolvedValue([]);
  mockPrisma.liveTripItem.count.mockResolvedValue(1);

  const result = await sweepAutopilotTrips({
    prismaClient: mockPrisma,
    now: NOW,
  });

  expect(result).toEqual({ scanned: 26, refreshed: 26, completed: 0 });
  expect(mockPrisma.liveTrip.findMany).toHaveBeenCalledTimes(2);
  expect(mockPrisma.liveTrip.findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
    where: expect.objectContaining({ id: { gt: 'trip-25' } }),
    orderBy: { id: 'asc' },
    take: 25,
  }));
});
