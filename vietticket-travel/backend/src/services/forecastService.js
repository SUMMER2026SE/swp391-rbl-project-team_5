'use strict';

const prisma = require('../config/prisma');

const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 180;
const MIN_AI_OBSERVED_DAYS = 14;
const MIN_AI_BOOKINGS = 30;
const MIN_BASELINE_OBSERVED_DAYS = 7;
const MIN_BASELINE_BOOKINGS = 10;
const FALLBACK_MODEL_VERSION = 'seasonal_baseline_v2';
const INSUFFICIENT_DATA_MODEL_VERSION = 'insufficient_data_v1';
const FORECAST_DATA_BASIS = 'NET_TICKET_REVENUE_BY_VISIT_DATE';

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

const ML_SERVICE_URL = String(process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const ML_SERVICE_API_KEY = String(process.env.ML_SERVICE_API_KEY || '').trim();
const ALLOW_DEMO_AI = process.env.NODE_ENV !== 'production'
  && ['1', 'true', 'yes'].includes(
    String(process.env.ALLOW_DEMO_AI || '').trim().toLowerCase(),
  );
const ML_REQUEST_TIMEOUT_MS = positiveInteger(
  process.env.ML_SERVICE_TIMEOUT_MS,
  8000,
  1000,
  60000,
);
const FORECAST_CACHE_TTL_MS = positiveInteger(
  process.env.FORECAST_CACHE_TTL_MS,
  6 * 60 * 60 * 1000,
  60 * 1000,
  7 * DAY_MS,
);
const HISTORY_LOOKBACK_DAYS = positiveInteger(
  process.env.FORECAST_HISTORY_DAYS,
  DEFAULT_LOOKBACK_DAYS,
  56,
  730,
);

function resolveTrainingSourceMode(
  trainingSource,
  allowDemoAi = ALLOW_DEMO_AI,
) {
  if (trainingSource === 'real_booking_history') {
    return {
      method: 'AI_ENSEMBLE',
      warning: null,
    };
  }
  if (trainingSource === 'demo_booking_history' && allowDemoAi) {
    return {
      method: 'AI_DEMO_ENSEMBLE',
      warning: 'Model AI đang dùng booking mô phỏng để trình diễn pipeline local. Không sử dụng kết quả này làm cam kết doanh thu hoặc bằng chứng độ chính xác thực tế.',
    };
  }
  return null;
}

function vietnamDateKey(date = new Date()) {
  return new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

function addDateKeyDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function dateOnly(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function finiteMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function derivePriceTier(avgTicketPrice) {
  if (avgTicketPrice < 150000) return 'BUDGET';
  if (avgTicketPrice < 350000) return 'STANDARD';
  if (avgTicketPrice < 700000) return 'PREMIUM';
  return 'LUXURY';
}

function successfulRefundAmount(booking) {
  return (booking.refundTransactions || []).reduce((sum, transaction) => (
    transaction.refundRequest?.type === 'DUPLICATE_PAYMENT'
      ? sum
      : sum + finiteMoney(transaction.amount)
  ), 0);
}

function recognizedRevenueOf(booking) {
  const captured = (booking.payments || []).reduce(
    (sum, payment) => sum + finiteMoney(payment.amount),
    0,
  );
  return Math.max(0, captured - successfulRefundAmount(booking));
}

/**
 * Lịch sử dùng cho forecasting là doanh thu vé thuần theo ngày tham quan:
 * - chỉ COMPLETED/NO_SHOW (dịch vụ đã được ghi nhận);
 * - chỉ payment SUCCESS, không trùng;
 * - trừ refund SUCCESS không thuộc hoàn payment trùng;
 * - ưu tiên snapshotVisitDate/snapshotAttractionId bất biến.
 *
 * Hôm nay chưa kết thúc nên history dừng ở hôm qua theo múi giờ Việt Nam.
 */
async function getDailyRevenueHistory(
  attractionId,
  days = HISTORY_LOOKBACK_DAYS,
  now = new Date(),
) {
  const normalizedDays = positiveInteger(days, HISTORY_LOOKBACK_DAYS, 1, 730);
  const todayKey = vietnamDateKey(now);
  const endKey = addDateKeyDays(todayKey, -1);
  const startKey = addDateKeyDays(endKey, -(normalizedDays - 1));
  const serviceDateRange = {
    gte: dateOnly(startKey),
    lte: dateOnly(endKey),
  };

  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ['COMPLETED', 'NO_SHOW'] },
      payments: { some: { status: 'SUCCESS', isDuplicate: false } },
      OR: [
        {
          snapshotAttractionId: attractionId,
          snapshotVisitDate: serviceDateRange,
        },
        {
          snapshotAttractionId: attractionId,
          snapshotVisitDate: null,
          reservation: { date: serviceDateRange },
        },
        {
          snapshotAttractionId: null,
          reservation: {
            date: serviceDateRange,
            ticketProduct: { attractionId },
          },
        },
      ],
    },
    select: {
      snapshotVisitDate: true,
      payments: {
        where: { status: 'SUCCESS', isDuplicate: false },
        select: { amount: true },
      },
      refundTransactions: {
        where: { status: 'SUCCESS' },
        select: {
          amount: true,
          refundRequest: { select: { type: true } },
        },
      },
      reservation: {
        select: {
          date: true,
          quantity: true,
        },
      },
    },
  });

  const byDay = new Map();
  for (const booking of bookings) {
    const visitDate = booking.snapshotVisitDate || booking.reservation?.date;
    if (!visitDate) continue;

    const key = new Date(visitDate).toISOString().slice(0, 10);
    if (key < startKey || key > endKey) continue;

    const revenue = recognizedRevenueOf(booking);
    if (revenue <= 0) continue;

    const entry = byDay.get(key) || {
      revenue: 0,
      bookings: 0,
      tickets: 0,
    };
    entry.revenue += revenue;
    entry.bookings += 1;
    entry.tickets += Math.max(0, Number(booking.reservation?.quantity || 0));
    byDay.set(key, entry);
  }

  return Array.from({ length: normalizedDays }, (_, index) => {
    const date = addDateKeyDays(startKey, index);
    const entry = byDay.get(date) || { revenue: 0, bookings: 0, tickets: 0 };
    return {
      date,
      revenue: finiteMoney(entry.revenue),
      bookings: entry.bookings,
      tickets: entry.tickets,
    };
  });
}

async function getAttractionForecastFeatures(attractionId) {
  const attraction = await prisma.attraction.findUnique({
    where: { id: attractionId },
    select: {
      id: true,
      title: true,
      city: true,
      defaultCapacity: true,
      averageRating: true,
      totalReviews: true,
      minTicketPrice: true,
      partnerId: true,
      status: true,
      publicationStatus: true,
      operationalStatus: true,
      archivedAt: true,
      publishedAt: true,
      partner: {
        select: { status: true },
      },
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        select: { sellingPrice: true },
      },
    },
  });

  if (!attraction) return null;

  const activePrices = attraction.ticketProducts.map((product) => Number(product.sellingPrice));
  const catalogAvgTicketPrice = median(activePrices)
    || finiteMoney(attraction.minTicketPrice);
  return {
    id: attraction.id,
    title: attraction.title,
    partnerId: attraction.partnerId,
    city: attraction.city || 'Khác',
    capacity: Math.max(1, Number(attraction.defaultCapacity || 1)),
    catalogAvgTicketPrice,
    tier: derivePriceTier(catalogAvgTicketPrice),
    rating: Number(attraction.averageRating || 0),
    numReviews: Number(attraction.totalReviews || 0),
    isForecastable:
      !attraction.archivedAt
      && Boolean(attraction.publishedAt)
      && attraction.partner?.status === 'APPROVED'
      && attraction.status === 'APPROVED'
      && attraction.publicationStatus === 'ACTIVE'
      && attraction.operationalStatus === 'ACTIVE'
      && activePrices.some((price) => Number.isFinite(price) && price > 0),
  };
}

function summarizeHistory(history) {
  const revenue = history.reduce((sum, point) => sum + finiteMoney(point.revenue), 0);
  const completedBookings = history.reduce(
    (sum, point) => sum + Number(point.bookings || 0),
    0,
  );
  const soldTickets = history.reduce(
    (sum, point) => sum + Number(point.tickets || 0),
    0,
  );
  const observedDays = history.filter((point) => point.revenue > 0).length;
  const avgRealizedTicketPrice = soldTickets > 0 ? revenue / soldTickets : 0;

  return {
    lookbackDays: history.length,
    observedDays,
    completedBookings,
    soldTickets,
    avgRealizedTicketPrice,
    sufficientForBaseline:
      observedDays >= MIN_BASELINE_OBSERVED_DAYS
      && completedBookings >= MIN_BASELINE_BOOKINGS,
    sufficientForAi:
      history.length >= 56
      && observedDays >= MIN_AI_OBSERVED_DAYS
      && completedBookings >= MIN_AI_BOOKINGS,
  };
}

async function callMlServiceForecast(features, history, forecastDays) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ML_SERVICE_URL}/forecast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ML_SERVICE_API_KEY ? { 'x-ml-api-key': ML_SERVICE_API_KEY } : {}),
      },
      body: JSON.stringify({
        attraction_id: features.id,
        tier: features.tier,
        city: features.city,
        capacity: features.capacity,
        avg_ticket_price: features.effectiveAvgTicketPrice,
        rating: features.rating,
        num_reviews: features.numReviews,
        history: history.map((point) => ({
          date: point.date,
          revenue: point.revenue,
          tickets: point.tickets,
        })),
        forecast_days: forecastDays,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`ml-service trả về ${response.status}: ${body.slice(0, 200)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function coefficientOfVariation(values) {
  if (values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return 1;
  const variance = values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0,
  ) / values.length;
  return Math.sqrt(variance) / mean;
}

function normalizeForecastPoint(point, expectedDate, features) {
  const receivedDate = String(point.date || '').slice(0, 10);
  if (receivedDate !== expectedDate) {
    throw new Error(`ml-service trả sai ngày dự báo: cần ${expectedDate}, nhận ${receivedDate || 'rỗng'}.`);
  }

  const avgPrice = Math.max(1, features.effectiveAvgTicketPrice);
  const inventoryRevenueCeiling = features.capacity * avgPrice;
  const rawRevenue = finiteMoney(point.predicted_revenue);
  const predictedRevenue = Math.min(rawRevenue, inventoryRevenueCeiling);
  const predictedTickets = Math.min(
    features.capacity,
    Math.max(
      0,
      Math.round(Number(point.predicted_tickets ?? predictedRevenue / avgPrice)),
    ),
  );
  const lower = Math.min(
    predictedRevenue,
    finiteMoney(point.confidence_lower),
  );
  const upper = Math.max(
    predictedRevenue,
    Math.min(inventoryRevenueCeiling, finiteMoney(point.confidence_upper)),
  );

  return {
    date: expectedDate,
    predictedRevenue,
    predictedTickets,
    confidenceLower: lower,
    confidenceUpper: upper,
  };
}

function normalizeMlForecast(rawForecast, history, forecastDays, features) {
  if (!Array.isArray(rawForecast) || rawForecast.length !== forecastDays) {
    throw new Error('ml-service trả về số ngày dự báo không hợp lệ.');
  }

  const lastHistoryDate = history[history.length - 1]?.date
    || addDateKeyDays(vietnamDateKey(), -1);
  return rawForecast.map((point, index) => normalizeForecastPoint(
    point,
    addDateKeyDays(lastHistoryDate, index + 1),
    features,
  ));
}

/**
 * Baseline dự phòng có mùa vụ theo thứ trong tuần và xu hướng giảm chấn.
 * Đây không được gắn nhãn AI; khoảng dự báo được cố ý để rộng hơn.
 */
function buildFallbackForecast(history, forecastDays, features, reason) {
  const recent28 = history.slice(-28).map((point) => point.revenue);
  const previous28 = history.slice(-56, -28).map((point) => point.revenue);
  const recentMean = recent28.reduce((sum, value) => sum + value, 0)
    / Math.max(1, recent28.length);
  const previousMean = previous28.reduce((sum, value) => sum + value, 0)
    / Math.max(1, previous28.length);
  const rawTrend = previousMean > 0 ? recentMean / previousMean : 1;
  const dampedTrend = Math.min(1.2, Math.max(0.8, rawTrend));
  const variability = Math.min(1.5, Math.max(0.35, coefficientOfVariation(recent28)));
  const lastDate = history[history.length - 1]?.date
    || addDateKeyDays(vietnamDateKey(), -1);
  const avgPrice = Math.max(1, features.effectiveAvgTicketPrice);
  const inventoryRevenueCeiling = features.capacity * avgPrice;

  const forecast = Array.from({ length: forecastDays }, (_, index) => {
    const date = addDateKeyDays(lastDate, index + 1);
    const targetDayOfWeek = dateOnly(date).getUTCDay();
    const sameWeekday = history
      .filter((point) => dateOnly(point.date).getUTCDay() === targetDayOfWeek)
      .slice(-8)
      .map((point) => point.revenue);
    const weekdayMean = sameWeekday.length > 0
      ? sameWeekday.reduce((sum, value) => sum + value, 0) / sameWeekday.length
      : recentMean * ([0, 6].includes(targetDayOfWeek) ? 1.2 : 1);
    const trendWeight = Math.min(0.5, (index + 1) / 60);
    const trendFactor = 1 + (dampedTrend - 1) * trendWeight;
    const predictedRevenue = Math.min(
      inventoryRevenueCeiling,
      finiteMoney((weekdayMean * 0.75 + recentMean * 0.25) * trendFactor),
    );
    const intervalRatio = Math.min(0.8, 0.25 + variability * 0.35);

    return {
      date,
      predictedRevenue,
      predictedTickets: Math.min(
        features.capacity,
        Math.max(0, Math.round(predictedRevenue / avgPrice)),
      ),
      confidenceLower: finiteMoney(predictedRevenue * (1 - intervalRatio)),
      confidenceUpper: Math.min(
        inventoryRevenueCeiling,
        finiteMoney(predictedRevenue * (1 + intervalRatio)),
      ),
    };
  });

  return {
    forecast,
    modelVersion: FALLBACK_MODEL_VERSION,
    trainingSource: 'historical_baseline',
    usedFallback: true,
    forecastAvailable: true,
    method: 'HISTORICAL_BASELINE',
    warning: reason,
  };
}

function buildInsufficientDataForecast(history, forecastDays, warning = '') {
  const lastDate = history[history.length - 1]?.date
    || addDateKeyDays(vietnamDateKey(), -1);
  return {
    forecast: Array.from({ length: forecastDays }, (_, index) => ({
      date: addDateKeyDays(lastDate, index + 1),
      predictedRevenue: 0,
      predictedTickets: 0,
      confidenceLower: 0,
      confidenceUpper: 0,
    })),
    modelVersion: INSUFFICIENT_DATA_MODEL_VERSION,
    trainingSource: 'insufficient_data',
    usedFallback: true,
    forecastAvailable: false,
    method: 'INSUFFICIENT_DATA',
    warning: warning || 'Chưa có booking hoàn tất phát sinh doanh thu thực để lập dự báo. Hệ thống không tự biến dữ liệu trống thành dự báo 0 đồng.',
  };
}

function mapStoredRows(attractionId, rows, features) {
  const first = rows[0];
  const trainingSource = String(first.trainingSource || 'unknown');
  const isDemoModel = trainingSource === 'demo_booking_history';
  // Tương thích cache cũ: baseline toàn số 0 khi không có booking không phải là
  // một dự báo hợp lệ, dù trước đây nó từng được ghi là HISTORICAL_BASELINE.
  const hasInsufficientBaselineData = Number(first.observedDays || 0) < MIN_BASELINE_OBSERVED_DAYS
    || Number(first.sampleBookings || 0) < MIN_BASELINE_BOOKINGS;
  const isInsufficientData = trainingSource === 'insufficient_data'
    || (trainingSource === 'historical_baseline' && hasInsufficientBaselineData);
  let method = isDemoModel ? 'AI_DEMO_ENSEMBLE' : 'AI_ENSEMBLE';
  let warning = isDemoModel
    ? 'Model AI này được huấn luyện bằng booking mô phỏng để kiểm thử kỹ thuật, không phải bằng chứng độ chính xác kinh doanh thực tế.'
    : null;
  if (first.usedFallback) {
    method = 'HISTORICAL_BASELINE';
    warning = 'Dự báo đang dùng baseline lịch sử do dữ liệu chưa đủ hoặc dịch vụ AI chưa sẵn sàng.';
  }
  if (isInsufficientData) {
    method = 'INSUFFICIENT_DATA';
    warning = `Chưa đủ dữ liệu để lập dự báo đáng tin cậy (cần tối thiểu ${MIN_BASELINE_OBSERVED_DAYS} ngày có doanh thu và ${MIN_BASELINE_BOOKINGS} booking hoàn tất).`;
  }
  return {
    attractionId,
    attractionTitle: features?.title,
    modelVersion: first.modelVersion,
    trainingSource,
    generatedAt: first.generatedAt,
    fromCache: true,
    usedFallback: Boolean(first.usedFallback),
    forecastAvailable: !isInsufficientData,
    method,
    dataBasis: FORECAST_DATA_BASIS,
    dataQuality: {
      lookbackDays: first.historyDays,
      observedDays: first.observedDays,
      completedBookings: first.sampleBookings,
      sufficientForBaseline:
        first.observedDays >= MIN_BASELINE_OBSERVED_DAYS
        && first.sampleBookings >= MIN_BASELINE_BOOKINGS,
      sufficientForAi:
        first.historyDays >= 56
        && first.observedDays >= MIN_AI_OBSERVED_DAYS
        && first.sampleBookings >= MIN_AI_BOOKINGS,
    },
    warning,
    forecast: rows.map((row) => ({
      date: row.forecastDate.toISOString().slice(0, 10),
      predictedRevenue: Number(row.predictedRevenue),
      predictedTickets: row.predictedTickets,
      confidenceLower: row.confidenceLower === null ? null : Number(row.confidenceLower),
      confidenceUpper: row.confidenceUpper === null ? null : Number(row.confidenceUpper),
    })),
  };
}

async function getFreshStoredForecast(
  attractionId,
  forecastDays,
  features,
  now = new Date(),
) {
  const todayKey = vietnamDateKey(now);
  const rows = await prisma.revenueForecast.findMany({
    where: {
      attractionId,
      forecastDate: { gte: dateOnly(todayKey) },
      generatedAt: { gte: new Date(now.getTime() - FORECAST_CACHE_TTL_MS) },
    },
    orderBy: { forecastDate: 'asc' },
    take: forecastDays,
  });

  if (rows.length !== forecastDays) return null;
  const expectedDates = Array.from(
    { length: forecastDays },
    (_, index) => addDateKeyDays(todayKey, index),
  );
  const isContiguous = rows.every(
    (row, index) => row.forecastDate.toISOString().slice(0, 10) === expectedDates[index],
  );
  if (!isContiguous) return null;

  // Unique key chỉ gồm attraction + forecastDate. Một lần refresh horizon ngắn
  // có thể ghi đè vài ngày đầu và để lại các ngày cũ. Không được ghép hai lần
  // sinh/model thành một đường dự báo duy nhất.
  const first = rows[0];
  const sameForecastRun = rows.every((row) => (
    new Date(row.generatedAt).getTime() === new Date(first.generatedAt).getTime()
    && row.modelVersion === first.modelVersion
    && String(row.trainingSource || 'unknown') === String(first.trainingSource || 'unknown')
    && Boolean(row.usedFallback) === Boolean(first.usedFallback)
    && Number(row.historyDays || 0) === Number(first.historyDays || 0)
    && Number(row.observedDays || 0) === Number(first.observedDays || 0)
    && Number(row.sampleBookings || 0) === Number(first.sampleBookings || 0)
  ));
  if (!sameForecastRun) return null;

  const source = String(first.trainingSource || 'unknown');
  const isKnownNonAiResult = source === 'historical_baseline'
    || source === 'insufficient_data';
  if (!isKnownNonAiResult && !resolveTrainingSourceMode(source)) return null;

  return mapStoredRows(attractionId, rows, features);
}

async function reconcileActualRevenue(attractionId, history) {
  if (history.length === 0) return;
  const byDate = new Map(history.map((point) => [point.date, point.revenue]));
  const rows = await prisma.revenueForecast.findMany({
    where: {
      attractionId,
      actualRevenue: null,
      forecastDate: {
        gte: dateOnly(history[0].date),
        lte: dateOnly(history[history.length - 1].date),
      },
    },
    select: { id: true, forecastDate: true },
  });
  if (rows.length === 0) return;

  await prisma.$transaction(rows.map((row) => prisma.revenueForecast.update({
    where: { id: row.id },
    data: {
      actualRevenue: byDate.get(row.forecastDate.toISOString().slice(0, 10)) || 0,
    },
  })));
}

async function persistForecast(
  attractionId,
  result,
  dataQuality,
) {
  const generatedAt = new Date();
  await prisma.$transaction(result.forecast.map((point) => prisma.revenueForecast.upsert({
    where: {
      attractionId_forecastDate: {
        attractionId,
        forecastDate: dateOnly(point.date),
      },
    },
    create: {
      attractionId,
      forecastDate: dateOnly(point.date),
      predictedRevenue: point.predictedRevenue,
      predictedTickets: point.predictedTickets,
      confidenceLower: point.confidenceLower,
      confidenceUpper: point.confidenceUpper,
      modelVersion: result.modelVersion,
      trainingSource: result.trainingSource,
      usedFallback: result.usedFallback,
      historyDays: dataQuality.lookbackDays,
      observedDays: dataQuality.observedDays,
      sampleBookings: dataQuality.completedBookings,
      generatedAt,
    },
    update: {
      predictedRevenue: point.predictedRevenue,
      predictedTickets: point.predictedTickets,
      confidenceLower: point.confidenceLower,
      confidenceUpper: point.confidenceUpper,
      modelVersion: result.modelVersion,
      trainingSource: result.trainingSource,
      usedFallback: result.usedFallback,
      historyDays: dataQuality.lookbackDays,
      observedDays: dataQuality.observedDays,
      sampleBookings: dataQuality.completedBookings,
      generatedAt,
    },
  })));
  return generatedAt;
}

async function getForecastForAttraction(
  attractionId,
  { forecastDays = 7, forceRefresh = false } = {},
) {
  const normalizedDays = positiveInteger(forecastDays, 7, 1, 30);
  const features = await getAttractionForecastFeatures(attractionId);
  if (!features) {
    const error = new Error('Không tìm thấy điểm tham quan.');
    error.statusCode = 404;
    throw error;
  }
  if (!features.isForecastable) {
    const error = new Error(
      'Chỉ dự báo cho điểm tham quan đã duyệt, đang mở bán và có gói vé hoạt động.',
    );
    error.statusCode = 422;
    throw error;
  }

  if (!forceRefresh) {
    const cached = await getFreshStoredForecast(
      attractionId,
      normalizedDays,
      features,
    );
    if (cached) return cached;
  }

  const history = await getDailyRevenueHistory(attractionId);
  const dataQuality = summarizeHistory(history);
  features.effectiveAvgTicketPrice = dataQuality.avgRealizedTicketPrice
    || features.catalogAvgTicketPrice;
  if (features.effectiveAvgTicketPrice <= 0) {
    const error = new Error('Điểm tham quan chưa có giá vé hợp lệ để dự báo.');
    error.statusCode = 422;
    throw error;
  }

  await reconcileActualRevenue(attractionId, history);

  let result;
  if (!dataQuality.sufficientForBaseline) {
    result = buildInsufficientDataForecast(
      history,
      normalizedDays,
      dataQuality.completedBookings === 0
        ? ''
        : `Chưa đủ dữ liệu để lập dự báo đáng tin cậy (cần tối thiểu ${MIN_BASELINE_OBSERVED_DAYS} ngày có doanh thu và ${MIN_BASELINE_BOOKINGS} booking hoàn tất).`,
    );
  } else if (!dataQuality.sufficientForAi) {
    result = buildFallbackForecast(
      history,
      normalizedDays,
      features,
      `Chưa đủ dữ liệu thực để dùng model AI (cần ít nhất ${MIN_AI_OBSERVED_DAYS} ngày có doanh thu và ${MIN_AI_BOOKINGS} booking đã hoàn tất). Đang hiển thị baseline mùa vụ từ lịch sử.`,
    );
  } else {
    try {
      const mlResult = await callMlServiceForecast(
        features,
        history,
        normalizedDays,
      );
      const modelMode = resolveTrainingSourceMode(mlResult.training_source);
      if (!modelMode) {
        result = buildFallbackForecast(
          history,
          normalizedDays,
          features,
          'Model hiện tại chưa được huấn luyện bằng lịch sử booking thật. Đang hiển thị baseline mùa vụ để không biến kết quả bootstrap thành dự báo AI trong vận hành.',
        );
      } else {
        result = {
          forecast: normalizeMlForecast(
            mlResult.forecast,
            history,
            normalizedDays,
            features,
          ),
          modelVersion: String(mlResult.model_version || 'unknown'),
          trainingSource: mlResult.training_source,
          usedFallback: false,
          forecastAvailable: true,
          method: modelMode.method,
          warning: modelMode.warning || mlResult.warning || null,
        };
      }
    } catch (error) {
      console.error(
        `[forecastService] ml-service lỗi cho attraction ${attractionId}:`,
        error.message,
      );
      result = buildFallbackForecast(
        history,
        normalizedDays,
        features,
        'Dịch vụ AI tạm thời chưa sẵn sàng. Đang hiển thị baseline mùa vụ từ dữ liệu thực, với khoảng dự báo rộng hơn.',
      );
    }
  }

  const generatedAt = await persistForecast(attractionId, result, dataQuality);
  return {
    attractionId,
    attractionTitle: features.title,
    modelVersion: result.modelVersion,
    trainingSource: result.trainingSource,
    generatedAt,
    fromCache: false,
    usedFallback: result.usedFallback,
    forecastAvailable: result.forecastAvailable !== false,
    method: result.method,
    dataBasis: FORECAST_DATA_BASIS,
    dataQuality,
    warning: result.warning,
    forecast: result.forecast,
  };
}

module.exports = {
  FORECAST_DATA_BASIS,
  buildFallbackForecast,
  buildInsufficientDataForecast,
  derivePriceTier,
  getAttractionForecastFeatures,
  getDailyRevenueHistory,
  getForecastForAttraction,
  getFreshStoredForecast,
  resolveTrainingSourceMode,
  summarizeHistory,
  vietnamDateKey,
};
