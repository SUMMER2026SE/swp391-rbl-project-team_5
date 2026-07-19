jest.mock('../services/aiAssistantService', () => ({
  chatWithUser: jest.fn(),
  generateItinerary: jest.fn(),
  recommendAttractions: jest.fn(),
}));

jest.mock('../config/prisma', () => ({
  savedItinerary: {
    count: jest.fn(),
    upsert: jest.fn(),
  },
}));

jest.mock('../utils/refundService', () => ({
  todayInVietnam: jest.fn(() => '2026-07-03'),
}));

const {
  generateItinerary,
  recommendAttractions,
} = require('../services/aiAssistantService');
const prisma = require('../config/prisma');
const {
  itinerary,
  recommend,
  saveItinerary,
} = require('../controllers/aiAssistantController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiAssistantController itinerary', () => {
  test('requires startDate so itinerary availability is date-aware', async () => {
    const req = {
      body: { city: 'Da Nang', days: 2, adults: 2 },
      user: { id: 'user-1' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await itinerary(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('ngày bắt đầu'),
      }),
    );
    expect(generateItinerary).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('passes normalized startDate to itinerary service', async () => {
    generateItinerary.mockResolvedValue({
      data: { days: [], title: 'Plan' },
      provider: 'rule-based',
    });
    const req = {
      body: { city: 'Da Nang', days: 2, adults: 2, startDate: '2099-01-10' },
      user: { id: 'user-1' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await itinerary(req, res, next);

    expect(generateItinerary).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2099-01-10',
        userId: 'user-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an explicitly invalid party instead of silently using one adult', async () => {
    const req = {
      body: {
        city: 'Da Nang',
        days: 2,
        adults: -1,
        startDate: '2099-01-10',
      },
      user: { id: 'user-1' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await itinerary(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateItinerary).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a whitespace-only city', async () => {
    const req = {
      body: { city: '   ', days: 1, adults: 1, startDate: '2099-01-10' },
      user: { id: 'user-1' },
    };
    const res = mockResponse();

    await itinerary(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateItinerary).not.toHaveBeenCalled();
  });
});

describe('aiAssistantController recommend', () => {
  test('rejects non-finite budgets', async () => {
    const req = {
      body: { budget: Number.POSITIVE_INFINITY, adults: 1, visitDate: '2099-01-10' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await recommend(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recommendAttractions).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('aiAssistantController saveItinerary', () => {
  test('rejects arbitrary or oversized plan structures before persistence', async () => {
    const req = {
      body: {
        planId: 'plan-1',
        title: 'Plan',
        plan: { days: [{ activities: Array.from({ length: 5 }, () => ({})) }] },
      },
      user: { id: 'user-1' },
    };
    const res = mockResponse();
    const next = jest.fn();

    await saveItinerary(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.savedItinerary.count).not.toHaveBeenCalled();
    expect(prisma.savedItinerary.upsert).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
