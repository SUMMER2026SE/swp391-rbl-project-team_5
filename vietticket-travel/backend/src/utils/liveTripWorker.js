'use strict';

const prisma = require('../config/prisma');
const { sweepAutopilotTrips } = require('../services/liveTripAutopilotService');
const { sweepSmartQueues } = require('../services/smartQueueService');
const {
  evaluateArrivalObservations,
  evaluateLivePredictions,
  predictLiveArrivals,
  recordArrivalObservation,
} = require('../services/livePredictionService');
const { acquireJobLock, releaseJobLock, INSTANCE_ID } = require('./cleanupWorker');
const { getVietnamDateKey } = require('../services/arrivalPressureService');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const JOB_NAME = 'live_trip_operations';
const LOCK_TTL_MS = 15 * 60 * 1000;
const LOCK_HEARTBEAT_MS = Math.max(30 * 1000, Math.floor(LOCK_TTL_MS / 3));
const PREDICTION_CONCURRENCY = 4;
const PREDICTION_BUCKET_MINUTES = 15;

// Keep the last processed bucket in-process so a 60-second interval cannot
// re-run the entire catalogue 15 times. The observation upsert and prediction
// cache remain the durable safeguards across restarts and multiple instances.
let lastPredictionBucketKey = null;

function predictionBucketStart(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(
    Math.floor(date.getUTCMinutes() / PREDICTION_BUCKET_MINUTES) * PREDICTION_BUCKET_MINUTES,
  );
  return date;
}

function predictionBucketKey(value) {
  return predictionBucketStart(value)?.toISOString() || null;
}

async function predictionAlreadyRecorded(attractionId, now, prismaClient) {
  if (!prismaClient?.livePrediction?.findFirst) return false;
  const upperBound = now instanceof Date ? now : new Date(now);
  const bucketStart = predictionBucketStart(upperBound);
  if (!bucketStart) return false;
  try {
    const existing = await prismaClient.livePrediction.findFirst({
      where: {
        attractionId,
        predictionType: 'ARRIVALS',
        predictedAt: {
          gte: bucketStart,
          lte: upperBound,
        },
      },
      select: { id: true },
    });
    return Boolean(existing);
  } catch (error) {
    // A read failure must not prevent a fresh operational prediction. The
    // prediction write itself is already best-effort and auditable.
    console.error(`[live-prediction] Không kiểm tra được prediction bucket ${attractionId}:`, error.message);
    return false;
  }
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), values.length);
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function sweepLiveTripOperations({ now = new Date(), prismaClient = prisma } = {}) {
  const queue = await sweepSmartQueues({ prismaClient, now });
  const autopilot = await sweepAutopilotTrips({ prismaClient, now });
  // Observation writes are idempotent per 15-minute bucket. Do not rely on
  // seconds being exactly zero: setInterval commonly starts at an arbitrary
  // millisecond and would otherwise silently skip every collection window.
  const currentBucketKey = predictionBucketKey(now);
  const shouldCollectPredictions = Boolean(
    currentBucketKey
    && currentBucketKey !== lastPredictionBucketKey
    && prismaClient?.attraction?.findMany,
  );
  if (shouldCollectPredictions) {
    const attractions = await prismaClient.attraction.findMany({
      where: { status: 'APPROVED', publicationStatus: 'ACTIVE', archivedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    // Process the complete active catalogue. A hard `take` would permanently
    // starve attractions after the first page; bounded concurrency keeps the
    // ML service and database load predictable.
    const attractionResults = await mapWithConcurrency(
      attractions || [],
      PREDICTION_CONCURRENCY,
      async (attraction) => {
        let completed = true;
        try {
          await recordArrivalObservation(attraction.id, { now, prismaClient });
        } catch (error) {
          completed = false;
          console.error(`[live-prediction] Không ghi được snapshot ${attraction.id}:`, error.message);
        }
        try {
          if (!await predictionAlreadyRecorded(attraction.id, now, prismaClient)) {
            await predictLiveArrivals({
              attractionId: attraction.id,
              date: getVietnamDateKey(now),
              now,
              force: true,
              prismaClient,
            });
          }
        } catch (error) {
          completed = false;
          console.error(`[live-prediction] Không tạo được prediction ${attraction.id}:`, error.message);
        }
        return completed;
      },
    );
    let evaluationsCompleted = true;
    try {
      const result = await evaluateArrivalObservations({ now, prismaClient });
      if (Number(result?.failed || 0) > 0) evaluationsCompleted = false;
    } catch (error) {
      evaluationsCompleted = false;
      console.error('[live-prediction] Không đánh giá được observation:', error.message);
    }
    try {
      const result = await evaluateLivePredictions({ now, prismaClient });
      if (Number(result?.failed || 0) > 0) evaluationsCompleted = false;
    } catch (error) {
      evaluationsCompleted = false;
      console.error('[live-prediction] Không đánh giá được prediction:', error.message);
    }
    // Successful writes are idempotent. Retry an incomplete bucket so one
    // temporary attraction/ML failure cannot create a permanent data hole.
    if (attractionResults.every(Boolean) && evaluationsCompleted) {
      lastPredictionBucketKey = currentBucketKey;
    } else {
      console.error(
        `[live-prediction] Bucket ${currentBucketKey} chưa hoàn tất; worker sẽ thử lại ở vòng kế tiếp.`,
      );
    }
  }
  return { queue, autopilot };
}

function startLiveTripWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    let lockAcquired;
    try {
      lockAcquired = await acquireJobLock(JOB_NAME, LOCK_TTL_MS);
    } catch (error) {
      console.error('[live-trip] Không thể kiểm tra lock:', error.message);
      return;
    }
    if (!lockAcquired) return;

    isRunning = true;
    const heartbeat = setInterval(async () => {
      try {
        const refreshed = await acquireJobLock(JOB_NAME, LOCK_TTL_MS);
        if (!refreshed) {
          console.error('[live-trip] Không gia hạn được lock vận hành; instance khác có thể tiếp quản sau TTL.');
        }
      } catch (error) {
        console.error('[live-trip] Không thể gia hạn lock vận hành:', error.message);
      }
    }, LOCK_HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    try {
      await sweepLiveTripOperations();
    } catch (error) {
      console.error('[live-trip] Lỗi vòng quét vận hành:', error.message);
    } finally {
      clearInterval(heartbeat);
      isRunning = false;
      await releaseJobLock(JOB_NAME);
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  console.log(`[live-trip] Worker đã khởi động (instance=${INSTANCE_ID}, mỗi ${intervalMs / 1000}s).`);
  return handle;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  predictionBucketKey,
  predictionBucketStart,
  startLiveTripWorker,
  sweepLiveTripOperations,
};
