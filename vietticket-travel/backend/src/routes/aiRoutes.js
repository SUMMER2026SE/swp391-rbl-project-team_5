'use strict';

// ============================================================
// aiRoutes.js
// ------------------------------------------------------------
// Mount tại /api/ai (xem hướng dẫn tích hợp trong README_AI.md)
//
//   POST /api/ai/chat       - chatbot tư vấn dịch vụ & chính sách
//   POST /api/ai/recommend  - gợi ý địa điểm + combo vé theo budget/số người
//   POST /api/ai/itinerary  - tạo kế hoạch tham quan nhiều ngày
//
// Bảo vệ chi phí:
//   - /chat và /itinerary gọi LLM (tốn phí) nên có rate limiter
//     riêng (aiLlmLimiter) chặt hơn apiLimiter chung trong app.js.
//   - /itinerary thêm yêu cầu đăng nhập (frontend vốn đã bắt login)
//     để tránh khách vãng lai gọi thẳng API đốt quota LLM.
//   - /chat giữ public (theo thiết kế chatbot cho cả khách chưa có
//     tài khoản) nhưng vẫn nằm dưới aiLlmLimiter.
//   - /recommend là rule-based (không gọi LLM) nên giữ public.
// ============================================================

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const { chat, recommend, itinerary } = require('../controllers/aiAssistantController');

const router = express.Router();

// Giới hạn riêng cho các endpoint gọi LLM: 20 request / 5 phút / IP.
const aiLlmLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Bạn đã dùng trợ lý AI quá nhiều lần. Vui lòng thử lại sau ít phút.' },
});

router.post('/chat', aiLlmLimiter, chat);
router.post('/recommend', recommend);
router.post('/itinerary', aiLlmLimiter, protect, itinerary);

module.exports = router;
