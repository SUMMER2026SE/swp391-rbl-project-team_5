'use strict';

// ============================================================
// aiRoutes.js
// ------------------------------------------------------------
// Mount tại /api/ai (xem hướng dẫn tích hợp trong README_AI.md)
//
//   POST   /api/ai/chat                      - chatbot tư vấn dịch vụ & chính sách
//   POST   /api/ai/recommend                 - gợi ý địa điểm + gói vé theo budget/số người
//   POST   /api/ai/itinerary                 - tạo kế hoạch tham quan nhiều ngày
//   POST   /api/ai/itinerary/save            - lưu lịch trình vào tài khoản (P1-C)
//   GET    /api/ai/itinerary/saved           - danh sách lịch trình đã lưu (P1-C)
//   GET    /api/ai/itinerary/saved/:planId   - chi tiết 1 lịch trình (P1-C)
//   DELETE /api/ai/itinerary/saved/:planId   - xóa lịch trình (P1-C)
//
// Bảo vệ chi phí:
//   - /chat và /itinerary gọi LLM (tốn phí) nên có rate limiter
//     riêng (aiLlmLimiter) chặt hơn apiLimiter chung trong app.js.
//   - /itinerary thêm yêu cầu đăng nhập (frontend vốn đã bắt login)
//     để tránh khách vãng lai gọi thẳng API đốt quota LLM.
//   - /chat giữ public (theo thiết kế chatbot cho cả khách chưa có
//     tài khoản) nhưng vẫn nằm dưới aiLlmLimiter.
//   - /recommend là rule-based (không gọi LLM) nên giữ public.
//   - Các endpoint lưu/đọc/xóa lịch trình yêu cầu đăng nhập và
//     áp aiRecommendLimiter (không gọi LLM, chỉ I/O DB).
// ============================================================

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuthMiddleware');
const {
  chat,
  recommend,
  itinerary,
  saveItinerary,
  getSavedItineraries,
  getSavedItineraryById,
  deleteItinerary,
} = require('../controllers/aiAssistantController');

const router = express.Router();

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const AI_LLM_WINDOW_MS = positiveInt(process.env.AI_LLM_WINDOW_MS, 5 * 60 * 1000);
const AI_CHAT_LIMIT = positiveInt(process.env.AI_CHAT_RATE_LIMIT, 12);
const AI_ITINERARY_LIMIT = positiveInt(process.env.AI_ITINERARY_RATE_LIMIT, 20);
const AI_RECOMMEND_LIMIT = positiveInt(process.env.AI_RECOMMEND_RATE_LIMIT, 60);

// Giới hạn riêng cho các endpoint gọi LLM. Chat public chặt hơn itinerary
// vì khách chưa đăng nhập cũng có thể gọi và tiêu tốn quota provider.
const aiLlmLimiter = rateLimit({
  windowMs: AI_LLM_WINDOW_MS,
  limit: AI_CHAT_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Bạn đã dùng trợ lý AI quá nhiều lần. Vui lòng thử lại sau ít phút.' },
});

const aiItineraryLimiter = rateLimit({
  windowMs: AI_LLM_WINDOW_MS,
  limit: AI_ITINERARY_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Bạn đã tạo lịch trình AI quá nhiều lần. Vui lòng thử lại sau ít phút.' },
});

const aiRecommendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: AI_RECOMMEND_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Bạn đang gửi yêu cầu gợi ý quá nhanh. Vui lòng thử lại sau ít phút.' },
});

// ---- Các endpoint cốt lõi ----
router.post('/chat', aiLlmLimiter, optionalAuth, chat);
router.post('/recommend', aiRecommendLimiter, optionalAuth, recommend);
router.post('/itinerary', aiItineraryLimiter, protect, itinerary);

// ---- P1-C: Quản lý lịch trình đã lưu (yêu cầu đăng nhập) ----
// Đặt route /save TRƯỚC /:planId để tránh Express hiểu "save" là param.
router.post('/itinerary/save', aiRecommendLimiter, protect, saveItinerary);
router.get('/itinerary/saved', aiRecommendLimiter, protect, getSavedItineraries);
router.get('/itinerary/saved/:planId', aiRecommendLimiter, protect, getSavedItineraryById);
router.delete('/itinerary/saved/:planId', aiRecommendLimiter, protect, deleteItinerary);

module.exports = router;
