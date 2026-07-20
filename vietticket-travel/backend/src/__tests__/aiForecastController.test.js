'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/forecastService', () => ({
  FORECAST_DATA_BASIS: 'NET_TICKET_REVENUE_BY_VISIT_DATE',
  getForecastForAttraction: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
const forecastService = require('../services/forecastService');
const {
  getAdminForecastOverview,
  getAttractionForecast,
  getPartnerForecastOverview,
  parseForecastDays,
} = require('../controllers/aiForecastController');

function createRes() {
  return {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
}

function forecastResult(overrides = {}) {
  return {
    modelVersion: 'real-v1',
    method: 'AI_ENSEMBLE',
    usedFallback: false,
    forecastAvailable: true,
    warning: null,
    dataQuality: {
      lookbackDays: 180,
      observedDays: 50,
      completedBookings: 80,
      sufficientForAi: true,
    },
    forecast: [
      {
        date: '2026-07-20',
        predictedRevenue: 1000000,
        predictedTickets: 4,
        confidenceLower: 700000,
        confidenceUpper: 1400000,
      },
    ],
    ...overrides,
  };
}

describe('aiForecastController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('từ chối horizon ngoài 1-30 thay vì âm thầm đổi về 7 ngày', () => {
    expect(() => parseForecastDays('31')).toThrow(
      'Số ngày dự báo phải là số nguyên từ 1 đến 30.',
    );
    expect(parseForecastDays(undefined)).toBe(7);
    expect(parseForecastDays('14')).toBe(14);
  });

  test('partner overview chỉ lấy điểm đã duyệt, đang mở bán và đang vận hành', async () => {
    prisma.attraction.findMany.mockResolvedValue([
      {
        id: 'attr-1',
        title: 'Bà Nà Hills',
        city: 'Đà Nẵng',
        partnerId: 'partner-1',
      },
    ]);
    forecastService.getForecastForAttraction.mockResolvedValue(forecastResult());
    const req = {
      query: { days: '7' },
      partner: { id: 'partner-1' },
    };
    const res = createRes();
    const next = jest.fn();

    await getPartnerForecastOverview(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          partnerId: 'partner-1',
          status: 'APPROVED',
          publicationStatus: 'ACTIVE',
          operationalStatus: 'ACTIVE',
          archivedAt: null,
          publishedAt: { not: null },
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        totalPredictedRevenue: 1000000,
        successfulAttractions: 1,
        methodSummary: {
          ai: 1, demoAi: 0, baseline: 0, insufficientData: 0,
        },
      }),
    });
  });

  test('admin overview cộng timeline và không dùng enum PUBLISHED không tồn tại', async () => {
    prisma.attraction.findMany.mockResolvedValue([
      { id: 'attr-1', title: 'Điểm A', city: 'Huế', partnerId: 'partner-1' },
      { id: 'attr-2', title: 'Điểm B', city: 'Huế', partnerId: 'partner-2' },
    ]);
    forecastService.getForecastForAttraction
      .mockResolvedValueOnce(forecastResult())
      .mockResolvedValueOnce(forecastResult({
        method: 'HISTORICAL_BASELINE',
        usedFallback: true,
        forecast: [{
          date: '2026-07-20',
          predictedRevenue: 500000,
          predictedTickets: 2,
          confidenceLower: 200000,
          confidenceUpper: 900000,
        }],
      }));
    const req = { query: { days: '7', city: 'Huế' } };
    const res = createRes();
    const next = jest.fn();

    await getAdminForecastOverview(req, res, next);

    const query = prisma.attraction.findMany.mock.calls[0][0];
    expect(query.where.publicationStatus).toBe('ACTIVE');
    expect(query.where.operationalStatus).toBe('ACTIVE');
    expect(query.where.city).toBe('Huế');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        totalPredictedRevenue: 1500000,
        methodSummary: {
          ai: 1, demoAi: 0, baseline: 1, insufficientData: 0,
        },
        timeline: [{
          date: '2026-07-20',
          predictedRevenue: 1500000,
          predictedTickets: 6,
          confidenceLower: 900000,
          confidenceUpper: 2300000,
        }],
      }),
    });
  });

  test('không cộng điểm thiếu dữ liệu vào doanh thu hoặc số dự báo thành công', async () => {
    prisma.attraction.findMany.mockResolvedValue([
      { id: 'attr-1', title: 'Điểm có dữ liệu', city: 'Huế', partnerId: 'partner-1' },
      { id: 'attr-2', title: 'Điểm mới', city: 'Huế', partnerId: 'partner-1' },
    ]);
    forecastService.getForecastForAttraction
      .mockResolvedValueOnce(forecastResult())
      .mockResolvedValueOnce(forecastResult({
        modelVersion: 'insufficient_data_v1',
        method: 'INSUFFICIENT_DATA',
        usedFallback: true,
        forecastAvailable: false,
        forecast: [{
          date: '2026-07-20',
          predictedRevenue: 0,
          predictedTickets: 0,
          confidenceLower: 0,
          confidenceUpper: 0,
        }],
      }));
    const req = { query: { days: '7' }, partner: { id: 'partner-1' } };
    const res = createRes();
    const next = jest.fn();

    await getPartnerForecastOverview(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        totalAttractions: 2,
        processedAttractions: 2,
        successfulAttractions: 1,
        insufficientDataAttractions: 1,
        failedAttractions: 0,
        totalPredictedRevenue: 1000000,
        methodSummary: {
          ai: 1, demoAi: 0, baseline: 0, insufficientData: 1,
        },
      }),
    });
  });

  test('admin refresh truyền forceRefresh xuống service cho toàn bộ overview', async () => {
    prisma.attraction.findMany.mockResolvedValue([
      { id: 'attr-1', title: 'Điểm A', city: 'Huế', partnerId: 'partner-1' },
    ]);
    forecastService.getForecastForAttraction.mockResolvedValue(forecastResult());
    const req = { query: { days: '14', refresh: 'true' } };
    const res = createRes();
    const next = jest.fn();

    await getAdminForecastOverview(req, res, next);

    expect(forecastService.getForecastForAttraction).toHaveBeenCalledWith(
      'attr-1',
      { forecastDays: 14, forceRefresh: true },
    );
  });

  test('Partner không thể dò hoặc xem dự báo attraction của đối tác khác', async () => {
    prisma.attraction.findUnique.mockResolvedValue({
      partnerId: 'partner-other',
      archivedAt: null,
    });
    const req = {
      params: { attractionId: 'attr-private' },
      query: { days: '7' },
      user: { id: 'partner-user', role: 'PARTNER' },
      partner: { id: 'partner-1', status: 'APPROVED' },
    };
    const res = createRes();
    const next = jest.fn();

    await getAttractionForecast(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
    );
    expect(forecastService.getForecastForAttraction).not.toHaveBeenCalled();
  });

  test('Partner sở hữu attraction vẫn không được bỏ qua cache', async () => {
    prisma.attraction.findUnique.mockResolvedValue({
      partnerId: 'partner-1',
      archivedAt: null,
    });
    const req = {
      params: { attractionId: 'attr-1' },
      query: { days: '7', refresh: 'true' },
      user: { id: 'partner-user', role: 'PARTNER' },
      partner: { id: 'partner-1', status: 'APPROVED' },
    };
    const res = createRes();
    const next = jest.fn();

    await getAttractionForecast(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(forecastService.getForecastForAttraction).not.toHaveBeenCalled();
  });
});
