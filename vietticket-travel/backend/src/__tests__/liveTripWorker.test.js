'use strict';

jest.mock('../config/prisma', () => ({ marker: 'prisma-client' }));
jest.mock('../services/liveTripAutopilotService', () => ({
  sweepAutopilotTrips: jest.fn(),
}));
jest.mock('../services/smartQueueService', () => ({
  sweepSmartQueues: jest.fn(),
}));
jest.mock('../services/livePredictionService', () => ({
  evaluateArrivalObservations: jest.fn(),
  evaluateLivePredictions: jest.fn(),
  predictLiveArrivals: jest.fn(),
  recordArrivalObservation: jest.fn(),
}));
jest.mock('../utils/cleanupWorker', () => ({
  acquireJobLock: jest.fn(),
  releaseJobLock: jest.fn(),
  INSTANCE_ID: 'test-instance',
}));

const prisma = require('../config/prisma');
const { sweepAutopilotTrips } = require('../services/liveTripAutopilotService');
const { sweepSmartQueues } = require('../services/smartQueueService');
const {
  evaluateArrivalObservations,
  evaluateLivePredictions,
  predictLiveArrivals,
  recordArrivalObservation,
} = require('../services/livePredictionService');
const { acquireJobLock, releaseJobLock } = require('../utils/cleanupWorker');
const {
  startLiveTripWorker,
  sweepLiveTripOperations,
} = require('../utils/liveTripWorker');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  sweepSmartQueues.mockResolvedValue({ scanned: 2, ready: 1, admitted: 0, expired: 0 });
  sweepAutopilotTrips.mockResolvedValue({ scanned: 1, refreshed: 1 });
  evaluateArrivalObservations.mockResolvedValue({ evaluated: 0 });
  evaluateLivePredictions.mockResolvedValue({ evaluated: 0 });
  predictLiveArrivals.mockResolvedValue({});
  recordArrivalObservation.mockResolvedValue({});
  releaseJobLock.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('runs SmartQueue before Autopilot with one shared time and Prisma client', async () => {
  const now = new Date('2099-03-10T01:00:00.000Z');

  const result = await sweepLiveTripOperations({ now, prismaClient: prisma });

  expect(result).toEqual({
    queue: { scanned: 2, ready: 1, admitted: 0, expired: 0 },
    autopilot: { scanned: 1, refreshed: 1 },
  });
  expect(sweepSmartQueues).toHaveBeenCalledWith({ prismaClient: prisma, now });
  expect(sweepAutopilotTrips).toHaveBeenCalledWith({ prismaClient: prisma, now });
  expect(sweepSmartQueues.mock.invocationCallOrder[0])
    .toBeLessThan(sweepAutopilotTrips.mock.invocationCallOrder[0]);
});

test('collects a new 15-minute bucket even when the worker tick is not on an exact boundary', async () => {
  const now = new Date('2099-03-10T02:01:37.456Z');
  const livePrisma = {
    attraction: {
      findMany: jest.fn().mockResolvedValue([{ id: 'attraction-1' }]),
    },
  };

  await sweepLiveTripOperations({ now, prismaClient: livePrisma });

  expect(recordArrivalObservation).toHaveBeenCalledWith(
    'attraction-1',
    expect.objectContaining({ now, prismaClient: livePrisma }),
  );
  expect(predictLiveArrivals).toHaveBeenCalledWith(
    expect.objectContaining({
      attractionId: 'attraction-1',
      date: '2099-03-10',
      now,
      force: true,
      prismaClient: livePrisma,
    }),
  );
  expect(evaluateArrivalObservations).toHaveBeenCalledWith({ now, prismaClient: livePrisma });
  expect(evaluateLivePredictions).toHaveBeenCalledWith({ now, prismaClient: livePrisma });
});

test('retries the same bucket when one attraction snapshot temporarily fails', async () => {
  const firstNow = new Date('2099-03-10T03:01:00.000Z');
  const retryNow = new Date('2099-03-10T03:02:00.000Z');
  const livePrisma = {
    attraction: {
      findMany: jest.fn().mockResolvedValue([{ id: 'attraction-retry' }]),
    },
  };
  recordArrivalObservation
    .mockRejectedValueOnce(new Error('temporary database outage'))
    .mockResolvedValue({});

  await sweepLiveTripOperations({ now: firstNow, prismaClient: livePrisma });
  await sweepLiveTripOperations({ now: retryNow, prismaClient: livePrisma });

  expect(livePrisma.attraction.findMany).toHaveBeenCalledTimes(2);
  expect(recordArrivalObservation).toHaveBeenCalledTimes(2);
});

test('skips safely when another instance owns the distributed lock', async () => {
  acquireJobLock.mockResolvedValue(false);
  const handle = startLiveTripWorker({ intervalMs: 1000 });

  await jest.advanceTimersByTimeAsync(1000);

  expect(acquireJobLock).toHaveBeenCalledTimes(1);
  expect(sweepSmartQueues).not.toHaveBeenCalled();
  expect(sweepAutopilotTrips).not.toHaveBeenCalled();
  expect(releaseJobLock).not.toHaveBeenCalled();
  clearInterval(handle);
});

test('releases the distributed lock after a successful sweep', async () => {
  acquireJobLock.mockResolvedValue(true);
  const handle = startLiveTripWorker({ intervalMs: 1000 });

  await jest.advanceTimersByTimeAsync(1000);

  expect(sweepSmartQueues).toHaveBeenCalledTimes(1);
  expect(sweepAutopilotTrips).toHaveBeenCalledTimes(1);
  expect(releaseJobLock).toHaveBeenCalledWith('live_trip_operations');
  clearInterval(handle);
});
