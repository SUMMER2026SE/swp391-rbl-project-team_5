jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/llmClient', () => ({
  generateJSON: jest.fn(),
  generateText: jest.fn(),
}));

const mockPrisma = require('./helpers/mockPrisma');
const { generateJSON, generateText } = require('../services/llmClient');
const { getCatalogSummary } = require('../services/aiCatalogService');
const {
  chatWithUser,
  generateItinerary,
  recommendAttractions,
} = require('../services/aiAssistantService');

function makeAttraction(id, price, rating = 5) {
  return {
    id,
    title: `Attraction ${id}`,
    description: 'A public attraction',
    city: 'Da Nang',
    district: null,
    openTime: '08:00',
    closeTime: '17:00',
    averageRating: rating,
    totalReviews: 100,
    minTicketPrice: price,
    categories: [{ category: { name: 'Nature' } }],
    ticketProducts: [{
      id: `ticket-${id}`,
      name: 'Adult ticket',
      type: 'ADULT',
      sellingPrice: price,
      refundPolicy: 'NON_REFUNDABLE',
    }],
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('AI catalog', () => {
  test('uses the same public availability predicate as customer catalog', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);

    await getCatalogSummary({ city: 'Da Nang', category: 'Nature', limit: 3 });

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishedAt: { not: null },
          publicationStatus: 'ACTIVE',
          archivedAt: null,
          status: { not: 'SUSPENDED' },
          ticketProducts: { some: { status: 'ACTIVE', archivedAt: null } },
        }),
        take: 3,
      }),
    );
  });
});

describe('recommendAttractions', () => {
  test('keeps selected combos within the total customer budget', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttraction('a1', 400000, 5),
      makeAttraction('a2', 400000, 4.9),
      makeAttraction('a3', 400000, 4.8),
    ]);

    const result = await recommendAttractions({
      budget: 500000,
      people: 1,
      city: 'Da Nang',
      interests: 'Nature',
    });

    const total = result.data.combos.reduce((sum, combo) => sum + combo.totalPrice, 0);
    expect(total).toBeLessThanOrEqual(500000);
    expect(result.data.combos).toHaveLength(1);
    expect(result.data.recommendedAttractions).toHaveLength(1);
    expect(result.provider).toBe('rule-based');
  });
});

describe('generateItinerary', () => {
  test('does not schedule attractions beyond the provided budget', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttraction('a1', 400000, 5),
      makeAttraction('a2', 400000, 4.9),
      makeAttraction('a3', 400000, 4.8),
    ]);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateItinerary({
      city: 'Da Nang',
      days: 2,
      people: 1,
      budget: 500000,
      interests: 'Nature',
    });

    const activities = result.data.days.flatMap((day) => day.activities);
    expect(activities).toHaveLength(1);
    expect(result.data.estimatedCost.total).toBeLessThanOrEqual(500000);
    expect(result.provider).toBe('rule-based');
  });
});

describe('chatWithUser', () => {
  test('passes prior chat content to the LLM and tolerates older message fields', async () => {
    generateText.mockResolvedValue({ text: 'ok', provider: 'mock' });

    await chatWithUser('Câu mới', [
      { role: 'user', message: 'Câu cũ từ localStorage cũ' },
      { role: 'assistant', content: 'Trả lời cũ' },
    ]);

    const userPrompt = generateText.mock.calls[0][1];
    expect(userPrompt).toContain('Câu cũ từ localStorage cũ');
    expect(userPrompt).toContain('Trả lời cũ');
  });

  test('returns a friendly fallback instead of failing when providers are not configured', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    generateText.mockRejectedValue(new Error('Tất cả LLM provider đều thất bại'));

    const result = await chatWithUser('Chính sách hoàn vé là gì?', []);

    expect(result.provider).toBe('fallback');
    expect(result.reply).toContain('Trợ lý AI');
    consoleError.mockRestore();
  });
});
