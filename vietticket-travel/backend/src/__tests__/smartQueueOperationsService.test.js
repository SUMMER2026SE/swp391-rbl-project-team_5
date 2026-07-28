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
  saveQueuePolicy,
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
    expiresAt: new Date('2026-07-23T02:00:00Z'),
    liveTripItem: { scheduledStart: new Date('2026-07-23T01:15:00Z') },
  };
  const updated = { ...entry, status: 'READY' };
  const tx = {
    smartQueueEntry: {
      count: jest.fn().mockResolvedValue(0),
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

test('staff actions fail closed when the attraction is suspended or booking was cancelled', async () => {
  const baseEntry = {
    id: 'entry-safety',
    attractionId: 'a-1',
    status: 'WAITING',
    attraction: { operationalStatus: 'SUSPENDED' },
    booking: { status: 'CONFIRMED', ticketInstances: [] },
  };
  const suspendedClient = {
    smartQueueEntry: { findUnique: jest.fn().mockResolvedValue(baseEntry) },
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
  };
  await expect(transitionQueueEntry({
    entryId: baseEntry.id,
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: suspendedClient,
  })).rejects.toMatchObject({ code: 'QUEUE_ATTRACTION_SUSPENDED', statusCode: 409 });

  const cancelledClient = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue({
        ...baseEntry,
        attraction: { operationalStatus: 'ACTIVE' },
        booking: { status: 'CANCELLED', ticketInstances: [] },
      }),
    },
    smartQueuePolicy: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
  };
  await expect(transitionQueueEntry({
    entryId: baseEntry.id,
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: cancelledClient,
  })).rejects.toMatchObject({ code: 'QUEUE_BOOKING_NOT_CONFIRMED', statusCode: 409 });
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
    expiresAt: new Date('2026-07-23T02:00:00Z'),
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
    $transaction: jest.fn(async (callback) => callback({
      smartQueueEntry: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      },
    })),
  };

  await expect(transitionQueueEntry({
    entryId: entry.id,
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:06:00Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_FIFO_VIOLATION', statusCode: 409 });
});

test('CALL rejects a group that would exceed the guest capacity at the gate', async () => {
  const entry = {
    id: 'entry-large',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-large',
    userId: 'user-large',
    attractionId: 'a-1',
    visitDate: new Date('2026-07-23T00:00:00Z'),
    partySize: 4,
    status: 'WAITING',
    joinedAt: new Date('2026-07-23T01:00:00Z'),
    expiresAt: new Date('2026-07-23T02:00:00Z'),
    booking: { status: 'CONFIRMED', ticketInstances: [], reservation: { timeSlotId: 'slot-1' } },
    attraction: { operationalStatus: 'ACTIVE' },
    liveTripItem: { scheduledStart: new Date('2026-07-23T01:15:00Z') },
  };
  const tx = {
    smartQueueEntry: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { partySize: 18 } }),
      updateMany: jest.fn(),
    },
  };
  const client = {
    smartQueueEntry: { findUnique: jest.fn().mockResolvedValue(entry) },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: true,
        maxReadyParties: 3,
        maxReadyGuests: 20,
        readyGraceMinutes: 10,
      }),
    },
    $transaction: jest.fn(async (callback) => callback(tx)),
  };

  await expect(transitionQueueEntry({
    entryId: entry.id,
    action: 'CALL',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:05:00Z'),
  })).rejects.toMatchObject({
    code: 'QUEUE_READY_GUEST_CAPACITY_REACHED',
    statusCode: 409,
  });
  expect(tx.smartQueueEntry.updateMany).not.toHaveBeenCalled();
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

test('NO_SHOW is fail-closed when partner operational readiness is missing', async () => {
  const client = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'entry-ready',
        attractionId: 'a-1',
        status: 'READY',
        readyExpiresAt: new Date('2026-07-23T01:00:00Z'),
        attraction: { operationalStatus: 'ACTIVE' },
        booking: { status: 'CONFIRMED', ticketInstances: [] },
      }),
    },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: true,
        operationalReadinessConfirmedAt: null,
      }),
    },
  };

  await expect(transitionQueueEntry({
    entryId: 'entry-ready',
    action: 'NO_SHOW',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:05:00Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_DISABLED', statusCode: 409 });
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

test('operations overview keeps an expired READY window reserved while the queue is paused', async () => {
  const visitDate = new Date('2026-07-23T00:00:00Z');
  const client = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: true,
        pausedAt: new Date('2026-07-23T00:55:00Z'),
      }),
    },
    smartQueueEntry: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'ready-paused',
        status: 'READY',
        partySize: 4,
        visitDate,
        readyExpiresAt: new Date('2026-07-23T00:58:00Z'),
        expiresAt: new Date('2026-07-23T02:00:00Z'),
      }]),
    },
  };

  const overview = await listQueueOperations({
    attractionId: 'a-1',
    date: '2026-07-23',
    prismaClient: client,
    now: new Date('2026-07-23T01:00:00Z'),
  });

  expect(overview.summary).toMatchObject({ readyParties: 1, readyGuests: 4 });
  expect(overview.entries[0]).toMatchObject({
    readyPartiesInScope: 1,
    readyGuestsInScope: 4,
  });
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
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        attractionId: 'a-1',
        enabled: true,
        pausedAt: null,
      }),
    },
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

test('repeating PAUSE is idempotent and preserves the original pause timestamp', async () => {
  const pausedAt = new Date('2026-07-23T01:00:00Z');
  const previous = {
    id: 'policy-1',
    attractionId: 'a-1',
    enabled: true,
    pausedAt,
    pauseReason: 'Sự cố kỹ thuật tại cổng',
  };
  const tx = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue(previous),
      upsert: jest.fn(),
    },
    smartQueueEntry: { findMany: jest.fn() },
  };
  const client = {
    $transaction: jest.fn(async (callback) => callback(tx)),
  };

  const result = await setQueuePause({
    attractionId: 'a-1',
    paused: true,
    reason: 'Sự cố kỹ thuật tại cổng',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:05:00Z'),
  });

  expect(result.pausedAt).toEqual(pausedAt);
  expect(result.affectedEntries).toBe(0);
  expect(tx.smartQueuePolicy.upsert).not.toHaveBeenCalled();
  expect(tx.smartQueueEntry.findMany).not.toHaveBeenCalled();
});

test('pause and resume fail closed when no operational queue policy exists', async () => {
  const client = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    smartQueueEntry: { findMany: jest.fn() },
  };

  await expect(setQueuePause({
    attractionId: 'a-1',
    paused: true,
    reason: 'Sự cố kỹ thuật tại cổng',
    actorId: 'staff-1',
    prismaClient: client,
  })).rejects.toMatchObject({
    code: 'QUEUE_DISABLED',
    statusCode: 409,
  });
  expect(client.smartQueuePolicy.upsert).not.toHaveBeenCalled();
});

test('enabling SmartQueue requires an explicit partner operational-readiness confirmation', async () => {
  const client = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    smartQueueEntry: { count: jest.fn() },
  };

  await expect(saveQueuePolicy({
    attractionId: 'a-1',
    payload: { enabled: true },
    actorId: 'partner-1',
    prismaClient: client,
  })).rejects.toMatchObject({
    code: 'QUEUE_OPERATIONAL_READINESS_REQUIRED',
    statusCode: 409,
  });
  expect(client.smartQueuePolicy.upsert).not.toHaveBeenCalled();
});

test('re-enabling a legacy enabled row requires readiness confirmation and stores the acknowledgement', async () => {
  const upsert = jest.fn().mockResolvedValue({ attractionId: 'a-1', enabled: true });
  const client = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        attractionId: 'a-1',
        enabled: true,
        operationalReadinessConfirmedAt: null,
      }),
      upsert,
    },
    smartQueueEntry: { count: jest.fn() },
  };

  await expect(saveQueuePolicy({
    attractionId: 'a-1',
    payload: { enabled: true },
    actorId: 'partner-1',
    prismaClient: client,
  })).rejects.toMatchObject({ code: 'QUEUE_OPERATIONAL_READINESS_REQUIRED' });

  await saveQueuePolicy({
    attractionId: 'a-1',
    payload: { enabled: true, operationalReadinessConfirmed: true },
    actorId: 'partner-1',
    prismaClient: client,
  });
  expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({
    create: expect.objectContaining({ operationalReadinessConfirmedAt: expect.any(Date) }),
    update: expect.objectContaining({ operationalReadinessConfirmedAt: expect.any(Date) }),
  }));
});

test('disabling SmartQueue is blocked while active customer entries still exist', async () => {
  const client = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({ attractionId: 'a-1', enabled: true }),
      upsert: jest.fn(),
    },
    smartQueueEntry: { count: jest.fn().mockResolvedValue(2) },
  };

  await expect(saveQueuePolicy({
    attractionId: 'a-1',
    payload: { enabled: false },
    actorId: 'partner-1',
    prismaClient: client,
  })).rejects.toMatchObject({
    code: 'QUEUE_ACTIVE_ENTRIES_EXIST',
    statusCode: 409,
  });
  expect(client.smartQueuePolicy.upsert).not.toHaveBeenCalled();
});

test('resume restores a READY deadline by the paused duration without exceeding visit close', async () => {
  const pausedAt = new Date('2026-07-23T01:00:00Z');
  const now = new Date('2026-07-23T01:05:00Z');
  const entry = {
    id: 'entry-ready',
    liveTripId: 'trip-1',
    liveTripItemId: 'item-1',
    userId: 'user-1',
    status: 'READY',
    readyExpiresAt: new Date('2026-07-23T01:03:00Z'),
    expiresAt: new Date('2026-07-23T02:00:00Z'),
  };
  const tx = {
    smartQueuePolicy: {
      upsert: jest.fn().mockResolvedValue({ id: 'policy-1', attractionId: 'a-1', pausedAt: null }),
    },
    smartQueueEntry: {
      findMany: jest.fn().mockResolvedValue([entry]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const client = {
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({ attractionId: 'a-1', enabled: true, pausedAt }),
    },
    $transaction: jest.fn(async (callback) => callback(tx)),
  };

  await setQueuePause({
    attractionId: 'a-1',
    paused: false,
    actorId: 'staff-1',
    prismaClient: client,
    now,
  });

  expect(tx.smartQueueEntry.updateMany).toHaveBeenCalledWith({
    where: { id: entry.id, status: 'READY' },
    data: { readyExpiresAt: new Date('2026-07-23T01:08:00Z') },
  });
});

test('staff cannot mark a READY party no-show while the queue is paused', async () => {
  const client = {
    smartQueueEntry: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'entry-ready',
        attractionId: 'a-1',
        status: 'READY',
        readyExpiresAt: new Date('2026-07-23T01:01:00Z'),
      }),
    },
    smartQueuePolicy: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: true,
        pausedAt: new Date('2026-07-23T00:59:00Z'),
      }),
    },
  };

  await expect(transitionQueueEntry({
    entryId: 'entry-ready',
    action: 'NO_SHOW',
    actorId: 'staff-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:05:00Z'),
  })).rejects.toMatchObject({ code: 'QUEUE_PAUSED', statusCode: 409 });
});
