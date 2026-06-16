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
// Các route này KHÔNG yêu cầu đăng nhập (public), vì chatbot tư
// vấn và gợi ý nên dùng được cả với khách chưa có tài khoản.
// Đã được bảo vệ bởi apiLimiter chung (xem app.js).
// Nếu cần giới hạn riêng (vì gọi LLM tốn phí), có thể thêm
// rate limiter riêng cho router này.
// ============================================================

const express = require('express');
const { chat, recommend, itinerary } = require('../controllers/aiAssistantController');

const router = express.Router();

router.post('/chat', chat);
router.post('/recommend', recommend);
router.post('/itinerary', itinerary);

module.exports = router;
