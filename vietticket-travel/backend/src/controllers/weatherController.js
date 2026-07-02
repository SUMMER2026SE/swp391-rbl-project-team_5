'use strict';

const weatherService = require('../services/weatherService');

// GET /api/weather?lat=&lng=
// Trả dự báo thời tiết 7 ngày cho một toạ độ. Public (không cần auth).
// Toạ độ do frontend truyền vào (đã có sẵn từ dữ liệu điểm tham quan).
async function getWeather(req, res) {
  try {
    const rawLat = req.query.lat;
    const rawLng = req.query.lng;

    // Chặn tham số rỗng/thiếu TRƯỚC khi ép kiểu: Number('') = 0 (hợp lệ) nên
    // ?lat=&lng= sẽ lọt qua range check và gọi API với toạ độ 0,0 (Vịnh Guinea).
    if (
      rawLat === undefined || rawLng === undefined
      || String(rawLat).trim() === '' || String(rawLng).trim() === ''
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Thiếu toạ độ (lat/lng).' },
      });
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);

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
    // Cho phép browser/CDN cache 30 phút (khớp TTL cache backend) -> giảm tải.
    res.set('Cache-Control', 'public, max-age=1800');
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
