const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { getWeather } = require('../controllers/weatherController');

const router = express.Router();

// Giới hạn riêng cho weather: 30 request / phút / IP.
// Endpoint public + gọi ra Open-Meteo nên cần chặn kẻ xấu spam toạ độ ngẫu nhiên
// (bypass cache) làm hết quota / bị ban IP phía nhà cung cấp.
const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Bạn tra cứu thời tiết quá nhiều. Vui lòng thử lại sau ít phút.' },
  },
});

// Public: dự báo thời tiết theo toạ độ ?lat=&lng=
router.get('/', weatherLimiter, getWeather);

module.exports = router;
