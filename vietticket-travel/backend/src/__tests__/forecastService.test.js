'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');

const originalFetch = global.fetch;

function activeAttraction(overrides = {}) {
  return {
    id: 'attraction-1',
    title: 'Bà Nà Hills',
    city: 'Đà Nẵng',
    defaultCapacity: 300,
    averageRating: 4.6,
    totalReviews: 500,
    publishedAt: new Date('2024-01-01T00:00:00.000Z'),
    minTicketPrice: 350000,
    partnerId: 'partner-1',
    status: 'APPROVED',
    publicationStatus: 'ACTIVE',
    operationalStatus: 'ACTIVE',
    archivedAt: null,
    ticketProducts: [{ sellingPrice: 450000 }, { sellingPrice: 350000 }],
    ...overrides,
  };
}

function completedBooking(date, amount = 400000, quantity = 1, refunds = []) {
  return {
    snapshotVisitDate: new Date(`${date}T00:00:00.000Z`),
    payments: [{ amount }],
    refundTransactions: refunds,
    reservation: {
      date: new Date(`${date}T00:00:00.000Z`),
      quantity,
    },
  };
}

describe('forecastService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.revenueForecast.findMany.mockResolvedValue([]);
    mockPrisma.revenueForecast.upsert.mockResolvedValue({});
    mockPrisma.revenueForecast.update.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('tổng hợp doanh thu thuần theo ngày tham quan, trừ hoàn tiền và zero-fill', async () => {
    const { getDailyRevenueHistory } = require('../services/forecastService');
    const now = new Date('2026-07-20T03:00:00.000Z');
    mockPrisma.booking.findMany.mockResolvedValue([
      completedBooking('2026-07-19', 600000, 2, [
        {
          amount: 100000,
          refundRequest: { type: 'CUSTOMER_CANCELLATION' },
        },
      ]),
      completedBooking('2026-07-19', 200000, 1, [
        {
          amount: 50000,
          refundRequest: { type: 'DUPLICATE_PAYMENT' },
        },
      ]),
    ]);

    const history = await getDailyRevenueHistory('attraction-1', 10, now);

    expect(history).toHaveLength(10);
    expect(history.at(-1)).toEqual({
      date: '2026-07-19',
      revenue: 700000,
      bookings: 2,
      tickets: 3,
    });
    expect(history.slice(0, -1).every((point) => point.revenue === 0)).toBe(true);

    const query = mockPrisma.booking.findMany.mock.calls[0][0];
    expect(query.where.status.in).toEqual(['COMPLETED', 'NO_SHOW']);
    expect(query.where.payments.some).toEqual({ status: 'SUCCESS', isDuplicate: false });
    expect(query.where.OR[0].snapshotAttractionId).toBe('attraction-1');
    expect(query.select.refundTransactions.where.status).toBe('SUCCESS');
  });

  test('suy ra phân khúc giá từ giá vé thay vì field chủ quan trong DB', () => {
    const { derivePriceTier } = require('../services/forecastService');
    expect(derivePriceTier(100000)).toBe('BUDGET');
    expect(derivePriceTier(250000)).toBe('STANDARD');
    expect(derivePriceTier(500000)).toBe('PREMIUM');
    expect(derivePriceTier(900000)).toBe('LUXURY');
  });

  test('chỉ cho phép model demo khi local bật cờ và luôn giữ nhãn riêng', () => {
    const { resolveTrainingSourceMode } = require('../services/forecastService');

    expect(resolveTrainingSourceMode('real_booking_history', false)).toEqual({
      method: 'AI_ENSEMBLE',
      warning: null,
    });
    expect(resolveTrainingSourceMode('demo_booking_history', false)).toBeNull();
    expect(resolveTrainingSourceMode('synthetic_bootstrap', true)).toBeNull();
    expect(resolveTrainingSourceMode('demo_booking_history', true)).toEqual(
      expect.objectContaining({
        method: 'AI_DEMO_ENSEMBLE',
        warning: expect.stringMatching(/booking mô phỏng/i),
      }),
    );
  });

  test('không gọi AI khi dữ liệu thực chưa đủ và công khai phương pháp baseline', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(activeAttraction());
    mockPrisma.booking.findMany.mockResolvedValue([]);
    global.fetch = jest.fn();

    const { getForecastForAttraction } = require('../services/forecastService');
    const result = await getForecastForAttraction('attraction-1', {
      forecastDays: 3,
      forceRefresh: true,
    });

    expect(result.method).toBe('HISTORICAL_BASELINE');
    expect(result.usedFallback).toBe(true);
    expect(result.warning).toMatch(/chưa đủ dữ liệu thực/i);
    expect(result.dataQuality.sufficientForAi).toBe(false);
    expect(result.forecast).toHaveLength(3);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('gọi ml-service khi đủ dữ liệu và chặn dự báo vượt sức chứa', async () => {
    const { vietnamDateKey } = require('../services/forecastService');
    const today = vietnamDateKey();
    const bookings = [];
    for (let offset = 1; offset <= 14; offset += 1) {
      const date = new Date(`${today}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - offset);
      const key = date.toISOString().slice(0, 10);
      bookings.push(completedBooking(key, 400000, 1));
      bookings.push(completedBooking(key, 400000, 1));
      if (offset <= 2) bookings.push(completedBooking(key, 400000, 1));
    }

    mockPrisma.attraction.findUnique.mockResolvedValue(activeAttraction({
      defaultCapacity: 2,
    }));
    mockPrisma.booking.findMany.mockResolvedValue(bookings);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model_version: 'rf_xgb_real_v2',
        training_source: 'real_booking_history',
        forecast: [{
          date: today,
          predicted_revenue: 5000000,
          predicted_tickets: 99,
          confidence_lower: 1000000,
          confidence_upper: 9000000,
        }],
      }),
    });

    const { getForecastForAttraction } = require('../services/forecastService');
    const result = await getForecastForAttraction('attraction-1', {
      forecastDays: 1,
      forceRefresh: true,
    });

    expect(result.method).toBe('AI_ENSEMBLE');
    expect(result.usedFallback).toBe(false);
    expect(result.forecast[0].predictedTickets).toBe(2);
    expect(result.forecast[0].predictedRevenue).toBeLessThanOrEqual(800000);
    expect(mockPrisma.revenueForecast.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attractionId_forecastDate: {
            attractionId: 'attraction-1',
            forecastDate: new Date(`${today}T00:00:00.000Z`),
          },
        },
      }),
    );
  });

  test('dùng cache liên tục theo ngày và không gọi lại DB attraction/AI', async () => {
    const { vietnamDateKey } = require('../services/forecastService');
    const today = vietnamDateKey();
    mockPrisma.revenueForecast.findMany.mockResolvedValue([{
      forecastDate: new Date(`${today}T00:00:00.000Z`),
      predictedRevenue: 2000000,
      predictedTickets: 10,
      confidenceLower: 1500000,
      confidenceUpper: 2500000,
      modelVersion: 'rf_xgb_real_v2',
      trainingSource: 'real_booking_history',
      usedFallback: false,
      historyDays: 180,
      observedDays: 60,
      sampleBookings: 120,
      generatedAt: new Date(),
    }]);
    global.fetch = jest.fn();

    const { getForecastForAttraction } = require('../services/forecastService');
    const result = await getForecastForAttraction('attraction-1', { forecastDays: 1 });

    expect(result.fromCache).toBe(true);
    expect(result.forecast[0].predictedRevenue).toBe(2000000);
    expect(result.forecast[0].predictedTickets).toBe(10);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPrisma.attraction.findUnique).not.toHaveBeenCalled();
  });

  test('từ chối dự báo cho điểm chưa mở bán', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(activeAttraction({
      publicationStatus: 'PAUSED',
    }));

    const { getForecastForAttraction } = require('../services/forecastService');
    await expect(
      getForecastForAttraction('attraction-1', {
        forecastDays: 1,
        forceRefresh: true,
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  test('ném lỗi 404 khi attraction không tồn tại', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);

    const { getForecastForAttraction } = require('../services/forecastService');
    await expect(
      getForecastForAttraction('missing-id', {
        forecastDays: 1,
        forceRefresh: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
