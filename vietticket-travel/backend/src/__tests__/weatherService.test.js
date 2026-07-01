const {
  getForecast,
  describeWeatherCode,
  normalizeForecast,
  clearCache,
} = require('../services/weatherService');

function makeOpenMeteoResponse() {
  return {
    daily: {
      time: ['2026-07-01', '2026-07-02'],
      weather_code: [0, 61],
      temperature_2m_max: [33.4, 30.1],
      temperature_2m_min: [26.2, 25.8],
      precipitation_probability_max: [10, null],
    },
  };
}

describe('weatherService', () => {
  beforeEach(() => {
    clearCache();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('describeWeatherCode', () => {
    it('ánh xạ mã WMO đã biết sang nhãn tiếng Việt + icon', () => {
      expect(describeWeatherCode(0)).toEqual({ label: 'Trời quang', icon: 'sunny' });
      expect(describeWeatherCode(95)).toEqual({ label: 'Dông', icon: 'thunderstorm' });
    });

    it('trả về giá trị mặc định cho mã không xác định', () => {
      expect(describeWeatherCode(1234)).toEqual({ label: 'Không xác định', icon: 'cloud' });
    });
  });

  describe('normalizeForecast', () => {
    it('chuẩn hoá dữ liệu và xử lý xác suất mưa null', () => {
      const result = normalizeForecast(makeOpenMeteoResponse().daily);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: '2026-07-01',
        tempMax: 33,
        tempMin: 26,
        rainProb: 10,
        code: 0,
        label: 'Trời quang',
        icon: 'sunny',
      });
      // Ngày thứ 2: rainProb null phải được giữ nguyên là null (không NaN).
      expect(result[1].rainProb).toBeNull();
      expect(result[1].label).toBe('Mưa nhẹ');
    });

    it('trả về mảng rỗng khi thiếu daily', () => {
      expect(normalizeForecast(null)).toEqual([]);
      expect(normalizeForecast({})).toEqual([]);
    });
  });

  describe('getForecast', () => {
    it('gọi Open-Meteo và trả dự báo đã chuẩn hoá', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => makeOpenMeteoResponse(),
      });

      const forecast = await getForecast(10.86, 106.8);
      expect(forecast).toHaveLength(2);
      expect(forecast[0].label).toBe('Trời quang');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('dùng cache: gọi 2 lần cùng toạ độ chỉ fetch 1 lần', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => makeOpenMeteoResponse(),
      });

      await getForecast(10.86, 106.8);
      await getForecast(10.861, 106.804); // vẫn làm tròn về "10.86,106.80"
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('ném lỗi khi Open-Meteo trả về không ok', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      await expect(getForecast(10.86, 106.8)).rejects.toThrow('Open-Meteo lỗi (503)');
    });

    it('negative-cache: sau khi lỗi không gọi lại Open-Meteo trong thời gian ngắn', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      await expect(getForecast(21.03, 105.85)).rejects.toThrow('Open-Meteo lỗi (503)');
      // Lần 2 lấy từ negative-cache, không fetch lại.
      await expect(getForecast(21.03, 105.85)).rejects.toThrow('tạm thời không phản hồi');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
