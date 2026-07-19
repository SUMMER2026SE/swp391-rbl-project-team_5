'use strict';

// ============================================================
// forecastService.js
// ------------------------------------------------------------
// Cầu nối giữa Node backend và ml-service (FastAPI, ensemble
// RandomForest + XGBoost) cho tính năng AI dự báo doanh thu.
//
// Luồng chính:
//   1. Tổng hợp lịch sử doanh thu theo NGÀY (giờ Việt Nam) cho 1
//      attraction từ bảng Booking (chỉ tính đơn đã thu tiền thành công,
//      cùng tiêu chí với báo cáo đối tác hiện có: status CONFIRMED/
//      COMPLETED/NO_SHOW + có payment SUCCESS không trùng lặp).
//   2. Gửi lịch sử + đặc trưng tĩnh của attraction (tier, city, capacity,
//      giá vé trung bình, rating...) sang ml-service qua POST /forecast.
//   3. Lưu (upsert) kết quả vào bảng RevenueForecast để tránh gọi lại
//      ml-service mỗi lần Admin/Partner mở dashboard (cache TTL).
//   4. Nếu ml-service không phản hồi được (đang khởi động, lỗi mạng...),
//      dùng phương án dự phòng: trung bình trượt 28 ngày gần nhất, để
//      dashboard vẫn hiển thị được con số tham khảo thay vì lỗi trắng.
// ============================================================

const prisma = require('../config/prisma');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY || '';
const ML_REQUEST_TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS) || 8000;
const FORECAST_CACHE_TTL_MS = Number(process.env.FORECAST_CACHE_TTL_MS) || 6 * 60 * 60 * 1000; // 6 giờ
const HISTORY_LOOKBACK_DAYS = 90;
const FALLBACK_MODEL_VERSION = 'moving_average_fallback_v1';

const PAID_BOOKING_WHERE = {
  status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
  payments: { some: { status: 'SUCCESS', isDuplicate: false } },
};

// ---- Bucketing theo ngày giờ Việt Nam (UTC+7, không có DST) ----

function vietnamDateKey(date) {
  const vnMs = date.getTime() + 7 * 60 * 60 * 1000;
  const vn = new Date(vnMs);
  return vn.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function startOfVietnamDaysAgo(days) {
  const now = new Date();
  const vnNowMs = now.getTime() + 7 * 60 * 60 * 1000;
  const vnMidnightTodayMs = Math.floor(vnNowMs / 86400000) * 86400000;
  const startVnMs = vnMidnightTodayMs - (days - 1) * 86400000;
  return new Date(startVnMs - 7 * 60 * 60 * 1000); // quy đổi lại về UTC thật để query DB
}

// Trả về lịch sử doanh thu/ngày cho 1 attraction, zero-fill các ngày không có đơn.
// Sắp xếp TĂNG DẦN theo ngày (đúng format ml-service yêu cầu).
async function getDailyRevenueHistory(attractionId, days = HISTORY_LOOKBACK_DAYS) {
  const startDate = startOfVietnamDaysAgo(days);

  const bookings = await prisma.booking.findMany({
    where: {
      ...PAID_BOOKING_WHERE,
      createdAt: { gte: startDate },
      reservation: {
        ticketProduct: { attractionId },
      },
    },
    select: {
      createdAt: true,
      payments: {
        where: { status: 'SUCCESS', isDuplicate: false },
        select: { amount: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byDay = new Map();
  for (const booking of bookings) {
    const key = vietnamDateKey(new Date(booking.createdAt));
    const amount = booking.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const entry = byDay.get(key) || { revenue: 0, bookings: 0 };
    entry.revenue += amount;
    entry.bookings += 1;
    byDay.set(key, entry);
  }

  const history = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayMs = Date.now() - i * 86400000;
    const key = vietnamDateKey(new Date(dayMs));
    const entry = byDay.get(key) || { revenue: 0, bookings: 0 };
    history.push({ date: key, revenue: Math.round(entry.revenue), bookings: entry.bookings });
  }
  // Loại trùng lặp ngày hôm nay có thể lệch do giờ chạy job; đảm bảo unique + sort.
  const uniqueSorted = [...new Map(history.map((h) => [h.date, h])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return uniqueSorted;
}

// Lấy đặc trưng tĩnh của attraction dùng làm input cho ml-service.
async function getAttractionForecastFeatures(attractionId) {
  const attraction = await prisma.attraction.findUnique({
    where: { id: attractionId },
    select: {
      id: true,
      title: true,
      city: true,
      tier: true,
      defaultCapacity: true,
      averageRating: true,
      totalReviews: true,
      publishedAt: true,
      minTicketPrice: true,
      partnerId: true,
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        select: { sellingPrice: true },
      },
    },
  });

  if (!attraction) return null;

  const activePrices = attraction.ticketProducts.map((tp) => Number(tp.sellingPrice)).filter((p) => p > 0);
  const avgTicketPrice = activePrices.length
    ? activePrices.reduce((sum, p) => sum + p, 0) / activePrices.length
    : Number(attraction.minTicketPrice || 0);

  const publishedDaysAgo = attraction.publishedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(attraction.publishedAt).getTime()) / 86400000))
    : 365; // Chưa publish (draft cũ) -> coi như đã ổn định, tránh model coi là "quá mới"

  return {
    id: attraction.id,
    title: attraction.title,
    partnerId: attraction.partnerId,
    tier: attraction.tier,
    city: attraction.city,
    capacity: attraction.defaultCapacity,
    avgTicketPrice,
    rating: Number(attraction.averageRating || 0),
    numReviews: attraction.totalReviews || 0,
    publishedDaysAgo,
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
        avg_ticket_price: features.avgTicketPrice,
        rating: features.rating,
        num_reviews: features.numReviews,
        published_days_ago: features.publishedDaysAgo,
        history: history.map((h) => ({ date: h.date, revenue: h.revenue, bookings: h.bookings })),
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

// Phương án dự phòng khi ml-service không khả dụng: dự báo bằng trung bình
// trượt 28 ngày gần nhất (nhân nhẹ hệ số cuối tuần), khoảng tin cậy rộng
// hơn nhiều so với model thật để phản ánh đúng mức độ kém tin cậy hơn.
function buildFallbackForecast(history, forecastDays) {
  const recentWindow = history.slice(-28).map((h) => h.revenue);
  const mean = recentWindow.length ? recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length : 0;
  const lastDate = history.length ? new Date(`${history[history.length - 1].date}T00:00:00Z`) : new Date();

  const forecast = [];
  for (let step = 1; step <= forecastDays; step += 1) {
    const date = new Date(lastDate.getTime() + step * 86400000);
    const dow = date.getUTCDay();
    const weekendMult = dow === 0 || dow === 6 ? 1.3 : 1.0;
    const predictedRevenue = Math.max(0, Math.round(mean * weekendMult));
    forecast.push({
      date: date.toISOString().slice(0, 10),
      predicted_revenue: predictedRevenue,
      predicted_bookings: 0,
      confidence_lower: Math.round(predictedRevenue * 0.4),
      confidence_upper: Math.round(predictedRevenue * 1.8),
    });
  }
  return {
    forecast,
    model_version: FALLBACK_MODEL_VERSION,
    warning: 'ml-service không khả dụng - đang dùng dự báo dự phòng (trung bình trượt 28 ngày), độ chính xác thấp hơn model AI.',
  };
}

// Trả về forecast đã lưu nếu còn "mới" (trong TTL) và đủ số ngày yêu cầu,
// tránh gọi lại ml-service mỗi lần dashboard được mở.
async function getFreshStoredForecast(attractionId, forecastDays) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.revenueForecast.findMany({
    where: {
      attractionId,
      forecastDate: { gte: today },
      generatedAt: { gte: new Date(Date.now() - FORECAST_CACHE_TTL_MS) },
    },
    orderBy: { forecastDate: 'asc' },
  });

  if (rows.length < forecastDays) return null;
  return rows.slice(0, forecastDays);
}

async function persistForecast(attractionId, modelVersion, forecastPoints) {
  await prisma.$transaction(
    forecastPoints.map((point) =>
      prisma.revenueForecast.upsert({
        where: {
          attractionId_forecastDate_modelVersion: {
            attractionId,
            forecastDate: new Date(`${point.date}T00:00:00Z`),
            modelVersion,
          },
        },
        create: {
          attractionId,
          forecastDate: new Date(`${point.date}T00:00:00Z`),
          predictedRevenue: point.predicted_revenue,
          predictedBookings: point.predicted_bookings,
          confidenceLower: point.confidence_lower,
          confidenceUpper: point.confidence_upper,
          modelVersion,
        },
        update: {
          predictedRevenue: point.predicted_revenue,
          predictedBookings: point.predicted_bookings,
          confidenceLower: point.confidence_lower,
          confidenceUpper: point.confidence_upper,
          generatedAt: new Date(),
        },
      }),
    ),
  );
}

// Điểm vào chính: trả về forecast (từ cache nếu còn mới, không thì tính lại).
async function getForecastForAttraction(attractionId, { forecastDays = 7, forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await getFreshStoredForecast(attractionId, forecastDays);
    if (cached) {
      return {
        attractionId,
        modelVersion: cached[0].modelVersion,
        generatedAt: cached[0].generatedAt,
        fromCache: true,
        forecast: cached.map((row) => ({
          date: row.forecastDate.toISOString().slice(0, 10),
          predictedRevenue: Number(row.predictedRevenue),
          predictedBookings: row.predictedBookings,
          confidenceLower: row.confidenceLower !== null ? Number(row.confidenceLower) : null,
          confidenceUpper: row.confidenceUpper !== null ? Number(row.confidenceUpper) : null,
        })),
      };
    }
  }

  const features = await getAttractionForecastFeatures(attractionId);
  if (!features) {
    const error = new Error('Không tìm thấy điểm tham quan.');
    error.statusCode = 404;
    throw error;
  }

  const history = await getDailyRevenueHistory(attractionId);

  let modelVersion;
  let forecastPoints;
  let warning;

  try {
    const result = await callMlServiceForecast(features, history, forecastDays);
    modelVersion = result.model_version;
    forecastPoints = result.forecast;
    warning = result.warning || null;
  } catch (error) {
    console.error(`[forecastService] ml-service lỗi cho attraction ${attractionId}:`, error.message);
    const fallback = buildFallbackForecast(history, forecastDays);
    modelVersion = fallback.model_version;
    forecastPoints = fallback.forecast;
    warning = fallback.warning;
  }

  await persistForecast(attractionId, modelVersion, forecastPoints);

  return {
    attractionId,
    attractionTitle: features.title,
    modelVersion,
    generatedAt: new Date(),
    fromCache: false,
    warning,
    forecast: forecastPoints.map((p) => ({
      date: p.date,
      predictedRevenue: p.predicted_revenue,
      predictedBookings: p.predicted_bookings,
      confidenceLower: p.confidence_lower,
      confidenceUpper: p.confidence_upper,
    })),
  };
}

async function triggerRetrain({ numAttractions, numDays } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // train lâu hơn forecast, chờ tối đa 5 phút

  try {
    const response = await fetch(`${ML_SERVICE_URL}/train`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ML_SERVICE_API_KEY ? { 'x-ml-api-key': ML_SERVICE_API_KEY } : {}),
      },
      body: JSON.stringify({
        use_synthetic: true,
        num_synthetic_attractions: numAttractions,
        synthetic_days: numDays,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`ml-service /train trả về ${response.status}: ${body.slice(0, 200)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  getDailyRevenueHistory,
  getAttractionForecastFeatures,
  getForecastForAttraction,
  triggerRetrain,
};
