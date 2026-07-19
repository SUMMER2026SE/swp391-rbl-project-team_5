'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');

const originalFetch = global.fetch;

describe('forecastService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  describe('getDailyRevenueHistory', () => {
    it('zero-fills ngày không có booking và cộng dồn doanh thu theo ngày (giờ VN)', async () => {
      const { getDailyRevenueHistory } = require('../services/forecastService');

      const today = new Date();
      mockPrisma.booking.findMany.mockResolvedValue([
        {
          createdAt: today,
          payments: [{ amount: 500000 }, { amount: 100000 }],
        },
      ]);

      const history = await getDailyRevenueHistory('attraction-1', 10);

      expect(history).toHaveLength(10);
      // Ngày cuối cùng (hôm nay) phải cộng dồn đúng 2 payment.
      const lastDay = history[history.length - 1];
      expect(lastDay.revenue).toBe(600000);
      expect(lastDay.bookings).toBe(1);
      // Các ngày khác phải zero-fill, không NaN/undefined.
      const otherDays = history.slice(0, -1);
      otherDays.forEach((day) => {
        expect(day.revenue).toBe(0);
        expect(day.bookings).toBe(0);
      });
      // Kết quả phải sắp xếp tăng dần theo ngày.
      const dates = history.map((h) => h.date);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sorted);
    });

    it('chỉ tính booking đã lọc theo where clause (không tự lọc lại ở service)', async () => {
      const { getDailyRevenueHistory } = require('../services/forecastService');
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await getDailyRevenueHistory('attraction-1', 5);

      const callArgs = mockPrisma.booking.findMany.mock.calls[0][0];
      expect(callArgs.where.status.in).toEqual(expect.arrayContaining(['CONFIRMED', 'COMPLETED', 'NO_SHOW']));
      expect(callArgs.where.payments.some.status).toBe('SUCCESS');
      expect(callArgs.where.reservation.ticketProduct.attractionId).toBe('attraction-1');
    });
  });

  describe('getForecastForAttraction', () => {
    function mockAttractionFeatures() {
      mockPrisma.attraction.findUnique.mockResolvedValue({
        id: 'attraction-1',
        title: 'Bà Nà Hills',
        city: 'Đà Nẵng',
        tier: 'PREMIUM',
        defaultCapacity: 300,
        averageRating: 4.6,
        totalReviews: 500,
        publishedAt: new Date('2024-01-01'),
        minTicketPrice: 400000,
        partnerId: 'partner-1',
        ticketProducts: [{ sellingPrice: 450000 }, { sellingPrice: 350000 }],
      });
    }

    it('trả về dự báo từ ml-service khi gọi thành công, và lưu lại (upsert) kết quả', async () => {
      mockAttractionFeatures();
      mockPrisma.booking.findMany.mockResolvedValue([]);
      mockPrisma.revenueForecast.findMany.mockResolvedValue([]); // chưa có cache
      mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));
      mockPrisma.revenueForecast.upsert.mockResolvedValue({});

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model_version: 'rf_xgb_ensemble_v1',
          forecast: [
            { date: '2026-07-12', predicted_revenue: 1000000, predicted_bookings: 5, confidence_lower: 700000, confidence_upper: 1400000 },
          ],
          warning: null,
        }),
      });

      const { getForecastForAttraction } = require('../services/forecastService');
      const result = await getForecastForAttraction('attraction-1', { forecastDays: 1 });

      expect(result.modelVersion).toBe('rf_xgb_ensemble_v1');
      expect(result.forecast).toHaveLength(1);
      expect(result.forecast[0].predictedRevenue).toBe(1000000);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.revenueForecast.upsert).toHaveBeenCalled();
    });

    it('dùng phương án dự phòng (moving average) khi ml-service lỗi/không phản hồi', async () => {
      mockAttractionFeatures();
      mockPrisma.booking.findMany.mockResolvedValue([]);
      mockPrisma.revenueForecast.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));
      mockPrisma.revenueForecast.upsert.mockResolvedValue({});

      global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

      const { getForecastForAttraction } = require('../services/forecastService');
      const result = await getForecastForAttraction('attraction-1', { forecastDays: 3 });

      expect(result.modelVersion).toBe('moving_average_fallback_v1');
      expect(result.warning).toMatch(/dự phòng/i);
      expect(result.forecast).toHaveLength(3);
    });

    it('dùng lại forecast đã lưu (cache) nếu còn mới, không gọi ml-service', async () => {
      const cachedRow = {
        forecastDate: new Date(),
        predictedRevenue: 2000000,
        predictedBookings: 10,
        confidenceLower: 1500000,
        confidenceUpper: 2500000,
        modelVersion: 'rf_xgb_ensemble_v1',
        generatedAt: new Date(),
      };
      mockPrisma.revenueForecast.findMany.mockResolvedValue([cachedRow]);
      global.fetch = jest.fn();

      const { getForecastForAttraction } = require('../services/forecastService');
      const result = await getForecastForAttraction('attraction-1', { forecastDays: 1 });

      expect(result.fromCache).toBe(true);
      expect(result.forecast[0].predictedRevenue).toBe(2000000);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockPrisma.attraction.findUnique).not.toHaveBeenCalled();
    });

    it('ném lỗi 404 khi attraction không tồn tại', async () => {
      mockPrisma.revenueForecast.findMany.mockResolvedValue([]);
      mockPrisma.attraction.findUnique.mockResolvedValue(null);

      const { getForecastForAttraction } = require('../services/forecastService');

      await expect(getForecastForAttraction('missing-id', { forecastDays: 1 })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
