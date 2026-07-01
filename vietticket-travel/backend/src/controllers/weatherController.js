'use strict';

const weatherService = require('../services/weatherService');

// GET /api/weather?lat=&lng=
// Trả dự báo thời tiết 7 ngày cho một toạ độ. Public (không cần auth).
// Toạ độ do frontend truyền vào (đã có sẵn từ dữ liệu điểm tham quan).
async function getWeather(req, res) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (
      !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || lat < -90 || lat > 90
      || lng < -180 || lng > 180
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Toạ độ không hợp lệ.' },
      });
    }

    const forecast = await weatherService.getForecast(lat, lng);
    return res.status(200).json({ success: true, data: { forecast } });
  } catch (error) {
    // Không để lỗi nhà cung cấp thời tiết làm hỏng trải nghiệm: trả 502 gọn.
    console.error('[weatherController] Lỗi lấy dự báo:', error.message);
    return res.status(502).json({
      success: false,
      error: { code: 'WEATHER_UNAVAILABLE', message: 'Không lấy được dự báo thời tiết.' },
    });
  }
}

module.exports = { getWeather };
