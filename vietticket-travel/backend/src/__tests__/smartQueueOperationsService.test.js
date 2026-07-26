'use strict';

jest.mock('../config/prisma', () => ({}));
jest.mock('../services/arrivalPressureService', () => ({
  getAttractionPressure: jest.fn().mockResolvedValue({ summary: { score: 82, label: 'Đông', waitingGuests: 4 }, calculatedAt: new Date().toISOString() }),
  getDateKey: jest.fn((value) => new Date(value).toISOString().slice(0, 10)),
}));
jest.mock('../services/liveTripEventService', () => ({ recordLiveTripEvent: jest.fn().mockResolvedValue(undefined) }));

const {
  listQueueOperations,
  normalizePolicyInput,
  setQueuePause,
  transitionQueueEntry,
} = require('../services/smartQueueOperationsService');
const { recordLiveTripEvent } = require('../services/liveTripEventService');

test('normalizes policy and rejects unsafe values', () => {
  expect(normalizePolicyInput({ mode: 'staff_controlled', openBeforeMinutes: 90 })).toEqual({
    mode: 'STAFF_CONTROLLED',
    openBeforeMinutes: 90,
  });
  expect(() => normalizePolicyInput({ readyGraceMinutes: 0 })).toThrow(/readyGraceMinutes/);
});

test('CALL is conditional and writes READY grace window with actor', async () => {
  const entry = {
    id: 'entry-1', liveTripId: 'trip-1', liveTripItemId: 'item-1', userId: 'user-1', attractionId: 'a-1',
    status: 'WAITING', joinedAt: new Date('2026-07-23T01:00:00Z'), readyAt: null,
    liveTripItem: { scheduledStart: new Date('2026-07-23T01:15:00Z') },
  };
  const updated = { ...entry, status: 'READY' };
  const tx = {
    smartQueueEntry: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(updated),
    },
  };
  const client = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue(entry),
      count: jest.fn().mockResolvedValue(0),
    },
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue({ readyGraceMinutes: 10, enabled: true, mode: 'AUTO' }) },
    $transaction: jest.fn(async (callback) => callback(tx)),
  };

  const result = await transitionQueueEntry({ entryId: 'entry-1', action: 'CALL', actorId: 'staff-1', prismaClient: client, now: new Date('2026-07-23T01:05:00Z') });

  expect(result.status).toBe('READY');
  expect(tx.smartQueueEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'entry-1' }),
    data: expect.objectContaining({ status: 'READY', calledById: 'staff-1' }),
  }));
});

test('NO_SHOW never accepts a WAITING entry', async () => {
  const client = {
    smartQueueEntry: { findUnique: jest.fn().mockResolvedValue({ id: 'entry-1', status: 'WAITING', attractionId: 'a-1' }) },
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue({ readyGraceMinutes: 10, enabled: true, mode: 'AUTO' }) },
  };
  await expect(transitionQueueEntry({ entryId: 'entry-1', action: 'NO_SHOW', actorId: 'staff-1', prismaClient: client })).rejects.toMatchObject({ code: 'QUEUE_NOT_READY', statusCode: 409 });
});

test('CALL rejects jumping over an earlier waiting party', async () => {
  const entry = {
    id: 'entry-2',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-2',
    userId: 'user-2',
    attractionId: 'a-1',
    visitDate: new Date('2026-07-23T00:00:00Z'),
    status: 'WAITING',
    joinedAt: new Date('2026-07-23T01:05:00Z'),
    booking: { reservation: { timeSlotId: 'slot-1' } },
    liveTripItem: { scheduledStart: new Date('2026-07-23T01:15:00Z') },
  };
  const client = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue(entry),
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
    },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        readyGraceMinutes: 10,
        maxReadyParties: 3,
        enabled: true,
        mode: 'STAFF_CONTROLLED',
      }),
    },
  };

  await expect(transitionQueueEntry({
    entryId: entry.id,
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:06:00Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_FIFO_VIOLATION', statusCode: 409 });
});

test('CALL rejects calling a party before the 15-minute gate window', async () => {
  const entry = {
    id: 'entry-early',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-early',
    userId: 'user-1',
    attractionId: 'a-1',
    visitDate: new Date('2026-07-23T00:00:00Z'),
    status: 'WAITING',
    joinedAt: new Date('2026-07-23T01:00:00Z'),
    liveTripItem: {
      scheduledStart: new Date('2026-07-23T03:00:00Z'),
    },
  };
  const client = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue(entry),
    },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        readyGraceMinutes: 10,
        maxReadyParties: 3,
        enabled: true,
        mode: 'STAFF_CONTROLLED',
      }),
    },
  };

  await expect(transitionQueueEntry({
    entryId: entry.id,
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T02:00:00Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_CALL_TOO_EARLY', statusCode: 409 });
});

test('CALL never extends the grace window of a party that was already called', async () => {
  const client = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'entry-ready',
        attractionId: 'a-1',
        status: 'READY',
        liveTripItem: { scheduledStart: new Date('2026-07-23T01:15:00Z') },
      }),
    },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({ readyGraceMinutes: 10, enabled: true }),
    },
  };

  await expect(transitionQueueEntry({
    entryId: 'entry-ready',
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:05:00Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_ALREADY_CALLED', statusCode: 409 });
});

test('NO_SHOW is rejected until the return window expires', async () => {
  const entry = {
    id: 'entry-1',
    attractionId: 'a-1',
    status: 'READY',
    readyExpiresAt: new Date('2026-07-23T01:15:00Z'),
  };
  const client = {
    smartQueueEntry: { findUnique: jest.fn().mockResolvedValue(entry) },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({ readyGraceMinutes: 10, enabled: true, mode: 'AUTO' }),
    },
  };

  await expect(transitionQueueEntry({
    entryId: entry.id,
    action: 'NO_SHOW',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:14:59Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_RETURN_WINDOW_ACTIVE', statusCode: 409 });
});

test('operations overview numbers waiting and ready parties independently', async () => {
  const visitDate = new Date('2026-07-23T00:00:00Z');
  const client = {
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    smartQueueEntry: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'ready-1', status: 'READY', partySize: 4, visitDate },
        { id: 'waiting-1', status: 'WAITING', partySize: 2, visitDate },
        { id: 'waiting-2', status: 'WAITING', partySize: 3, visitDate },
      ]),
    },
  };

  const overview = await listQueueOperations({
    attractionId: 'a-1',
    date: '2026-07-23',
    prismaClient: client,
    now: new Date('2026-07-23T01:00:00Z'),
  });

  expect(overview.summary).toMatchObject({
    waitingParties: 2,
    readyParties: 1,
    waitingGuests: 5,
    readyGuests: 4,
    activeGuests: 9,
  });
  expect(overview.entries.map((entry) => entry.position)).toEqual([null, 1, 2]);
});

test('operations overview calculates FIFO independently for each booked time slot', async () => {
  const visitDate = new Date('2026-07-23T00:00:00Z');
  const client = {
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    smartQueueEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'slot-1-party',
          status: 'WAITING',
          partySize: 2,
          visitDate,
          booking: { reservation: { timeSlotId: 'slot-1' } },
          liveTripItem: { scheduledStart: new Date('2026-07-23T01:15:00Z') },
        },
        {
          id: 'slot-2-party',
          status: 'WAITING',
          partySize: 3,
          visitDate,
          booking: { reservation: { timeSlotId: 'slot-2' } },
          liveTripItem: { scheduledStart: new Date('2026-07-23T03:00:00Z') },
        },
      ]),
    },
  };

  const overview = await listQueueOperations({
    attractionId: 'a-1',
    date: '2026-07-23',
    prismaClient: client,
    now: new Date('2026-07-23T01:00:00Z'),
  });

  expect(overview.entries.map((entry) => entry.position)).toEqual([1, 1]);
  expect(overview.entries[0]).toMatchObject({ queueScope: 'TIME_SLOT', callWindowOpen: true });
  expect(overview.entries[1]).toMatchObject({ queueScope: 'TIME_SLOT', callWindowOpen: false });
});

test('pausing preserves active entries and records a customer-visible event', async () => {
  const policy = { id: 'policy-1', attractionId: 'a-1', pausedAt: new Date() };
  const tx = {
    smartQueuePolicy: { upsert: jest.fn().mockResolvedValue(policy) },
    smartQueueEntry: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'entry-1',
        liveTripId: 'trip-1',
        liveTripItemId: 'item-1',
        userId: 'user-1',
      }]),
    },
  };
  const client = {
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (callback) => callback(tx)),
  };

  const result = await setQueuePause({
    attractionId: 'a-1',
    paused: true,
    reason: 'Sự cố kỹ thuật tại cổng',
    actorId: 'staff-1',
    prismaClient: client,
  });

  expect(result.affectedEntries).toBe(1);
  expect(recordLiveTripEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'QUEUE_PAUSED',
    userId: 'user-1',
  }));
});
