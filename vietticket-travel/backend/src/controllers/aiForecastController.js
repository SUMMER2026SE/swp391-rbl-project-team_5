'use strict';

const prisma = require('../config/prisma');
const forecastService = require('../services/forecastService');
const { hasRole } = require('../utils/userRoles');

const OVERVIEW_CONCURRENCY = 4;

function parseForecastDays(raw) {
  if (raw === undefined || raw === null || raw === '') return 7;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    const error = new Error('Số ngày dự báo phải là số nguyên từ 1 đến 30.');
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function parseOptionalFilter(raw) {
  const value = String(raw || '').trim();
  return value || undefined;
}

async function assertCanViewAttraction(req, attractionId) {
  if (hasRole(req.user, 'ADMIN')) return;

  let { partner } = req;
  if (!partner) {
    partner = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
      select: { id: true, status: true },
    });
  }

  const attraction = await prisma.attraction.findUnique({
    where: { id: attractionId },
    select: { partnerId: true, archivedAt: true },
  });

  // Không tiết lộ attraction của đối tác khác qua khác biệt 403/404.
  if (!attraction || attraction.archivedAt || !partner || attraction.partnerId !== partner.id) {
    const error = new Error('Không tìm thấy điểm tham quan.');
    error.statusCode = 404;
    throw error;
  }
  if (partner.status !== 'APPROVED') {
    const error = new Error('Hồ sơ đối tác chưa được phê duyệt.');
    error.statusCode = 403;
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

function buildForecastTimeline(results) {
  const byDate = new Map();
  for (const result of results) {
    if (result.error) continue;
    for (const point of result.forecast || []) {
      const current = byDate.get(point.date) || {
        date: point.date,
        predictedRevenue: 0,
        predictedTickets: 0,
        confidenceLower: 0,
        confidenceUpper: 0,
      };
      current.predictedRevenue += Number(point.predictedRevenue || 0);
      current.predictedTickets += Number(point.predictedTickets || 0);
      current.confidenceLower += Number(
        point.confidenceLower ?? point.predictedRevenue ?? 0,
      );
      current.confidenceUpper += Number(
        point.confidenceUpper ?? point.predictedRevenue ?? 0,
      );
      byDate.set(point.date, current);
    }
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function summarizeOverview(results, forecastDays) {
  const successful = results.filter((result) => !result.error);
  const timeline = buildForecastTimeline(successful);
  const totalPredictedRevenue = timeline.reduce(
    (sum, point) => sum + point.predictedRevenue,
    0,
  );
  return {
    forecastDays,
    totalAttractions: results.length,
    successfulAttractions: successful.length,
    failedAttractions: results.length - successful.length,
    totalPredictedRevenue,
    timeline,
    methodSummary: {
      ai: successful.filter((result) => result.method === 'AI_ENSEMBLE').length,
      demoAi: successful.filter((result) => result.method === 'AI_DEMO_ENSEMBLE').length,
      baseline: successful.filter((result) => result.usedFallback).length,
    },
    dataBasis: forecastService.FORECAST_DATA_BASIS,
  };
}

async function forecastAttractions(attractions, forecastDays) {
  return mapWithConcurrency(
    attractions,
    OVERVIEW_CONCURRENCY,
    async (attraction) => {
      try {
        const result = await forecastService.getForecastForAttraction(
          attraction.id,
          { forecastDays },
        );
        const totalPredictedRevenue = result.forecast.reduce(
          (sum, point) => sum + Number(point.predictedRevenue || 0),
          0,
        );
        return {
          attractionId: attraction.id,
          attractionTitle: attraction.title,
          city: attraction.city,
          partnerId: attraction.partnerId,
          modelVersion: result.modelVersion,
          trainingSource: result.trainingSource,
          method: result.method,
          usedFallback: result.usedFallback,
          warning: result.warning || null,
          dataQuality: result.dataQuality,
          totalPredictedRevenue,
          forecast: result.forecast,
        };
      } catch (error) {
        console.error(
          `[aiForecastController] Lỗi dự báo attraction ${attraction.id}:`,
          error.message,
        );
        return {
          attractionId: attraction.id,
          attractionTitle: attraction.title,
          city: attraction.city,
          partnerId: attraction.partnerId,
          error: 'Không tạo được dự báo cho điểm tham quan này.',
        };
      }
    },
  );
}

// GET /api/forecast/attractions/:attractionId?days=7&refresh=true
async function getAttractionForecast(req, res, next) {
  try {
    const { attractionId } = req.params;
    await assertCanViewAttraction(req, attractionId);

    const forecastDays = parseForecastDays(req.query.days);
    const requestedRefresh = req.query.refresh === 'true';
    if (requestedRefresh && !hasRole(req.user, 'ADMIN')) {
      const error = new Error('Chỉ quản trị viên được phép bỏ qua bộ nhớ đệm dự báo.');
      error.statusCode = 403;
      throw error;
    }

    const result = await forecastService.getForecastForAttraction(attractionId, {
      forecastDays,
      forceRefresh: requestedRefresh,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

// GET /api/forecast/partner/overview?days=7
async function getPartnerForecastOverview(req, res, next) {
  try {
    const forecastDays = parseForecastDays(req.query.days);
    const attractions = await prisma.attraction.findMany({
      where: {
        partnerId: req.partner.id,
        status: 'APPROVED',
        publicationStatus: 'ACTIVE',
        operationalStatus: 'ACTIVE',
        archivedAt: null,
        ticketProducts: { some: { status: 'ACTIVE', archivedAt: null } },
      },
      select: { id: true, title: true, city: true, partnerId: true },
      orderBy: { title: 'asc' },
    });

    const results = await forecastAttractions(attractions, forecastDays);
    return res.json({
      success: true,
      data: {
        ...summarizeOverview(results, forecastDays),
        attractions: results,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/forecast/admin/overview?days=7&city=&partnerId=
async function getAdminForecastOverview(req, res, next) {
  try {
    const forecastDays = parseForecastDays(req.query.days);
    const city = parseOptionalFilter(req.query.city);
    const partnerId = parseOptionalFilter(req.query.partnerId);

    const attractions = await prisma.attraction.findMany({
      where: {
        status: 'APPROVED',
        publicationStatus: 'ACTIVE',
        operationalStatus: 'ACTIVE',
        archivedAt: null,
        partner: { status: 'APPROVED' },
        ticketProducts: { some: { status: 'ACTIVE', archivedAt: null } },
        ...(city ? { city } : {}),
        ...(partnerId ? { partnerId } : {}),
      },
      select: { id: true, title: true, city: true, partnerId: true },
      orderBy: { title: 'asc' },
      take: 200,
    });

    const results = await forecastAttractions(attractions, forecastDays);
    const topAttractions = [...results]
      .filter((result) => !result.error)
      .sort((left, right) => (
        right.totalPredictedRevenue - left.totalPredictedRevenue
        || left.attractionTitle.localeCompare(right.attractionTitle, 'vi')
      ))
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        ...summarizeOverview(results, forecastDays),
        topAttractions,
        attractions: results,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  buildForecastTimeline,
  getAdminForecastOverview,
  getAttractionForecast,
  getPartnerForecastOverview,
  mapWithConcurrency,
  parseForecastDays,
  summarizeOverview,
};
