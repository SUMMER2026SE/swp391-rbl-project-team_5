'use strict';

// ============================================================
// forecastRoutes.js
// ------------------------------------------------------------
// Mount tại /api/forecast
//
//   GET  /api/forecast/attractions/:attractionId  - dự báo 1 attraction
//                                                    (ADMIN: mọi attraction;
//                                                     PARTNER: chỉ của mình)
//   GET  /api/forecast/partner/overview           - tổng quan tất cả
//                                                    attraction của đối tác
//   GET  /api/forecast/admin/overview             - tổng quan toàn nền tảng
//   POST /api/forecast/admin/retrain              - train lại model ml-service
//
// STAFF không có quyền truy cập bất kỳ endpoint nào ở đây (theo thiết kế:
// dự báo doanh thu là dữ liệu nhạy cảm, chỉ chủ đối tác/ADMIN mới xem).
// ============================================================

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requirePartner, requireApprovedPartner } = require('../middleware/partnerMiddleware');
const {
  getAttractionForecast,
  getPartnerForecastOverview,
  getAdminForecastOverview,
  triggerRetrain,
} = require('../controllers/aiForecastController');

const router = express.Router();

// ml-service phải chạy inference (RF+XGB) mỗi lần cache hết hạn - giới hạn
// nhẹ để tránh một tài khoản gọi refresh=true liên tục làm quá tải ml-service.
const forecastLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Bạn đang tải dự báo doanh thu quá nhanh. Vui lòng thử lại sau ít phút.' },
  },
});

const retrainLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Bạn vừa train lại model gần đây. Vui lòng thử lại sau.' },
  },
});

router.use(protect, restrictTo('ADMIN', 'PARTNER'));

router.get('/attractions/:attractionId', forecastLimiter, getAttractionForecast);

router.get(
  '/partner/overview',
  forecastLimiter,
  restrictTo('PARTNER'),
  requirePartner,
  requireApprovedPartner,
  getPartnerForecastOverview,
);

router.get('/admin/overview', forecastLimiter, restrictTo('ADMIN'), getAdminForecastOverview);
router.post('/admin/retrain', retrainLimiter, restrictTo('ADMIN'), triggerRetrain);

module.exports = router;
