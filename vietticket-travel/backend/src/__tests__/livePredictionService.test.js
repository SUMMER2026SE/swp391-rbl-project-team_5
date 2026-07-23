'use strict';

jest.mock('../config/prisma', () => ({}));
jest.mock('../services/arrivalPressureService', () => ({
  getAttractionPressure: jest.fn().mockResolvedValue({
    summary: { capacity: 100, bookedQty: 40, heldQty: 2, waitingGuests: 8, checkinsLast15Minutes: 4, score: 76 },
    showRate: 0.9,
  }),
  getDateKey: jest.fn(() => '2026-07-23'),
  getVietnamDateKey: jest.fn(() => '2026-07-23'),
}));

const {
  evaluateLivePredictions,
  floorBucket,
  optimizeLiveTrip,
  predictLiveArrivals,
  predictLiveWait,
} = require('../services/livePredictionService');

afterEach(() => jest.restoreAllMocks());

test('arrival prediction falls back conservatively and labels provenance when ML is unavailable', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  const result = await predictLiveArrivals({ attractionId: 'a-1', date: '2026-07-23', now: new Date('2026-07-23T01:04:00Z'), prismaClient: {} });
  expect(result.used_fallback).toBe(true);
  expect(result.training_source).toBe('operational_heuristic');
  expect(result.predicted_p90).toBeGreaterThanOrEqual(result.predicted_p50);
});

test('wait fallback is bounded and accounts for party ahead', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  const result = await predictLiveWait({ attractionId: 'a-1', date: '2026-07-23', guestsAhead: 20, partySize: 4, prismaClient: {} });
  expect(result.used_fallback).toBe(true);
  expect(result.predicted_p50).toBeLessThanOrEqual(240);
  expect(result.predicted_p90).toBeGreaterThanOrEqual(result.predicted_p50);
});

test('observation buckets are UTC 15-minute boundaries', () => {
  expect(floorBucket(new Date('2026-07-23T01:14:59Z')).toISOString()).toBe('2026-07-23T01:00:00.000Z');
  expect(floorBucket(new Date('2026-07-23T01:30:00Z')).toISOString()).toBe('2026-07-23T01:30:00.000Z');
});

test('rejects unbounded public prediction inputs before calling ML', async () => {
  await expect(predictLiveArrivals({
    attractionId: 'a-1',
    horizonMinutes: '999',
    prismaClient: {},
  })).rejects.toMatchObject({ code: 'INVALID_LIVE_PREDICTION_INPUT', statusCode: 400 });

  await expect(predictLiveWait({
    attractionId: 'a-1',
    guestsAhead: '-1',
    partySize: '1',
    prismaClient: {},
  })).rejects.toMatchObject({ code: 'INVALID_LIVE_PREDICTION_INPUT', statusCode: 400 });
});

test('evaluates stored arrival predictions against later QR check-ins', async () => {
  const predictedAt = new Date('2026-07-23T01:00:00Z');
  const client = {
    livePrediction: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'prediction-1',
        attractionId: 'a-1',
        predictedAt,
        horizonMinutes: 15,
      }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ticketInstance: { count: jest.fn().mockResolvedValue(7) },
  };

  const result = await evaluateLivePredictions({
    now: new Date('2026-07-23T01:20:00Z'),
    prismaClient: client,
  });

  expect(result).toEqual({ evaluated: 1 });
  expect(client.ticketInstance.count).toHaveBeenCalledWith({
    where: expect.objectContaining({
      checkedInAt: {
        gte: predictedAt,
        lt: new Date('2026-07-23T01:15:00Z'),
      },
    }),
  });
  expect(client.livePrediction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ actualValue: 7 }),
  }));
});

test('optimizer excludes completed, skipped and expired activities', async () => {
  const now = new Date('2026-07-24T01:00:00Z');
  const client = {
    liveTrip: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'trip-1',
        items: [
          {
            id: 'skipped',
            status: 'SKIPPED',
            scheduledStart: new Date('2026-07-23T01:00:00Z'),
            scheduledEnd: new Date('2026-07-23T02:00:00Z'),
          },
          {
            id: 'expired',
            status: 'PLANNED',
            scheduledStart: new Date('2026-07-23T03:00:00Z'),
            scheduledEnd: new Date('2026-07-23T04:00:00Z'),
          },
          {
            id: 'future',
            status: 'PLANNED',
            dayIndex: 1,
            bookingId: null,
            scheduledStart: new Date('2026-07-24T03:00:00Z'),
            scheduledEnd: new Date('2026-07-24T04:00:00Z'),
          },
        ],
      }),
    },
  };
  let requestBody;
  jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        live_trip_id: 'trip-1',
        algorithm_version: 'constrained_local_search_v2',
        baseline_score: 60,
        optimized_score: 60,
        predicted_minutes_saved: 0,
        total_shift_minutes: 0,
        protected_booking_count: 0,
        proposals: [],
        constraints: {},
      }),
    };
  });

  await optimizeLiveTrip({
    liveTripId: 'trip-1',
    userId: 'user-1',
    prismaClient: client,
    now,
  });

  expect(requestBody.items).toHaveLength(1);
  expect(requestBody.items[0]).toMatchObject({ id: 'future', day_index: 1 });
});
