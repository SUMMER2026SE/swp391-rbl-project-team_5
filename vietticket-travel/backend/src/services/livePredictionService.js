'use strict';

const prisma = require('../config/prisma');
const {
  getAttractionPressure,
  getDateKey,
  getVietnamDateKey,
} = require('./arrivalPressureService');
const { getSnapshotAdmissionCount } = require('../utils/ticketCapacity');

const ML_SERVICE_URL = String(process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const ML_SERVICE_API_KEY = String(process.env.ML_SERVICE_API_KEY || '').trim();
const REQUEST_TIMEOUT_MS = Math.min(15000, Math.max(1000, Number(process.env.ML_SERVICE_TIMEOUT_MS || 8000)));
const OBSERVATION_WINDOW = 14 * 24 * 4;
const EVALUATION_BATCH_SIZE = 100;
const EVALUATION_CONCURRENCY = 6;
const RUNTIME_QUALITY_WINDOW = 48;
const MIN_RUNTIME_QUALITY_ROWS = 12;
const PREDICTION_CACHE_MS = 15 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

async function countAdmittedGuests(prismaClient, where) {
  if (prismaClient?.ticketInstance?.findMany) {
    const rows = await prismaClient.ticketInstance.findMany({
      where,
      select: {
        booking: {
          select: {
            snapshotAdmissionCount: true,
            reservation: { select: { snapshotAdmissionCount: true } },
          },
        },
      },
    });
    if (Array.isArray(rows)) {
      return rows.reduce(
        (sum, row) => (
          sum + getSnapshotAdmissionCount({
            snapshotAdmissionCount:
              row.booking?.snapshotAdmissionCount
              || row.booking?.reservation?.snapshotAdmissionCount,
          })
        ),
        0,
      );
    }
  }
  return prismaClient.ticketInstance.count({ where });
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function floorBucket(date, minutes = 15) {
  const value = new Date(date);
  value.setUTCSeconds(0, 0);
  value.setUTCMinutes(Math.floor(value.getUTCMinutes() / minutes) * minutes);
  return value;
}

function vietnamDateBounds(dateKey) {
  const start = new Date(`${dateKey}T00:00:00.000+07:00`);
  if (Number.isNaN(start.getTime())) {
    throw httpError(400, 'INVALID_DATE', 'Không thể xác định ranh giới ngày Việt Nam.');
  }
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

function boundedInteger(value, { field, min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw httpError(400, 'INVALID_LIVE_PREDICTION_INPUT', `${field} phải là số nguyên trong khoảng ${min}-${max}.`);
  }
  return normalized;
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

function vietnamMinuteOfDay(value) {
  const shifted = new Date(new Date(value).getTime() + VIETNAM_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function assertLivePredictionDate(date, now) {
  const today = getVietnamDateKey(now);
  const requested = String(date || today).trim();
  if (requested !== today) {
    throw httpError(
      400,
      'LIVE_PREDICTION_DATE_NOT_TODAY',
      'Dự báo live chỉ áp dụng cho ngày hiện tại theo giờ Việt Nam. Hãy dùng chỉ số áp lực lịch trước cho ngày khác.',
    );
  }
  return today;
}

function currentObservation(pressure, now) {
  return {
    timestamp: new Date(now).toISOString(),
    capacity: Number(pressure.summary?.capacity || 0),
    booked_guests: Number(pressure.summary?.bookedQty || 0),
    held_guests: Number(pressure.summary?.heldQty || 0),
    queue_guests: Number(pressure.summary?.waitingGuests || 0),
    checkins_last_15m: Number(pressure.summary?.checkinsLast15Minutes || 0),
    pressure_score: Number(pressure.summary?.score || 0),
    show_rate: Number(pressure.showRate || 0.9),
    actual_arrivals_next_15m: null,
    data_source: 'LIVE_OPERATIONAL',
  };
}

async function callMl(path, body) {
  if (typeof fetch !== 'function') throw new Error('fetch không khả dụng trong runtime Node.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${ML_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ML_SERVICE_API_KEY ? { 'x-ml-api-key': ML_SERVICE_API_KEY } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.message || `ML service ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackPrediction(current, horizonMinutes = 15) {
  const capacity = Math.max(1, Number(current.capacity || 0));
  const recent = Math.max(0, Number(current.checkins_last_15m || 0));
  const scheduled = Math.max(0, Number(current.booked_guests || 0)) * Number(current.show_rate || 0.9);
  const queue = Math.max(0, Number(current.queue_guests || 0));
  const horizonScale = horizonMinutes / 15;
  const p50 = Math.min(
    capacity,
    (Math.max(1, recent || capacity * 0.08) * 0.65 + scheduled * 0.025 + queue * 0.05)
      * horizonScale,
  );
  return {
    attraction_id: null,
    prediction_type: 'ARRIVALS',
    horizon_minutes: horizonMinutes,
    predicted_p50: Math.round(p50 * 100) / 100,
    predicted_p90: Math.round(Math.min(capacity, p50 * 1.6 + 2) * 100) / 100,
    confidence: 'LOW',
    model_version: 'arrival_fallback_node_v3',
    training_source: 'operational_heuristic',
    used_fallback: true,
    feature_contributions: {
      checkins_last_15m: recent * 0.65 * horizonScale,
      booked_guests: scheduled * 0.025 * horizonScale,
      queue_guests: queue * 0.05 * horizonScale,
    },
    metrics: {
      reason: 'ML_SERVICE_UNAVAILABLE',
      predicted_p10: Math.max(0, p50 - (Math.min(capacity, p50 * 1.6 + 2) - p50)),
    },
  };
}

function validateMlPrediction(result, {
  predictionType = 'ARRIVALS',
  maximum = Number.POSITIVE_INFINITY,
} = {}) {
  if (!result || typeof result !== 'object') {
    throw new Error('ML service trả response không hợp lệ.');
  }
  const p50 = Number(result.predicted_p50);
  const p90 = Number(result.predicted_p90);
  if (
    !Number.isFinite(p50)
    || !Number.isFinite(p90)
    || p50 < 0
    || p90 < p50
    || p50 > maximum
    || p90 > maximum
  ) {
    throw new Error(`ML service trả quantile ${predictionType} ngoài miền nghiệp vụ.`);
  }
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(result.confidence)) {
    throw new Error('ML service trả confidence không hợp lệ.');
  }
  if (
    typeof result.used_fallback !== 'boolean'
    || !String(result.model_version || '').trim()
    || !String(result.training_source || '').trim()
  ) {
    throw new Error('ML service thiếu provenance bắt buộc.');
  }
  return {
    ...result,
    predicted_p50: p50,
    predicted_p90: p90,
  };
}

async function applyRuntimeQualityGate(attractionId, result, {
  prismaClient = prisma,
} = {}) {
  if (
    result.used_fallback
    || result.confidence === 'LOW'
    || !prismaClient?.livePrediction?.findMany
  ) return result;

  let rows;
  try {
    rows = await prismaClient.livePrediction.findMany({
      where: {
        attractionId,
        predictionType: 'ARRIVALS',
        modelVersion: result.model_version,
        trainingSource: 'live_operational_history',
        usedFallback: false,
        actualValue: { not: null },
      },
      orderBy: { evaluatedAt: 'desc' },
      take: RUNTIME_QUALITY_WINDOW,
      select: {
        predictedP50: true,
        predictedP90: true,
        actualValue: true,
      },
    });
  } catch (error) {
    console.error('[live-prediction] Không đọc được runtime quality window:', error.message);
    return {
      ...result,
      confidence: 'LOW',
      metrics: {
        ...(result.metrics || {}),
        runtime_quality_status: 'UNAVAILABLE',
        confidence_reasons: [
          ...new Set([
            ...(Array.isArray(result.metrics?.confidence_reasons)
              ? result.metrics.confidence_reasons
              : []),
            'RUNTIME_QUALITY_UNAVAILABLE',
          ]),
        ],
      },
    };
  }
  const evaluated = (rows || []).filter((row) => (
    Number.isFinite(Number(row.predictedP50))
    && Number.isFinite(Number(row.predictedP90))
    && Number.isFinite(Number(row.actualValue))
  ));
  const metrics = {
    ...(result.metrics || {}),
    runtime_evaluation_count: evaluated.length,
    runtime_evaluation_window: RUNTIME_QUALITY_WINDOW,
  };
  if (evaluated.length < MIN_RUNTIME_QUALITY_ROWS) {
    return {
      ...result,
      confidence: result.confidence === 'HIGH' ? 'MEDIUM' : result.confidence,
      metrics: {
        ...metrics,
        runtime_quality_status: 'WARMING_UP',
      },
    };
  }

  const absoluteError = evaluated.reduce(
    (sum, row) => sum + Math.abs(Number(row.actualValue) - Number(row.predictedP50)),
    0,
  );
  const actualTotal = evaluated.reduce(
    (sum, row) => sum + Math.abs(Number(row.actualValue)),
    0,
  );
  const actualMean = actualTotal / evaluated.length;
  const normalizedMae = absoluteError / evaluated.length / Math.max(1, actualMean);
  const p90Coverage = evaluated.filter(
    (row) => Number(row.actualValue) <= Number(row.predictedP90),
  ).length / evaluated.length;
  const degraded = normalizedMae > 0.75 || p90Coverage < 0.65;

  return {
    ...result,
    confidence: degraded ? 'LOW' : result.confidence,
    metrics: {
      ...metrics,
      runtime_normalized_mae_p50: Math.round(normalizedMae * 1000) / 1000,
      runtime_coverage_p90: Math.round(p90Coverage * 1000) / 1000,
      runtime_quality_status: degraded ? 'DEGRADED' : 'HEALTHY',
      ...(degraded
        ? {
            confidence_reasons: [
              ...new Set([
                ...(Array.isArray(result.metrics?.confidence_reasons)
                  ? result.metrics.confidence_reasons
                  : []),
                'RUNTIME_DRIFT_DETECTED',
              ]),
            ],
          }
        : {}),
    },
  };
}

function scoreOptimizerSchedule(items, travelBufferMinutes) {
  let score = 0;
  for (const item of items) {
    const duration = Math.max(1, item.end_minute - item.start_minute);
    score += Number(item.priority || 0) * duration / 60;
    score -= Number(item.risk_score || 0) * duration / 100;
  }
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      if (
        left.day_index === right.day_index
        && left.start_minute < right.end_minute + travelBufferMinutes
        && right.start_minute < left.end_minute + travelBufferMinutes
      ) score -= 1000;
    }
  }
  return Math.round(score * 100) / 100;
}

function validateOptimizerResult(result, items, {
  liveTripId,
  maxShiftMinutes,
  travelBufferMinutes,
} = {}) {
  if (
    !result
    || typeof result !== 'object'
    || result.live_trip_id !== liveTripId
    || !String(result.algorithm_version || '').trim()
    || !Array.isArray(result.proposals)
    || result.proposals.length > items.length
  ) {
    throw new Error('ML optimizer trả response không hợp lệ.');
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  const finalItems = items.map((item) => ({ ...item }));
  const finalById = new Map(finalItems.map((item) => [item.id, item]));

  for (const proposal of result.proposals) {
    const id = String(proposal?.item_id || '');
    const item = itemById.get(id);
    const originalStart = Number(proposal?.original_start_minute);
    const originalEnd = Number(proposal?.original_end_minute);
    const proposedStart = Number(proposal?.proposed_start_minute);
    const proposedEnd = Number(proposal?.proposed_end_minute);
    if (
      !item
      || item.locked
      || seen.has(id)
      || !Number.isInteger(originalStart)
      || !Number.isInteger(originalEnd)
      || originalStart !== item.start_minute
      || originalEnd !== item.end_minute
      || !Number.isInteger(proposedStart)
      || !Number.isInteger(proposedEnd)
      || proposedStart < 0
      || proposedEnd > 24 * 60
      || proposedEnd <= proposedStart
      || proposedEnd - proposedStart !== item.end_minute - item.start_minute
      || Math.abs(proposedStart - item.start_minute)
        > Math.min(maxShiftMinutes, item.flexibility_minutes)
    ) {
      throw new Error('ML optimizer vi phạm ràng buộc lịch trình.');
    }
    seen.add(id);
    Object.assign(finalById.get(id), {
      start_minute: proposedStart,
      end_minute: proposedEnd,
    });
  }

  for (let leftIndex = 0; leftIndex < finalItems.length; leftIndex += 1) {
    const left = finalItems[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < finalItems.length; rightIndex += 1) {
      const right = finalItems[rightIndex];
      if (
        left.day_index === right.day_index
        && left.start_minute < right.end_minute + travelBufferMinutes
        && right.start_minute < left.end_minute + travelBufferMinutes
      ) {
        throw new Error('ML optimizer trả lịch còn xung đột hoặc thiếu buffer di chuyển.');
      }
    }
  }

  const baselineScore = Number(result.baseline_score);
  const optimizedScore = Number(result.optimized_score);
  const totalShiftMinutes = Number(result.total_shift_minutes);
  const protectedBookingCount = Number(result.protected_booking_count);
  const expectedBaselineScore = scoreOptimizerSchedule(items, travelBufferMinutes);
  const expectedOptimizedScore = scoreOptimizerSchedule(finalItems, travelBufferMinutes);
  const expectedTotalShiftMinutes = result.proposals.reduce((total, proposal) => (
    total + Math.abs(
      Number(proposal.proposed_start_minute)
      - Number(proposal.original_start_minute)
    )
  ), 0);
  const expectedProtectedBookingCount = items.filter((item) => item.locked).length;
  if (
    !Number.isFinite(baselineScore)
    || !Number.isFinite(optimizedScore)
    || !Number.isInteger(totalShiftMinutes)
    || totalShiftMinutes < 0
    || !Number.isInteger(protectedBookingCount)
    || Math.abs(baselineScore - expectedBaselineScore) > 0.05
    || Math.abs(optimizedScore - expectedOptimizedScore) > 0.05
    || totalShiftMinutes !== expectedTotalShiftMinutes
    || protectedBookingCount !== expectedProtectedBookingCount
    || expectedOptimizedScore < expectedBaselineScore
    || Number(result.predicted_minutes_saved || 0) !== 0
  ) {
    throw new Error('ML optimizer trả metric không hợp lệ.');
  }
  return {
    ...result,
    baseline_score: expectedBaselineScore,
    optimized_score: expectedOptimizedScore,
    total_shift_minutes: expectedTotalShiftMinutes,
    protected_booking_count: expectedProtectedBookingCount,
    constraints: {
      ...(result.constraints && typeof result.constraints === 'object'
        ? result.constraints
        : {}),
      locked_items_immutable: true,
      max_shift_minutes: maxShiftMinutes,
      travel_buffer_minutes: travelBufferMinutes,
      timezone: 'Asia/Ho_Chi_Minh',
      no_overlapping_windows: true,
    },
  };
}

async function loadObservationHistory(attractionId, { prismaClient = prisma } = {}) {
  if (!prismaClient?.arrivalObservation?.findMany) return [];
  const rows = await prismaClient.arrivalObservation.findMany({
    where: { attractionId, actualArrivalsNext15m: { not: null } },
    orderBy: { bucketStart: 'desc' },
    take: OBSERVATION_WINDOW,
  });
  return rows.reverse().map((row) => ({
    timestamp: new Date(row.bucketStart).toISOString(),
    capacity: row.capacity,
    booked_guests: row.bookedGuests,
    held_guests: row.heldGuests,
    queue_guests: row.queueGuests,
    checkins_last_15m: row.checkinsLast15Minutes,
    pressure_score: row.pressureScore,
    show_rate: row.showRate,
    actual_arrivals_next_15m: row.actualArrivalsNext15m,
    data_source: row.dataSource || 'LIVE_OPERATIONAL',
  }));
}

async function recordArrivalObservation(attractionId, { now = new Date(), prismaClient = prisma } = {}) {
  if (!prismaClient?.arrivalObservation?.upsert) return null;
  const observedAt = new Date(now);
  if (Number.isNaN(observedAt.getTime())) {
    throw httpError(400, 'INVALID_NOW', 'now phải là thời điểm hợp lệ.');
  }
  const pressure = await getAttractionPressure(
    attractionId,
    getVietnamDateKey(observedAt),
    { prismaClient, now: observedAt },
  );
  // Keep the unique key bucket-aligned for durable idempotency, while the
  // target window starts exactly at feature-capture time. Using the floored
  // bucket as the target would leak already-observed check-ins into the label.
  const bucketKey = floorBucket(observedAt);
  const observationKey = `${attractionId}:${bucketKey.toISOString()}`;
  return prismaClient.arrivalObservation.upsert({
    where: { observationKey },
    create: {
      observationKey,
      attractionId,
      bucketStart: observedAt,
      capacity: Number(pressure.summary?.capacity || 0),
      bookedGuests: Number(pressure.summary?.bookedQty || 0),
      heldGuests: Number(pressure.summary?.heldQty || 0),
      queueGuests: Number(pressure.summary?.waitingGuests || 0),
      checkinsLast15Minutes: Number(pressure.summary?.checkinsLast15Minutes || 0),
      showRate: Number(pressure.showRate || 0.9),
      pressureScore: Number(pressure.summary?.score || 0),
      dataSource: 'LIVE_OPERATIONAL',
    },
    update: {},
  });
}

async function evaluateArrivalObservations({ now = new Date(), prismaClient = prisma } = {}) {
  if (!prismaClient?.arrivalObservation?.findMany) return { evaluated: 0, failed: 0 };
  const cutoff = new Date(new Date(now).getTime() - 15 * 60 * 1000);
  let evaluated = 0;
  let failed = 0;
  let lastId = null;
  while (true) {
    const rows = await prismaClient.arrivalObservation.findMany({
      where: {
        actualArrivalsNext15m: null,
        bucketStart: { lte: cutoff },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: EVALUATION_BATCH_SIZE,
      select: { id: true, attractionId: true, bucketStart: true },
    });
    if (!rows?.length) break;
    const counts = await mapWithConcurrency(
      rows,
      EVALUATION_CONCURRENCY,
      async (row) => {
        try {
          const end = new Date(new Date(row.bucketStart).getTime() + 15 * 60 * 1000);
          const actual = await countAdmittedGuests(prismaClient, {
              status: 'USED',
              checkedInAt: { gte: row.bucketStart, lt: end },
              booking: {
                isForecastTrainingSample: false,
                status: { in: ['CONFIRMED', 'COMPLETED'] },
                OR: [
                  { snapshotAttractionId: row.attractionId },
                  {
                    snapshotAttractionId: null,
                    reservation: {
                      ticketProduct: { attractionId: row.attractionId },
                    },
                  },
                ],
              },
          });
          const result = await prismaClient.arrivalObservation.updateMany({
            where: { id: row.id, actualArrivalsNext15m: null },
            data: { actualArrivalsNext15m: actual, evaluatedAt: new Date(now) },
          });
          return { evaluated: Number(result.count || 0), failed: 0 };
        } catch (error) {
          console.error(`[live-prediction] Không đánh giá được observation ${row.id}:`, error.message);
          return { evaluated: 0, failed: 1 };
        }
      },
    );
    evaluated += counts.reduce((sum, result) => sum + result.evaluated, 0);
    failed += counts.reduce((sum, result) => sum + result.failed, 0);
    lastId = rows[rows.length - 1].id;
    if (rows.length < EVALUATION_BATCH_SIZE) break;
  }
  return { evaluated, failed };
}

async function evaluateLivePredictions({ now = new Date(), prismaClient = prisma } = {}) {
  if (!prismaClient?.livePrediction?.findMany) return { evaluated: 0, failed: 0 };
  const referenceNow = new Date(now);
  let evaluated = 0;
  let failed = 0;
  let lastId = null;
  while (true) {
    const rows = await prismaClient.livePrediction.findMany({
      where: {
        predictionType: 'ARRIVALS',
        actualValue: null,
        predictedAt: { lte: new Date(referenceNow.getTime() - 5 * 60 * 1000) },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: EVALUATION_BATCH_SIZE,
      select: {
        id: true,
        attractionId: true,
        predictedAt: true,
        horizonMinutes: true,
      },
    });
    if (!rows?.length) break;
    const counts = await mapWithConcurrency(
      rows,
      EVALUATION_CONCURRENCY,
      async (row) => {
        const windowEnd = new Date(
          new Date(row.predictedAt).getTime() + Number(row.horizonMinutes || 15) * 60 * 1000,
        );
        if (windowEnd > referenceNow) return { evaluated: 0, failed: 0 };
        try {
          const actual = await countAdmittedGuests(prismaClient, {
              status: 'USED',
              checkedInAt: { gte: row.predictedAt, lt: windowEnd },
              booking: {
                isForecastTrainingSample: false,
                status: { in: ['CONFIRMED', 'COMPLETED'] },
                OR: [
                  { snapshotAttractionId: row.attractionId },
                  {
                    snapshotAttractionId: null,
                    reservation: {
                      ticketProduct: { attractionId: row.attractionId },
                    },
                  },
                ],
              },
          });
          const result = await prismaClient.livePrediction.updateMany({
            where: { id: row.id, actualValue: null },
            data: { actualValue: actual, evaluatedAt: referenceNow },
          });
          return { evaluated: Number(result.count || 0), failed: 0 };
        } catch (error) {
          console.error(`[live-prediction] Không đánh giá được prediction ${row.id}:`, error.message);
          return { evaluated: 0, failed: 1 };
        }
      },
    );
    evaluated += counts.reduce((sum, result) => sum + result.evaluated, 0);
    failed += counts.reduce((sum, result) => sum + result.failed, 0);
    lastId = rows[rows.length - 1].id;
    if (rows.length < EVALUATION_BATCH_SIZE) break;
  }
  return { evaluated, failed };
}

async function predictLiveArrivals({
  attractionId,
  date,
  now = new Date(),
  horizonMinutes = 15,
  publicOnly = false,
  force = false,
  prismaClient = prisma,
} = {}) {
  const normalizedHorizon = boundedInteger(horizonMinutes, {
    field: 'horizonMinutes',
    min: 5,
    max: 60,
    fallback: 15,
  });
  const referenceNow = new Date(now);
  if (Number.isNaN(referenceNow.getTime())) {
    throw httpError(400, 'INVALID_NOW', 'now phải là thời điểm hợp lệ.');
  }
  const liveDate = assertLivePredictionDate(date, referenceNow);
  const predictionDay = vietnamDateBounds(liveDate);
  const pressure = await getAttractionPressure(
    attractionId,
    liveDate,
    { prismaClient, now, publicOnly },
  );
  const current = currentObservation(pressure, now);
  if (!force && prismaClient?.livePrediction?.findFirst) {
    const cached = await prismaClient.livePrediction.findFirst({
      where: {
        attractionId,
        predictionType: 'ARRIVALS',
        horizonMinutes: normalizedHorizon,
        predictedAt: {
          gte: new Date(Math.max(
            predictionDay.start.getTime(),
            referenceNow.getTime() - PREDICTION_CACHE_MS,
          )),
          lt: predictionDay.end,
          lte: referenceNow,
        },
      },
      orderBy: { predictedAt: 'desc' },
    });
    if (cached) {
      try {
        const cachedResult = await applyRuntimeQualityGate(
          attractionId,
          validateMlPrediction({
            predicted_p50: cached.predictedP50,
            predicted_p90: cached.predictedP90,
            confidence: cached.confidence,
            model_version: cached.modelVersion,
            training_source: cached.trainingSource,
            used_fallback: cached.usedFallback,
            feature_contributions: cached.featureContributions || {},
            metrics: {
              ...(cached.qualityMetrics || {}),
              cache_hit: true,
              cache_ttl_seconds: PREDICTION_CACHE_MS / 1000,
            },
          }, {
            predictionType: 'ARRIVALS',
            maximum: Math.max(1, Number(current.capacity || 0)),
          }),
          { prismaClient },
        );
        return {
          ...cachedResult,
          attraction_id: attractionId,
          attractionId,
          prediction_type: 'ARRIVALS',
          horizon_minutes: normalizedHorizon,
          pressure,
          cached: true,
          generatedAt: new Date(cached.predictedAt).toISOString(),
        };
      } catch (error) {
        // Never serve a corrupt or now-impossible cache row. Fall through to
        // a fresh ML request, which itself has a conservative fallback.
        console.error('[live-prediction] Bỏ qua cache không hợp lệ:', error.message);
      }
    }
  }
  const observations = await loadObservationHistory(attractionId, { prismaClient });
  let result;
  try {
    result = validateMlPrediction(
      await callMl('/live/predict-arrivals', {
        attraction_id: attractionId,
        observations,
        current,
        horizon_minutes: normalizedHorizon,
      }),
      {
        predictionType: 'ARRIVALS',
        maximum: Math.max(1, Number(current.capacity || 0)),
      },
    );
  } catch (error) {
    result = fallbackPrediction(current, normalizedHorizon);
    result.metrics = { ...result.metrics, error: error.message };
  }
  result = await applyRuntimeQualityGate(attractionId, result, { prismaClient });
  const observation = prismaClient?.arrivalObservation?.findFirst
    ? await prismaClient.arrivalObservation.findFirst({
      where: { attractionId, bucketStart: floorBucket(referenceNow) },
      select: { id: true },
    })
    : null;
  const record = {
    attractionId,
    observationId: observation?.id || null,
    predictionType: 'ARRIVALS',
    horizonMinutes: normalizedHorizon,
    predictedP50: Number(result.predicted_p50 || 0),
    predictedP90: Number(result.predicted_p90 || 0),
    confidence: result.confidence || 'LOW',
    modelVersion: result.model_version || 'unknown',
    trainingSource: result.training_source || 'unknown',
    usedFallback: Boolean(result.used_fallback),
    featureContributions: result.feature_contributions || null,
    qualityMetrics: result.metrics || null,
    predictedAt: referenceNow,
  };
  if (prismaClient?.livePrediction?.create) {
    await prismaClient.livePrediction.create({ data: record }).catch((error) => {
      console.error('[live-prediction] Không ghi được prediction log:', error.message);
    });
  }
  return {
    ...result,
    attractionId,
    pressure,
    observedSamples: observations.length,
    generatedAt: referenceNow.toISOString(),
  };
}

async function predictLiveWait({ attractionId, date, guestsAhead, partySize, now = new Date(), publicOnly = false, prismaClient = prisma } = {}) {
  const referenceNow = new Date(now);
  if (Number.isNaN(referenceNow.getTime())) {
    throw httpError(400, 'INVALID_NOW', 'now phải là thời điểm hợp lệ.');
  }
  const liveDate = assertLivePredictionDate(date, referenceNow);
  const normalizedGuestsAhead = boundedInteger(guestsAhead, {
    field: 'guestsAhead',
    min: 0,
    max: 10000,
    fallback: 0,
  });
  const normalizedPartySize = boundedInteger(partySize, {
    field: 'partySize',
    min: 1,
    max: 100,
    fallback: 1,
  });
  const pressure = await getAttractionPressure(
    attractionId,
    liveDate,
    { prismaClient, now: referenceNow, publicOnly },
  );
  const current = currentObservation(pressure, now);
  const observations = await loadObservationHistory(attractionId, { prismaClient });
  try {
    return validateMlPrediction(
      await callMl('/live/predict-wait', {
        attraction_id: attractionId,
        observations,
        current,
        guests_ahead: normalizedGuestsAhead,
        party_size: normalizedPartySize,
        horizon_minutes: 15,
      }),
      { predictionType: 'WAIT_TIME', maximum: 240 },
    );
  } catch {
    const throughput = Math.max(1, Number(current.checkins_last_15m || 0) || Number(current.capacity || 100) * 0.08);
    const guests = Math.max(0, normalizedGuestsAhead);
    const p50 = guests === 0
      ? 0
      : Math.min(240, Math.ceil(guests / throughput * 15));
    return {
      prediction_type: 'WAIT_TIME',
      predicted_p50: p50,
      predicted_p90: Math.min(240, Math.ceil(p50 * 1.5)),
      confidence: 'LOW',
      model_version: 'eta_fallback_node_v2',
      training_source: 'operational_heuristic',
      used_fallback: true,
      feature_contributions: {
        guests_ahead: normalizedGuestsAhead,
        qr_service_throughput_15m: throughput,
      },
      metrics: {
        reason: 'ML_SERVICE_UNAVAILABLE',
        party_size_excluded_from_own_eta: true,
        wait_formula: 'guests_ahead_divided_by_qr_service_throughput',
      },
    };
  }
}

async function optimizeLiveTrip({
  liveTripId,
  userId,
  prismaClient = prisma,
  now = new Date(),
} = {}) {
  const trip = await prismaClient.liveTrip.findFirst({
    where: { id: liveTripId, status: 'ACTIVE', ...(userId ? { userId } : {}) },
    include: { items: { orderBy: [{ dayIndex: 'asc' }, { orderIndex: 'asc' }] } },
  });
  if (!trip) throw httpError(404, 'LIVE_TRIP_NOT_FOUND', 'Không tìm thấy LiveTrip đang hoạt động.');
  const referenceNow = new Date(now);
  const currentDate = getVietnamDateKey(referenceNow);
  const tripEndDate = getDateKey(trip.endDate);
  if (tripEndDate && tripEndDate < currentDate) {
    throw httpError(
      409,
      'LIVE_TRIP_ENDED',
      'Chuyến đi đã kết thúc nên không thể chạy mô phỏng Autopilot mới.',
    );
  }
  const items = trip.items.filter((item) => {
    if (['COMPLETED', 'SKIPPED'].includes(item.status)) return false;
    const start = new Date(item.scheduledStart);
    const end = item.scheduledEnd
      ? new Date(item.scheduledEnd)
      : new Date(start.getTime() + 90 * 60 * 1000);
    return !Number.isNaN(end.getTime()) && end > referenceNow;
  }).map((item) => {
    const start = new Date(item.scheduledStart);
    const end = item.scheduledEnd ? new Date(item.scheduledEnd) : new Date(start.getTime() + 90 * 60 * 1000);
    const startMinute = vietnamMinuteOfDay(start);
    const itemDate = getVietnamDateKey(start);
    const isOngoing = start <= referenceNow && end > referenceNow;
    const minutesUntilStart = itemDate === currentDate
      ? Math.max(0, startMinute - vietnamMinuteOfDay(referenceNow))
      : 24 * 60;
    const locked = Boolean(item.bookingId) || isOngoing;
    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    return {
      id: item.id,
      day_index: item.dayIndex,
      start_minute: startMinute,
      end_minute: Math.min(24 * 60, startMinute + durationMinutes),
      locked,
      risk_score: isOngoing ? 100 : item.status === 'AT_RISK' ? 90 : 10,
      flexibility_minutes: locked ? 0 : Math.min(30, minutesUntilStart),
      priority: locked ? 100 : 60,
    };
  });
  if (items.length === 0) {
    return {
      live_trip_id: liveTripId,
      algorithm_version: 'constrained_local_search_v2:no_active_items',
      baseline_score: 0,
      optimized_score: 0,
      predicted_minutes_saved: 0,
      total_shift_minutes: 0,
      protected_booking_count: 0,
      proposals: [],
      constraints: {
        locked_items_immutable: true,
        max_shift_minutes: 45,
        travel_buffer_minutes: 30,
        timezone: 'Asia/Ho_Chi_Minh',
        no_active_items: true,
        algorithm: 'bounded_local_search',
      },
      generated_at: referenceNow.toISOString(),
    };
  }
  try {
    const maxShiftMinutes = 45;
    const travelBufferMinutes = 30;
    return validateOptimizerResult(
      await callMl('/live/optimize', {
        live_trip_id: liveTripId,
        items,
        max_shift_minutes: maxShiftMinutes,
        travel_buffer_minutes: travelBufferMinutes,
        timezone: 'Asia/Ho_Chi_Minh',
      }),
      items,
      {
        liveTripId,
        maxShiftMinutes,
        travelBufferMinutes,
      },
    );
  } catch (error) {
    const failureReason = String(error?.message || '').startsWith('ML optimizer')
      ? 'ML_RESPONSE_REJECTED'
      : 'ML_SERVICE_UNAVAILABLE';
    console.error('[live-prediction] Optimizer fallback:', error?.message || failureReason);
    return {
      live_trip_id: liveTripId,
      algorithm_version: 'optimizer_unavailable_v1',
      baseline_score: 0,
      optimized_score: 0,
      predicted_minutes_saved: 0,
      total_shift_minutes: 0,
      protected_booking_count: items.filter((item) => item.locked).length,
      proposals: [],
      constraints: {
        locked_items_immutable: true,
        travel_buffer_minutes: 30,
        timezone: 'Asia/Ho_Chi_Minh',
        reason: failureReason,
      },
    };
  }
}

module.exports = {
  applyRuntimeQualityGate,
  evaluateArrivalObservations,
  evaluateLivePredictions,
  assertLivePredictionDate,
  floorBucket,
  loadObservationHistory,
  optimizeLiveTrip,
  predictLiveArrivals,
  predictLiveWait,
  recordArrivalObservation,
  validateMlPrediction,
};
