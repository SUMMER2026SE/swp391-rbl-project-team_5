'use strict';

const prisma = require('../config/prisma');
const {
  getAttractionPressure,
  getVietnamDateKey,
} = require('./arrivalPressureService');

const ML_SERVICE_URL = String(process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const ML_SERVICE_API_KEY = String(process.env.ML_SERVICE_API_KEY || '').trim();
const REQUEST_TIMEOUT_MS = Math.min(15000, Math.max(1000, Number(process.env.ML_SERVICE_TIMEOUT_MS || 8000)));
const OBSERVATION_WINDOW = 200;
const PREDICTION_CACHE_MS = 15 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

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

function boundedInteger(value, { field, min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw httpError(400, 'INVALID_LIVE_PREDICTION_INPUT', `${field} phải là số nguyên trong khoảng ${min}-${max}.`);
  }
  return normalized;
}

function vietnamMinuteOfDay(value) {
  const shifted = new Date(new Date(value).getTime() + VIETNAM_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
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
    model_version: 'arrival_fallback_node_v2',
    training_source: 'operational_heuristic',
    used_fallback: true,
    feature_contributions: { checkins_last_15m: recent * 0.65, booked_guests: scheduled * 0.025, queue_guests: queue * 0.05 },
    metrics: { reason: 'ML_SERVICE_UNAVAILABLE' },
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
  const pressure = await getAttractionPressure(attractionId, getVietnamDateKey(now), { prismaClient, now });
  const bucketStart = floorBucket(now);
  const observationKey = `${attractionId}:${bucketStart.toISOString()}`;
  return prismaClient.arrivalObservation.upsert({
    where: { observationKey },
    create: {
      observationKey,
      attractionId,
      bucketStart,
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
  if (!prismaClient?.arrivalObservation?.findMany) return { evaluated: 0 };
  const cutoff = new Date(new Date(now).getTime() - 15 * 60 * 1000);
  const rows = await prismaClient.arrivalObservation.findMany({
    where: { actualArrivalsNext15m: null, bucketStart: { lte: cutoff } },
    take: 100,
    select: { id: true, attractionId: true, bucketStart: true },
  });
  let evaluated = 0;
  for (const row of rows) {
    const end = new Date(new Date(row.bucketStart).getTime() + 15 * 60 * 1000);
    const actual = await prismaClient.ticketInstance.count({
      where: {
        status: 'USED',
        checkedInAt: { gte: row.bucketStart, lt: end },
        booking: { snapshotAttractionId: row.attractionId },
      },
    });
    const result = await prismaClient.arrivalObservation.updateMany({
      where: { id: row.id, actualArrivalsNext15m: null },
      data: { actualArrivalsNext15m: actual, evaluatedAt: new Date(now) },
    });
    evaluated += result.count;
  }
  return { evaluated };
}

async function evaluateLivePredictions({ now = new Date(), prismaClient = prisma } = {}) {
  if (!prismaClient?.livePrediction?.findMany) return { evaluated: 0 };
  const referenceNow = new Date(now);
  const rows = await prismaClient.livePrediction.findMany({
    where: {
      predictionType: 'ARRIVALS',
      actualValue: null,
      predictedAt: { lte: new Date(referenceNow.getTime() - 5 * 60 * 1000) },
    },
    orderBy: { predictedAt: 'asc' },
    take: 100,
    select: {
      id: true,
      attractionId: true,
      predictedAt: true,
      horizonMinutes: true,
    },
  });
  let evaluated = 0;
  for (const row of rows || []) {
    const windowEnd = new Date(
      new Date(row.predictedAt).getTime() + Number(row.horizonMinutes || 15) * 60 * 1000,
    );
    if (windowEnd > referenceNow) continue;
    const actual = await prismaClient.ticketInstance.count({
      where: {
        status: 'USED',
        checkedInAt: { gte: row.predictedAt, lt: windowEnd },
        booking: { snapshotAttractionId: row.attractionId },
      },
    });
    const result = await prismaClient.livePrediction.updateMany({
      where: { id: row.id, actualValue: null },
      data: { actualValue: actual, evaluatedAt: referenceNow },
    });
    evaluated += result.count;
  }
  return { evaluated };
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
  const pressure = await getAttractionPressure(
    attractionId,
    date || getVietnamDateKey(now),
    { prismaClient, now, publicOnly },
  );
  if (!force && prismaClient?.livePrediction?.findFirst) {
    const cached = await prismaClient.livePrediction.findFirst({
      where: {
        attractionId,
        predictionType: 'ARRIVALS',
        horizonMinutes: normalizedHorizon,
        predictedAt: { gte: new Date(referenceNow.getTime() - PREDICTION_CACHE_MS) },
      },
      orderBy: { predictedAt: 'desc' },
    });
    if (cached) {
      return {
        attraction_id: attractionId,
        attractionId,
        prediction_type: 'ARRIVALS',
        horizon_minutes: normalizedHorizon,
        predicted_p50: cached.predictedP50,
        predicted_p90: cached.predictedP90,
        confidence: cached.confidence,
        model_version: cached.modelVersion,
        training_source: cached.trainingSource,
        used_fallback: cached.usedFallback,
        feature_contributions: cached.featureContributions || {},
        metrics: { cache_hit: true, cache_ttl_seconds: PREDICTION_CACHE_MS / 1000 },
        pressure,
        cached: true,
        generatedAt: cached.predictedAt,
      };
    }
  }
  const current = currentObservation(pressure, now);
  const observations = await loadObservationHistory(attractionId, { prismaClient });
  let result;
  try {
    result = await callMl('/live/predict-arrivals', {
      attraction_id: attractionId,
      observations,
      current,
      horizon_minutes: normalizedHorizon,
    });
  } catch (error) {
    result = fallbackPrediction(current, normalizedHorizon);
    result.metrics = { ...result.metrics, error: error.message };
  }
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
    generatedAt: new Date().toISOString(),
  };
}

async function predictLiveWait({ attractionId, date, guestsAhead, partySize, now = new Date(), publicOnly = false, prismaClient = prisma } = {}) {
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
    date || getVietnamDateKey(now),
    { prismaClient, now, publicOnly },
  );
  const current = currentObservation(pressure, now);
  const observations = await loadObservationHistory(attractionId, { prismaClient });
  try {
    return await callMl('/live/predict-wait', {
      attraction_id: attractionId,
      observations,
      current,
      guests_ahead: normalizedGuestsAhead,
      party_size: normalizedPartySize,
      horizon_minutes: 15,
    });
  } catch {
    const throughput = Math.max(1, Number(current.checkins_last_15m || 0) || Number(current.capacity || 100) * 0.08);
    const guests = Math.max(1, normalizedGuestsAhead + normalizedPartySize);
    const p50 = Math.min(240, Math.ceil(guests / throughput * 15));
    return {
      prediction_type: 'WAIT_TIME',
      predicted_p50: p50,
      predicted_p90: Math.min(240, Math.ceil(p50 * 1.5)),
      confidence: 'LOW',
      model_version: 'eta_fallback_node_v1',
      training_source: 'operational_heuristic',
      used_fallback: true,
      feature_contributions: { guests_ahead: normalizedGuestsAhead, throughput },
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
    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    return {
      id: item.id,
      day_index: item.dayIndex,
      start_minute: startMinute,
      end_minute: Math.min(24 * 60, startMinute + durationMinutes),
      locked: Boolean(item.bookingId),
      risk_score: item.status === 'AT_RISK' ? 90 : 10,
      flexibility_minutes: item.bookingId ? 0 : 30,
      priority: item.bookingId ? 100 : 60,
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
    return await callMl('/live/optimize', {
      live_trip_id: liveTripId,
      items,
      max_shift_minutes: 45,
      travel_buffer_minutes: 30,
      timezone: 'Asia/Ho_Chi_Minh',
    });
  } catch {
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
        reason: 'ML_SERVICE_UNAVAILABLE',
      },
    };
  }
}

module.exports = {
  evaluateArrivalObservations,
  evaluateLivePredictions,
  floorBucket,
  loadObservationHistory,
  optimizeLiveTrip,
  predictLiveArrivals,
  predictLiveWait,
  recordArrivalObservation,
};
