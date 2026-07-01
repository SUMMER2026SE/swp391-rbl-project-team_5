'use strict';

// ============================================================
// weatherService.js
// ------------------------------------------------------------
// Lấy dự báo thời tiết theo toạ độ (lat/lng) từ Open-Meteo.
//
// - Open-Meteo miễn phí, không cần API key.
// - Cache in-memory theo toạ độ (làm tròn) trong 30 phút để
//   tránh gọi lặp khi nhiều khách xem cùng một điểm.
// - Trả về mảng dự báo theo ngày đã chuẩn hoá cho frontend.
// ============================================================

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 7;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút cho dữ liệu thành công
const FAILURE_CACHE_TTL_MS = 60 * 1000; // 1 phút cho lần lỗi (negative-cache)
const REQUEST_TIMEOUT_MS = 5000; // Hủy request nếu Open-Meteo không phản hồi sau 5s

// Cache đơn giản: key "lat,lng" (làm tròn 2 chữ số) -> { data, expiresAt }
const cache = new Map();

// Ánh xạ mã thời tiết WMO -> nhãn tiếng Việt + icon material-symbols.
// Tham chiếu: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
const WMO_MAP = {
  0: { label: 'Trời quang', icon: 'sunny' },
  1: { label: 'Ít mây', icon: 'sunny' },
  2: { label: 'Có mây rải rác', icon: 'partly_cloudy_day' },
  3: { label: 'Nhiều mây', icon: 'cloud' },
  45: { label: 'Sương mù', icon: 'foggy' },
  48: { label: 'Sương mù đóng băng', icon: 'foggy' },
  51: { label: 'Mưa phùn nhẹ', icon: 'rainy' },
  53: { label: 'Mưa phùn', icon: 'rainy' },
  55: { label: 'Mưa phùn dày', icon: 'rainy' },
  56: { label: 'Mưa phùn băng giá', icon: 'rainy' },
  57: { label: 'Mưa phùn băng giá', icon: 'rainy' },
  61: { label: 'Mưa nhẹ', icon: 'rainy' },
  63: { label: 'Mưa', icon: 'rainy' },
  65: { label: 'Mưa to', icon: 'rainy' },
  66: { label: 'Mưa băng giá', icon: 'rainy' },
  67: { label: 'Mưa băng giá', icon: 'rainy' },
  71: { label: 'Tuyết nhẹ', icon: 'weather_snowy' },
  73: { label: 'Tuyết', icon: 'weather_snowy' },
  75: { label: 'Tuyết dày', icon: 'weather_snowy' },
  77: { label: 'Hạt tuyết', icon: 'weather_snowy' },
  80: { label: 'Mưa rào nhẹ', icon: 'rainy' },
  81: { label: 'Mưa rào', icon: 'rainy' },
  82: { label: 'Mưa rào lớn', icon: 'rainy' },
  85: { label: 'Mưa tuyết nhẹ', icon: 'weather_snowy' },
  86: { label: 'Mưa tuyết', icon: 'weather_snowy' },
  95: { label: 'Dông', icon: 'thunderstorm' },
  96: { label: 'Dông kèm mưa đá', icon: 'thunderstorm' },
  99: { label: 'Dông kèm mưa đá', icon: 'thunderstorm' },
};

function describeWeatherCode(code) {
  return WMO_MAP[code] || { label: 'Không xác định', icon: 'cloud' };
}

// Làm tròn số về 1 chữ số thập phân, trả null nếu không phải số hữu hạn.
function roundOrNull(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function normalizeForecast(daily) {
  if (!daily || !Array.isArray(daily.time)) return [];

  return daily.time.map((date, index) => {
    const code = Number(daily.weather_code?.[index]);
    const { label, icon } = describeWeatherCode(code);
    const rainProb = daily.precipitation_probability_max?.[index];

    return {
      date,
      tempMax: roundOrNull(daily.temperature_2m_max?.[index], 0),
      tempMin: roundOrNull(daily.temperature_2m_min?.[index], 0),
      // Open-Meteo có thể trả null cho xác suất mưa của một số ngày.
      rainProb: rainProb == null ? null : Number(rainProb),
      code: Number.isFinite(code) ? code : null,
      label,
      icon,
    };
  });
}

/**
 * Lấy dự báo thời tiết 7 ngày cho một toạ độ.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Array>} mảng dự báo theo ngày đã chuẩn hoá
 */
async function getForecast(lat, lng) {
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw new Error('Open-Meteo tạm thời không phản hồi.');
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  });

  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Open-Meteo lỗi (${res.status})`);
    }

    const body = await res.json();
    const forecast = normalizeForecast(body.daily);

    cache.set(cacheKey, { data: forecast, expiresAt: Date.now() + CACHE_TTL_MS });
    return forecast;
  } catch (error) {
    // Negative-cache ngắn: tránh dồn request tới Open-Meteo khi nó lỗi/timeout.
    cache.set(cacheKey, { error: true, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
    throw error;
  }
}

// Dùng cho test để đảm bảo trạng thái sạch giữa các lần chạy.
function clearCache() {
  cache.clear();
}

module.exports = {
  getForecast,
  describeWeatherCode,
  normalizeForecast,
  clearCache,
};
