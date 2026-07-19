'use strict';

// ============================================================
// aiForecastController.js
// ------------------------------------------------------------
// Quyền truy cập (theo thiết kế đã thống nhất):
//   - ADMIN   : xem dự báo của MỌI attraction trên nền tảng
//   - PARTNER : chỉ xem dự báo của attraction thuộc chính mình
//   - STAFF   : KHÔNG có quyền (loại khỏi router bằng restrictTo)
// ============================================================

const prisma = require('../config/prisma');
const forecastService = require('../services/forecastService');

function parseForecastDays(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) return 7;
  return parsed;
}

// Đảm bảo PARTNER chỉ được xem attraction của chính mình; ADMIN xem tất cả.
async function assertCanViewAttraction(req, attractionId) {
  if (req.user.role === 'ADMIN') return;

  // /attractions/:id được dùng chung cho cả ADMIN và PARTNER nên requirePartner
  // (vốn chỉ gắn ở nhánh /partner/*) có thể chưa chạy - tự nạp partner profile
  // nếu req.partner chưa có sẵn.
  let { partner } = req;
  if (!partner) {
    partner = await prisma.partnerProfile.findUnique({ where: { userId: req.user.id } });
  }

  const attraction = await prisma.attraction.findUnique({
    where: { id: attractionId },
    select: { partnerId: true },
  });

  if (!attraction) {
    const error = new Error('Không tìm thấy điểm tham quan.');
    error.statusCode = 404;
    throw error;
  }

  if (!partner || attraction.partnerId !== partner.id) {
    const error = new Error('Bạn không có quyền xem dự báo doanh thu của điểm tham quan này.');
    error.statusCode = 403;
    throw error;
  }
}

// GET /api/forecast/attractions/:attractionId?days=7&refresh=true
async function getAttractionForecast(req, res, next) {
  try {
    const { attractionId } = req.params;
    await assertCanViewAttraction(req, attractionId);

    const forecastDays = parseForecastDays(req.query.days);
    const forceRefresh = req.query.refresh === 'true';

    const result = await forecastService.getForecastForAttraction(attractionId, { forecastDays, forceRefresh });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

// GET /api/forecast/partner/overview?days=7
// Tổng hợp dự báo cho TẤT CẢ attraction đã publish của đối tác hiện tại.
async function getPartnerForecastOverview(req, res, next) {
  try {
    const forecastDays = parseForecastDays(req.query.days);

    const attractions = await prisma.attraction.findMany({
      where: { partnerId: req.partner.id, archivedAt: null },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });

    const results = await Promise.all(
      attractions.map(async (attraction) => {
        try {
          const forecast = await forecastService.getForecastForAttraction(attraction.id, { forecastDays });
          const totalPredicted = forecast.forecast.reduce((sum, p) => sum + p.predictedRevenue, 0);
          return {
            attractionId: attraction.id,
            attractionTitle: attraction.title,
            modelVersion: forecast.modelVersion,
            warning: forecast.warning || null,
            totalPredictedRevenue: totalPredicted,
            forecast: forecast.forecast,
          };
        } catch (error) {
          console.error(`[aiForecastController] Lỗi dự báo attraction ${attraction.id}:`, error.message);
          return {
            attractionId: attraction.id,
            attractionTitle: attraction.title,
            error: 'Không tạo được dự báo cho điểm tham quan này.',
          };
        }
      }),
    );

    const totalPlatformPredicted = results.reduce((sum, r) => sum + (r.totalPredictedRevenue || 0), 0);

    return res.json({
      success: true,
      data: {
        forecastDays,
        totalPredictedRevenue: totalPlatformPredicted,
        attractions: results,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/forecast/admin/overview?days=7&city=&partnerId=
// Toàn cảnh dự báo doanh thu nền tảng, có thể lọc theo thành phố/đối tác.
async function getAdminForecastOverview(req, res, next) {
  try {
    const forecastDays = parseForecastDays(req.query.days);
    const city = req.query.city ? String(req.query.city).trim() : undefined;
    const partnerId = req.query.partnerId ? String(req.query.partnerId).trim() : undefined;

    const attractions = await prisma.attraction.findMany({
      where: {
        archivedAt: null,
        publicationStatus: 'PUBLISHED',
        ...(city ? { city } : {}),
        ...(partnerId ? { partnerId } : {}),
      },
      select: { id: true, title: true, city: true, partnerId: true },
      orderBy: { title: 'asc' },
      take: 200, // Chặn quá tải khi nền tảng có rất nhiều attraction; đủ cho dashboard tổng quan
    });

    const results = await Promise.all(
      attractions.map(async (attraction) => {
        try {
          const forecast = await forecastService.getForecastForAttraction(attraction.id, { forecastDays });
          const totalPredicted = forecast.forecast.reduce((sum, p) => sum + p.predictedRevenue, 0);
          return {
            attractionId: attraction.id,
            attractionTitle: attraction.title,
            city: attraction.city,
            partnerId: attraction.partnerId,
            modelVersion: forecast.modelVersion,
            totalPredictedRevenue: totalPredicted,
          };
        } catch (error) {
          console.error(`[aiForecastController] Lỗi dự báo attraction ${attraction.id}:`, error.message);
          return {
            attractionId: attraction.id,
            attractionTitle: attraction.title,
            city: attraction.city,
            partnerId: attraction.partnerId,
            error: 'Không tạo được dự báo.',
          };
        }
      }),
    );

    const totalPlatformPredicted = results.reduce((sum, r) => sum + (r.totalPredictedRevenue || 0), 0);
    const topAttractions = [...results]
      .filter((r) => !r.error)
      .sort((a, b) => b.totalPredictedRevenue - a.totalPredictedRevenue)
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        forecastDays,
        totalAttractions: results.length,
        totalPredictedRevenue: totalPlatformPredicted,
        topAttractions,
        attractions: results,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// POST /api/forecast/admin/retrain
// Kích hoạt train lại model trên ml-service (chỉ ADMIN). Có thể mất vài
// phút với dữ liệu synthetic lớn - FE nên hiển thị trạng thái loading rõ ràng.
async function triggerRetrain(req, res, next) {
  try {
    const numAttractions = Number(req.body?.numAttractions) || undefined;
    const numDays = Number(req.body?.numDays) || undefined;

    const result = await forecastService.triggerRetrain({ numAttractions, numDays });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[aiForecastController] Lỗi kích hoạt retrain:', error.message);
    return res.status(502).json({
      success: false,
      error: { code: 'ML_SERVICE_UNAVAILABLE', message: 'Không kết nối được với ml-service để train lại model.' },
    });
  }
}

module.exports = {
  getAttractionForecast,
  getPartnerForecastOverview,
  getAdminForecastOverview,
  triggerRetrain,
};
