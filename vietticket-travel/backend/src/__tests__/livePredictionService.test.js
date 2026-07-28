'use strict';

jest.mock('../config/prisma', () => ({}));
jest.mock('../services/arrivalPressureService', () => ({
  getAttractionPressure: jest.fn().mockResolvedValue({
    summary: { capacity: 100, bookedQty: 40, heldQty: 2, waitingGuests: 8, checkinsLast15Minutes: 4, score: 76 },
    showRate: 0.9,
  }),
  getDateKey: jest.fn((value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }),
  getVietnamDateKey: jest.fn((value = new Date()) => new Date(
    new Date(value).getTime() + 7 * 60 * 60 * 1000,
  ).toISOString().slice(0, 10)),
}));

const {
  evaluateArrivalObservations,
  evaluateLivePredictions,
  floorBucket,
  optimizeLiveTrip,
  predictLiveArrivals,
  predictLiveWait,
  recordArrivalObservation,
} = require('../services/livePredictionService');

afterEach(() => jest.restoreAllMocks());

test('records observation targets from capture time without leaking the current bucket', async () => {
  const observedAt = new Date('2026-07-23T01:04:37.456Z');
  const client = {
    arrivalObservation: {
      upsert: jest.fn().mockResolvedValue({ id: 'observation-1' }),
    },
  };

  await recordArrivalObservation('a-1', { now: observedAt, prismaClient: client });

  expect(client.arrivalObservation.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { observationKey: 'a-1:2026-07-23T01:00:00.000Z' },
    create: expect.objectContaining({
      observationKey: 'a-1:2026-07-23T01:00:00.000Z',
      bucketStart: observedAt,
    }),
  }));
});

test('arrival prediction falls back conservatively and labels provenance when ML is unavailable', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  const result = await predictLiveArrivals({ attractionId: 'a-1', date: '2026-07-23', now: new Date('2026-07-23T01:04:00Z'), prismaClient: {} });
  expect(result.used_fallback).toBe(true);
  expect(result.training_source).toBe('operational_heuristic');
  expect(result.predicted_p90).toBeGreaterThanOrEqual(result.predicted_p50);
});

test('arrival prediction rejects an invalid ML contract and fails closed to fallback', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      predicted_p50: 25,
      predicted_p90: 10,
      confidence: 'CERTAIN',
      model_version: '',
      training_source: '',
      used_fallback: false,
    }),
  });

  const result = await predictLiveArrivals({
    attractionId: 'a-1',
    date: '2026-07-23',
    now: new Date('2026-07-23T01:04:00Z'),
    prismaClient: {},
  });

  expect(result.used_fallback).toBe(true);
  expect(result.confidence).toBe('LOW');
  expect(result.metrics.error).toMatch(/quantile|confidence|provenance/i);
});

test('arrival prediction never serves a cache row outside the current capacity contract', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  const client = {
    livePrediction: {
      findFirst: jest.fn().mockResolvedValue({
        predictedP50: 180,
        predictedP90: 220,
        confidence: 'HIGH',
        modelVersion: 'arrival_gbr_conformal_v3',
        trainingSource: 'live_operational_history',
        usedFallback: false,
        featureContributions: {},
        qualityMetrics: {},
        predictedAt: new Date('2026-07-23T01:00:00Z'),
      }),
    },
  };

  const result = await predictLiveArrivals({
    attractionId: 'a-1',
    date: '2026-07-23',
    now: new Date('2026-07-23T01:04:00Z'),
    prismaClient: client,
  });

  expect(result.used_fallback).toBe(true);
  expect(result.cached).not.toBe(true);
  expect(global.fetch).toHaveBeenCalled();
});

test('arrival cache can never bleed across a Vietnam midnight boundary', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  const client = {
    livePrediction: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const now = new Date('2026-07-23T17:05:00.000Z'); // 00:05 ngày 24/07 tại Việt Nam

  await predictLiveArrivals({
    attractionId: 'a-1',
    date: '2026-07-24',
    now,
    prismaClient: client,
  });

  expect(client.livePrediction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      predictedAt: {
        gte: new Date('2026-07-23T17:00:00.000Z'),
        lt: new Date('2026-07-24T17:00:00.000Z'),
        lte: now,
      },
    }),
  }));
});

test('runtime drift gate downgrades a model that is wrong in production', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      predicted_p50: 10,
      predicted_p90: 12,
      confidence: 'HIGH',
      model_version: 'arrival_gbr_conformal_v3',
      training_source: 'live_operational_history',
      used_fallback: false,
      feature_contributions: {},
      metrics: {},
    }),
  });
  const client = {
    livePrediction: {
      findMany: jest.fn().mockResolvedValue(
        Array.from({ length: 12 }, () => ({
          predictedP50: 10,
          predictedP90: 12,
          actualValue: 100,
        })),
      ),
      create: jest.fn().mockResolvedValue({ id: 'prediction-1' }),
    },
  };

  const result = await predictLiveArrivals({
    attractionId: 'a-1',
    date: '2026-07-23',
    now: new Date('2026-07-23T01:04:00Z'),
    prismaClient: client,
  });

  expect(result.confidence).toBe('LOW');
  expect(result.metrics.runtime_quality_status).toBe('DEGRADED');
  expect(result.metrics.confidence_reasons).toContain('RUNTIME_DRIFT_DETECTED');
});

test('wait fallback is bounded and only counts guests ahead of the party', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  const common = {
    attractionId: 'a-1',
    date: '2026-07-23',
    guestsAhead: 20,
    now: new Date('2026-07-23T01:04:00Z'),
    prismaClient: {},
  };
  const solo = await predictLiveWait({ ...common, partySize: 1 });
  const largeParty = await predictLiveWait({ ...common, partySize: 20 });
  const readyNow = await predictLiveWait({ ...common, guestsAhead: 0, partySize: 20 });

  expect(solo.used_fallback).toBe(true);
  expect(solo.predicted_p50).toBeLessThanOrEqual(240);
  expect(solo.predicted_p90).toBeGreaterThanOrEqual(solo.predicted_p50);
  expect(largeParty.predicted_p50).toBe(solo.predicted_p50);
  expect(readyNow.predicted_p50).toBe(0);
  expect(solo.metrics.party_size_excluded_from_own_eta).toBe(true);
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

test('live prediction refuses dates other than today in Vietnam', async () => {
  await expect(predictLiveArrivals({
    attractionId: 'a-1',
    date: '2026-07-24',
    now: new Date('2026-07-23T01:00:00Z'),
    prismaClient: {},
  })).rejects.toMatchObject({
    code: 'LIVE_PREDICTION_DATE_NOT_TODAY',
    statusCode: 400,
  });
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

  expect(result).toEqual({ evaluated: 1, failed: 0 });
  expect(client.ticketInstance.count).toHaveBeenCalledWith({
    where: expect.objectContaining({
      checkedInAt: {
        gte: predictedAt,
        lt: new Date('2026-07-23T01:15:00Z'),
      },
      booking: expect.objectContaining({
        isForecastTrainingSample: false,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        OR: expect.arrayContaining([
          { snapshotAttractionId: 'a-1' },
          expect.objectContaining({
            snapshotAttractionId: null,
            reservation: {
              ticketProduct: { attractionId: 'a-1' },
            },
          }),
        ]),
      }),
    }),
  });
  expect(client.livePrediction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ actualValue: 7 }),
  }));
});

test('evaluates observation backlog in bounded pages without starving later rows', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `observation-${String(index).padStart(3, '0')}`,
    attractionId: 'a-1',
    bucketStart: new Date('2026-07-23T01:00:00Z'),
  }));
  const finalRow = {
    id: 'observation-100',
    attractionId: 'a-1',
    bucketStart: new Date('2026-07-23T01:00:00Z'),
  };
  const client = {
    arrivalObservation: {
      findMany: jest.fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce([finalRow]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ticketInstance: { count: jest.fn().mockResolvedValue(3) },
  };

  const result = await evaluateArrivalObservations({
    now: new Date('2026-07-23T02:00:00Z'),
    prismaClient: client,
  });

  expect(result).toEqual({ evaluated: 101, failed: 0 });
  expect(client.arrivalObservation.findMany).toHaveBeenCalledTimes(2);
  expect(client.arrivalObservation.findMany.mock.calls[1][0].where.id)
    .toEqual({ gt: 'observation-099' });
  expect(client.ticketInstance.count).toHaveBeenCalledWith({
    where: expect.objectContaining({
      booking: expect.objectContaining({
        isForecastTrainingSample: false,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        OR: expect.arrayContaining([
          { snapshotAttractionId: 'a-1' },
          expect.objectContaining({
            snapshotAttractionId: null,
            reservation: {
              ticketProduct: { attractionId: 'a-1' },
            },
          }),
        ]),
      }),
    }),
  });
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
        baseline_score: 54,
        optimized_score: 54,
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

test('optimizer rejects fabricated evidence metrics even when proposals are empty', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const client = {
    liveTrip: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'trip-metrics',
        items: [{
          id: 'future',
          status: 'PLANNED',
          dayIndex: 0,
          bookingId: null,
          scheduledStart: new Date('2026-07-24T03:00:00Z'),
          scheduledEnd: new Date('2026-07-24T04:00:00Z'),
        }],
      }),
    },
  };
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      live_trip_id: 'trip-metrics',
      algorithm_version: 'fabricated-metrics-v1',
      baseline_score: 10,
      optimized_score: 100,
      predicted_minutes_saved: 0,
      total_shift_minutes: 0,
      protected_booking_count: 0,
      proposals: [],
      constraints: {},
    }),
  });

  const result = await optimizeLiveTrip({
    liveTripId: 'trip-metrics',
    userId: 'user-1',
    prismaClient: client,
    now: new Date('2026-07-24T01:00:00Z'),
  });

  expect(result.proposals).toEqual([]);
  expect(result.constraints.reason).toBe('ML_RESPONSE_REJECTED');
});

test('optimizer rejects a proposal that mutates a paid activity', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const now = new Date('2026-07-24T01:00:00Z');
  const client = {
    liveTrip: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'trip-paid',
        items: [{
          id: 'paid',
          status: 'PLANNED',
          dayIndex: 0,
          bookingId: 'booking-1',
          scheduledStart: new Date('2026-07-24T03:00:00Z'),
          scheduledEnd: new Date('2026-07-24T04:00:00Z'),
        }],
      }),
    },
  };
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      live_trip_id: 'trip-paid',
      algorithm_version: 'malicious-v1',
      baseline_score: 10,
      optimized_score: 100,
      predicted_minutes_saved: 0,
      total_shift_minutes: 30,
      protected_booking_count: 0,
      proposals: [{
        item_id: 'paid',
        proposed_start_minute: 630,
        proposed_end_minute: 690,
      }],
      constraints: {},
    }),
  });

  const result = await optimizeLiveTrip({
    liveTripId: 'trip-paid',
    userId: 'user-1',
    prismaClient: client,
    now,
  });

  expect(result.proposals).toEqual([]);
  expect(result.constraints.reason).toBe('ML_RESPONSE_REJECTED');
});

test('optimizer rejects a new simulation after the trip calendar has ended', async () => {
  const client = {
    liveTrip: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'trip-ended',
        endDate: new Date('2026-07-22T00:00:00Z'),
        items: [],
      }),
    },
  };

  await expect(optimizeLiveTrip({
    liveTripId: 'trip-ended',
    userId: 'user-1',
    prismaClient: client,
    now: new Date('2026-07-23T01:00:00Z'),
  })).rejects.toMatchObject({ code: 'LIVE_TRIP_ENDED', statusCode: 409 });
});
