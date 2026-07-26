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
const LOCK_TTL_MS = DEFAULT_INTERVAL_MS * 2;

async function sweepLiveTripOperations({ now = new Date(), prismaClient = prisma } = {}) {
  const queue = await sweepSmartQueues({ prismaClient, now });
  const autopilot = await sweepAutopilotTrips({ prismaClient, now });
  // Observation writes are idempotent and run only at 15-minute boundaries;
  // the worker result remains backwards compatible with Sprint 1–2 callers.
  if (now instanceof Date && now.getUTCMinutes() % 15 === 0 && prismaClient?.attraction?.findMany) {
    const attractions = await prismaClient.attraction.findMany({
      where: { status: 'APPROVED', publicationStatus: 'ACTIVE', archivedAt: null },
      select: { id: true },
      take: 100,
    });
    for (const attraction of attractions || []) {
      await recordArrivalObservation(attraction.id, { now, prismaClient }).catch((error) => {
        console.error(`[live-prediction] Không ghi được snapshot ${attraction.id}:`, error.message);
      });
      await predictLiveArrivals({
        attractionId: attraction.id,
        date: getVietnamDateKey(now),
        now,
        force: true,
        prismaClient,
      }).catch((error) => {
        console.error(`[live-prediction] Không tạo được prediction ${attraction.id}:`, error.message);
      });
    }
    await evaluateArrivalObservations({ now, prismaClient }).catch((error) => {
      console.error('[live-prediction] Không đánh giá được observation:', error.message);
    });
    await evaluateLivePredictions({ now, prismaClient }).catch((error) => {
      console.error('[live-prediction] Không đánh giá được prediction:', error.message);
    });
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
    try {
      await sweepLiveTripOperations();
    } catch (error) {
      console.error('[live-trip] Lỗi vòng quét vận hành:', error.message);
    } finally {
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
  startLiveTripWorker,
  sweepLiveTripOperations,
};
