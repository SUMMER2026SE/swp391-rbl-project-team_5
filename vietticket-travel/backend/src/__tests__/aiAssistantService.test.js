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

function makeAttractionAt(id, price, latitude, longitude, rating = 5, closeTime = '22:00') {
  const a = makeAttraction(id, price, rating);
  a.latitude = latitude;
  a.longitude = longitude;
  a.closeTime = closeTime;
  return a;
}

function makeAttractionWithChildTicket(id, adultPrice, childPrice, rating = 5) {
  const base = makeAttraction(id, adultPrice, rating);
  base.ticketProducts.push({
    id: `ticket-${id}-child`,
    name: 'Child ticket',
    type: 'CHILD',
    sellingPrice: childPrice,
    refundPolicy: 'NON_REFUNDABLE',
  });
  return base;
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

  test('maps common city aliases and Vietnamese interests to catalog filters', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);

    await getCatalogSummary({
      city: 'Da Nang',
      category: 'thi\u00ean nhi\u00ean, v\u0103n h\u00f3a',
      limit: 3,
    });

    const where = mockPrisma.attraction.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: { contains: '\u0110\u00e0 N\u1eb5ng', mode: 'insensitive' } }),
      ]),
    );
    expect(where.categories.some.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: { name: { contains: 'Nature & Sightseeing', mode: 'insensitive' } } }),
        expect.objectContaining({ category: { name: { contains: 'Cultural Experience', mode: 'insensitive' } } }),
      ]),
    );
  });

  test('falls back to city catalog when interest filters have no matches', async () => {
    mockPrisma.attraction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeAttraction('a1', 100000)]);

    const catalog = await getCatalogSummary({ city: 'Da Nang', category: 'Museum', limit: 3 });

    expect(catalog).toHaveLength(1);
    expect(mockPrisma.attraction.findMany.mock.calls[1][0].where.categories).toBeUndefined();
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

  test('prices adults and children with their own ticket types', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttractionWithChildTicket('a1', 100000, 50000),
    ]);

    const result = await recommendAttractions({
      budget: 1000000,
      adults: 2,
      children: 2,
      city: 'Da Nang',
    });

    const combo = result.data.combos[0];
    // 2 người lớn × 100k + 2 trẻ em × 50k = 300k
    expect(combo.totalPrice).toBe(300000);
    expect(combo.items).toHaveLength(2);
    const childLine = combo.items.find((item) => item.unitPrice === 50000);
    expect(childLine.quantity).toBe(2);
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

  test('packs more attractions per day at a faster pace', async () => {
    // Mở cửa muộn (22:00) để khung Tối cũng dùng được, kiểm đúng số điểm theo nhịp độ.
    const catalog = Array.from({ length: 6 }, (_, i) => {
      const a = makeAttraction(`a${i}`, 50000, 5 - i * 0.1);
      a.closeTime = '22:00';
      return a;
    });
    mockPrisma.attraction.findMany.mockResolvedValue(catalog);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const relaxed = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'relaxed' });
    const packed = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'packed' });

    expect(relaxed.data.days[0].activities).toHaveLength(2);
    expect(packed.data.days[0].activities).toHaveLength(4);
  });

  test('does not place attractions in an evening slot when they close earlier', async () => {
    // 4 điểm mở 08:00-17:00; nhịp độ dày đặc có khung Tối 18:00-21:00.
    const catalog = Array.from({ length: 4 }, (_, i) => makeAttraction(`a${i}`, 50000, 5 - i * 0.1));
    mockPrisma.attraction.findMany.mockResolvedValue(catalog);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'packed' });

    const activities = result.data.days[0].activities;
    expect(activities.length).toBeLessThanOrEqual(3); // khung Tối bị bỏ trống
    expect(activities.every((a) => a.timeSlot !== 'Tối')).toBe(true);
  });

  test('provides backup alternatives per day from leftover attractions', async () => {
    const catalog = Array.from({ length: 6 }, (_, i) => makeAttraction(`a${i}`, 50000, 5 - i * 0.1));
    mockPrisma.attraction.findMany.mockResolvedValue(catalog);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'relaxed' });

    const day = result.data.days[0];
    expect(day.activities).toHaveLength(2);
    expect(Array.isArray(day.alternatives)).toBe(true);
    expect(day.alternatives.length).toBeGreaterThan(0);
  });

  test('orders same-day activities by route proximity', async () => {
    // a0 điểm cao nhất (làm điểm đầu). a1 ở SÁT a0, a2 ở XA dù điểm số nhỉnh hơn a1.
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttractionAt('a0', 50000, 16.0, 108.0, 5.0),
      makeAttractionAt('a1', 50000, 16.001, 108.001, 4.8),
      makeAttractionAt('a2', 50000, 16.5, 108.5, 4.9),
    ]);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'packed' });

    const order = result.data.days[0].activities.map((a) => a.attractionId);
    // điểm đầu a0 -> gần nhất a1 -> rồi mới a2
    expect(order).toEqual(['a0', 'a1', 'a2']);
  });

  test('still schedules attractions that are missing coordinates', async () => {
    // a0 có toạ độ (điểm đầu); a1, a2 thiếu toạ độ -> vẫn phải được xếp tiếp.
    const withCoords = makeAttractionAt('a0', 50000, 16.0, 108.0, 5.0);
    const noCoords1 = makeAttraction('a1', 50000, 4.9);
    const noCoords2 = makeAttraction('a2', 50000, 4.8);
    noCoords1.closeTime = '22:00';
    noCoords2.closeTime = '22:00';
    mockPrisma.attraction.findMany.mockResolvedValue([withCoords, noCoords1, noCoords2]);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'packed' });

    expect(result.data.days[0].activities).toHaveLength(3);
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
