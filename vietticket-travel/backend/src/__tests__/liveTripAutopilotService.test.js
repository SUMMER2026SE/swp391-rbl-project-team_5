'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  chooseSaferSlot,
  decideProposal,
  refreshTripAutopilot,
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
    where: { id: 'item-1', bookingId: null },
    data: { status: 'REVISION_PROPOSED' },
  });
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
