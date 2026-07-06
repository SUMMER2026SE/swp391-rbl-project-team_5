jest.mock('../services/aiAssistantService', () => ({
  chatWithUser: jest.fn(),
  generateItinerary: jest.fn(),
  recommendAttractions: jest.fn(),
}));

jest.mock('../utils/refundService', () => ({
  todayInVietnam: jest.fn(() => '2026-07-03'),
}));

const { generateItinerary } = require('../services/aiAssistantService');
const { itinerary } = require('../controllers/aiAssistantController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

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
});
