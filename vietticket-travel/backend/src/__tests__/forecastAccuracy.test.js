jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  getForecastAccuracy,
  getModelQuality,
  resetModelQualityCache,
} = require('../services/forecastService');

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDays(dateKey, days) {
  return new Date(dateOnly(dateKey).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function forecastRow(dateKey, predicted, actual) {
  return {
    forecastDate: dateOnly(dateKey),
    predictedRevenue: predicted,
    actualRevenue: actual,
    modelVersion: 'demo-booking-v2',
    usedFallback: false,
  };
}

describe('getForecastAccuracy', () => {
  const today = new Date('2026-06-20T03:00:00.000Z');
  const todayKey = '2026-06-20';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('so dự báo đã lưu với doanh thu thực và tính MAPE/WAPE', async () => {
    mockPrisma.revenueForecast.findMany.mockResolvedValue([
      forecastRow(addDays(todayKey, -3), 11000000, 10000000), // lệch +10%
      forecastRow(addDays(todayKey, -2), 9000000, 10000000), // lệch -10%
      forecastRow(addDays(todayKey, -1), 20000000, 20000000), // đúng
    ]);

    const result = await getForecastAccuracy('attr-1', { days: 30, now: today });

    expect(result.comparedDays).toBe(3);
    // (10 + 10 + 0) / 3
    expect(result.mape).toBeCloseTo(6.67, 1);
    // tổng lệch 2 triệu / tổng thực 40 triệu
    expect(result.wape).toBeCloseTo(5, 1);
  });

  test('ngày chưa có doanh thu thực bị loại chứ không tính là lệch 100%', async () => {
    mockPrisma.revenueForecast.findMany.mockResolvedValue([
      forecastRow(addDays(todayKey, -2), 10000000, 10000000),
      forecastRow(addDays(todayKey, -1), 8000000, 0), // ngày đóng cửa
    ]);

    const result = await getForecastAccuracy('attr-1', { days: 30, now: today });

    expect(result.comparedDays).toBe(1);
    expect(result.skippedDays).toBe(1);
    expect(result.mape).toBe(0);
  });

  test('trưng ra độ lệch có dấu để biết model lạc quan hay thận trọng', async () => {
    mockPrisma.revenueForecast.findMany.mockResolvedValue([
      forecastRow(addDays(todayKey, -2), 12000000, 10000000),
      forecastRow(addDays(todayKey, -1), 13000000, 10000000),
    ]);

    const result = await getForecastAccuracy('attr-1', { days: 30, now: today });
    expect(result.meanBias).toBe(2500000); // dương = dự báo cao hơn thực tế
  });

  test('dưới 7 ngày đối chiếu thì đánh dấu chưa đủ dữ liệu để kết luận', async () => {
    mockPrisma.revenueForecast.findMany.mockResolvedValue([
      forecastRow(addDays(todayKey, -1), 10000000, 10000000),
    ]);

    const result = await getForecastAccuracy('attr-1', { days: 30, now: today });
    expect(result.sufficient).toBe(false);
  });

  test('không có dữ liệu đối chiếu thì trả null thay vì 0%', async () => {
    mockPrisma.revenueForecast.findMany.mockResolvedValue([]);

    const result = await getForecastAccuracy('attr-1', { days: 30, now: today });
    expect(result.comparedDays).toBe(0);
    expect(result.mape).toBeNull();
    expect(result.wape).toBeNull();
    expect(result.meanBias).toBeNull();
  });

  test('chỉ lấy các ngày đã trôi qua trong cửa sổ được yêu cầu', async () => {
    mockPrisma.revenueForecast.findMany.mockResolvedValue([]);
    await getForecastAccuracy('attr-1', { days: 14, now: today });

    const where = mockPrisma.revenueForecast.findMany.mock.calls[0][0].where;
    expect(where.actualRevenue).toEqual({ not: null });
    expect(where.forecastDate.lte).toEqual(dateOnly('2026-06-19'));
    expect(where.forecastDate.gte).toEqual(dateOnly('2026-06-06'));
  });
});

describe('runForecastBacktest', () => {
  const { runForecastBacktest } = require('../services/forecastService');

  function activeAttraction() {
    return {
      id: 'attr-1',
      title: 'Điểm demo',
      city: 'Hồ Chí Minh',
      defaultCapacity: 100,
      averageRating: 4.5,
      totalReviews: 20,
      minTicketPrice: 200000,
      partnerId: 'partner-1',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      operationalStatus: 'ACTIVE',
      archivedAt: null,
      publishedAt: new Date('2026-01-01'),
      partner: { status: 'APPROVED' },
      ticketProducts: [{ sellingPrice: 200000 }],
    };
  }

  // 120 ngày lịch sử, mỗi ngày 1 booking 200k để vượt mọi ngưỡng dữ liệu.
  function longHistory() {
    const bookings = [];
    for (let offset = 1; offset <= 120; offset += 1) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - offset);
      const key = date.toISOString().slice(0, 10);
      bookings.push({
        snapshotVisitDate: new Date(`${key}T00:00:00.000Z`),
        status: 'COMPLETED',
        payments: [{ amount: 200000 }],
        refundTransactions: [],
        reservation: { date: new Date(`${key}T00:00:00.000Z`), quantity: 1 },
      });
    }
    return bookings;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.attraction.findUnique.mockResolvedValue(activeAttraction());
    mockPrisma.booking.findMany.mockResolvedValue(longHistory());
    mockPrisma.revenueForecast.upsert.mockResolvedValue({});
  });

  test('model chỉ được nhìn lịch sử TRƯỚC ngày cần dự báo', async () => {
    const seenHistoryEnds = [];
    // ml-service thật luôn trả dự báo cho ngày kế tiếp ngày cuối của lịch sử;
    // mô phỏng lại đúng hành vi đó để bắt được rò rỉ dữ liệu tương lai.
    global.fetch = jest.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      const lastDate = body.history[body.history.length - 1].date;
      seenHistoryEnds.push(lastDate);
      const next = new Date(`${lastDate}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return {
        ok: true,
        json: async () => ({
          model_version: 'demo-booking-v2',
          training_source: 'real_booking_history',
          forecast: [{
            date: next.toISOString().slice(0, 10),
            predicted_revenue: 200000,
            predicted_tickets: 1,
            confidence_lower: 150000,
            confidence_upper: 250000,
          }],
        }),
      };
    });

    const result = await runForecastBacktest('attr-1', { days: 5 });

    expect(result.evaluated).toBe(5);
    expect(seenHistoryEnds).toHaveLength(5);
    // Mỗi lần gọi, ngày cuối của lịch sử phải sớm hơn ngày được dự báo đúng 1 ngày.
    for (const call of mockPrisma.revenueForecast.upsert.mock.calls) {
      const forecastDate = call[0].where.attractionId_forecastDate.forecastDate;
      const historyEnd = seenHistoryEnds.shift();
      const expectedEnd = new Date(forecastDate.getTime() - 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      expect(historyEnd).toBe(expectedEnd);
    }
  });

  test('lưu kèm doanh thu thực để đối chiếu được ngay', async () => {
    global.fetch = jest.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      const lastDate = body.history[body.history.length - 1].date;
      const next = new Date(`${lastDate}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return {
        ok: true,
        json: async () => ({
          model_version: 'demo-booking-v2',
          training_source: 'real_booking_history',
          forecast: [{
            date: next.toISOString().slice(0, 10),
            predicted_revenue: 180000,
            predicted_tickets: 1,
            confidence_lower: 150000,
            confidence_upper: 250000,
          }],
        }),
      };
    });

    await runForecastBacktest('attr-1', { days: 3 });

    const created = mockPrisma.revenueForecast.upsert.mock.calls[0][0].create;
    expect(created.actualRevenue).toBe(200000);
    expect(created.predictedRevenue).toBe(180000);
    expect(created.usedFallback).toBe(false);
  });

  test('không ghi kết quả nào khi model chưa được huấn luyện bằng dữ liệu hợp lệ', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        model_version: 'bootstrap',
        training_source: 'synthetic_bootstrap',
        forecast: [],
      }),
    }));

    const result = await runForecastBacktest('attr-1', { days: 4 });

    expect(result.evaluated).toBe(0);
    expect(result.skipped).toBe(4);
    expect(mockPrisma.revenueForecast.upsert).not.toHaveBeenCalled();
  });

  test('ml-service lỗi thì bỏ qua ngày đó chứ không ghi số bịa', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up'));

    const result = await runForecastBacktest('attr-1', { days: 3 });

    expect(result.evaluated).toBe(0);
    expect(result.skipped).toBe(3);
    expect(mockPrisma.revenueForecast.upsert).not.toHaveBeenCalled();
  });
});

describe('getModelQuality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetModelQualityCache();
  });

  test('trả kèm baseline và cảnh báo khi model huấn luyện bằng dữ liệu demo', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model_loaded: true,
        model_version: 'demo-booking-v2',
        training_source: 'demo_booking_history',
        has_ticket_model: true,
        metrics: { wape: 8.62, baseline_wape: 10.53, beats_baseline_wape: true },
      }),
    });

    const result = await getModelQuality({ force: true });

    expect(result.available).toBe(true);
    expect(result.hasTicketModel).toBe(true);
    expect(result.metrics.baseline_wape).toBe(10.53);
    expect(result.warning).toMatch(/mô phỏng/);
  });

  test('ml-service chết thì báo không đọc được thay vì im lặng trả 0', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await getModelQuality({ force: true });

    expect(result.available).toBe(false);
    expect(result.metrics).toBeNull();
    expect(result.warning).toMatch(/Không đọc được thông tin model/);
  });

  test('kết quả được cache để mở panel không phải chờ ml-service mỗi lần', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model_loaded: true, model_version: 'v1', training_source: 'real_booking_history' }),
    });

    await getModelQuality({ force: true });
    await getModelQuality();
    await getModelQuality();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
