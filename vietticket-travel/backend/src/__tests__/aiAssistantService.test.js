jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/llmClient', () => ({
  generateJSON: jest.fn(),
  generateText: jest.fn(),
}));

const mockPrisma = require('./helpers/mockPrisma');
const { generateJSON, generateText } = require('../services/llmClient');
const {
  getCatalogSummary,
  inferCatalogFiltersFromText,
} = require('../services/aiCatalogService');
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

function makeBookableProduct(ticketId, attractionId, capacity = 100, timeSlots = []) {
  return {
    id: ticketId,
    status: 'ACTIVE',
    archivedAt: null,
    timeSlots: [],
    attraction: {
      id: attractionId,
      publishedAt: new Date('2099-01-01T00:00:00.000Z'),
      publicationStatus: 'ACTIVE',
      status: 'ACTIVE',
      archivedAt: null,
      defaultCapacity: capacity,
      openDays: null,
      openTime: '08:00',
      closeTime: '17:00',
      specialDates: [],
      timeSlots,
    },
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('AI catalog', () => {
  test('infers catalog filters from natural travel questions', () => {
    expect(inferCatalogFiltersFromText('Gia dinh di da nang thich cong vien giai tri')).toEqual(
      expect.objectContaining({
        category: expect.stringContaining('Theme Park'),
        city: '\u0110\u00e0 N\u1eb5ng',
      }),
    );
  });

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

  test('filters tickets that are sold out on the selected visit date', async () => {
    const visitDate = new Date('2099-01-10T00:00:00.000Z');
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttraction('a1', 100000),
      makeAttraction('a2', 100000),
    ]);
    mockPrisma.ticketProduct.findUnique.mockImplementation(({ where }) => {
      const ticketId = where.id;
      const attractionId = ticketId.replace('ticket-', '');
      return Promise.resolve(makeBookableProduct(ticketId, attractionId));
    });
    mockPrisma.dailyStock.findUnique.mockImplementation(({ where }) => {
      const ticketId = where.ticketProductId_date.ticketProductId;
      if (ticketId === 'ticket-a2') {
        return Promise.resolve({ capacity: 0, bookedQuantity: 0, heldQuantity: 0 });
      }
      return Promise.resolve(null);
    });
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);

    const catalog = await getCatalogSummary({ city: 'Da Nang', limit: 5, date: visitDate });

    expect(catalog.map((item) => item.id)).toEqual(['a1']);
    expect(catalog[0].tickets[0].availability.availableTickets).toBeGreaterThan(0);
  });
});

describe('recommendAttractions', () => {
  test('keeps selected ticket packages within the total customer budget', async () => {
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
    expect(result.data.ticketPackages).toEqual(result.data.combos);
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

    const combo = result.data.ticketPackages[0];
    // 2 người lớn × 100k + 2 trẻ em × 50k = 300k
    expect(combo.totalPrice).toBe(300000);
    expect(combo.packageType).toBe('SINGLE_ATTRACTION_GROUP_TICKETS');
    expect(combo.items).toHaveLength(2);
    const childLine = combo.items.find((item) => item.unitPrice === 50000);
    expect(childLine.quantity).toBe(2);
  });

  test('only recommends attractions with enough available tickets on visitDate', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttraction('a1', 100000, 5),
      makeAttraction('a2', 100000, 4.9),
    ]);
    mockPrisma.ticketProduct.findUnique.mockImplementation(({ where }) => {
      const ticketId = where.id;
      const attractionId = ticketId.replace('ticket-', '');
      return Promise.resolve(makeBookableProduct(ticketId, attractionId));
    });
    mockPrisma.dailyStock.findUnique.mockImplementation(({ where }) => {
      const ticketId = where.ticketProductId_date.ticketProductId;
      if (ticketId === 'ticket-a2') {
        return Promise.resolve({ capacity: 1, bookedQuantity: 0, heldQuantity: 0 });
      }
      return Promise.resolve(null);
    });
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);

    const result = await recommendAttractions({
      budget: 1000000,
      people: 2,
      city: 'Da Nang',
      visitDate: '2099-01-10',
    });

    expect(result.data.availabilityChecked).toBe(true);
    expect(result.data.recommendedAttractions.map((item) => item.attractionId)).toEqual(['a1']);
  });

  test('does not recommend split adult and child tickets beyond shared slot capacity', async () => {
    const sharedSlot = {
      id: 'slot-a1-morning',
      startTime: '08:00',
      endTime: '11:00',
      maxCapacity: 3,
    };
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttractionWithChildTicket('a1', 100000, 50000, 5),
    ]);
    mockPrisma.ticketProduct.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(makeBookableProduct(where.id, 'a1', 20, [sharedSlot])),
    );
    mockPrisma.dailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.timeSlotStock.findMany.mockResolvedValue([]);

    const result = await recommendAttractions({
      budget: 1000000,
      adults: 2,
      children: 2,
      city: 'Da Nang',
      visitDate: '2099-01-10',
    });

    expect(result.data.recommendedAttractions).toHaveLength(0);
    expect(result.data.ticketPackages).toHaveLength(0);
  });

  test('softly prioritizes a logged-in customer favorite categories', async () => {
    const adventure = makeAttraction('a1', 50000, 4);
    adventure.categories = [{ category: { name: 'Adventure' } }];
    const museum = makeAttraction('a2', 50000, 5);
    museum.categories = [{ category: { name: 'Museum' } }];

    mockPrisma.attraction.findMany.mockResolvedValue([museum, adventure]);
    mockPrisma.favoriteAttraction.findMany.mockResolvedValueOnce([
      {
        attraction: {
          city: 'Da Nang',
          categories: [{ category: { name: 'Adventure' } }],
        },
      },
    ]);
    mockPrisma.booking.findMany.mockResolvedValueOnce([]);

    const result = await recommendAttractions({
      budget: 200000,
      people: 1,
      city: 'Da Nang',
      userId: 'user-1',
    });

    expect(result.data.recommendedAttractions[0].attractionId).toBe('a1');
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

  test('returns coordinates and route estimates for itinerary days', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttractionAt('a0', 50000, 16.0, 108.0, 5.0),
      makeAttractionAt('a1', 50000, 16.01, 108.01, 4.9),
    ]);
    generateJSON.mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateItinerary({ city: 'Da Nang', days: 1, people: 1, pace: 'relaxed' });
    const day = result.data.days[0];

    expect(day.activities[0]).toMatchObject({
      attractionId: 'a0',
      latitude: 16,
      longitude: 108,
    });
    expect(day.routeSegments).toHaveLength(1);
    expect(day.routeSegments[0]).toMatchObject({
      fromAttractionId: 'a0',
      toAttractionId: 'a1',
      travelMode: 'driving_estimate',
    });
    expect(day.routeSegments[0].distanceKm).toBeGreaterThan(0);
    expect(day.routeSummary.totalTravelMinutes).toBeGreaterThan(0);
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

  test('date-aware itinerary excludes attractions without enough available tickets', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttraction('a1', 50000, 5),
      makeAttraction('a2', 50000, 4.9),
    ]);
    mockPrisma.ticketProduct.findUnique.mockImplementation(({ where }) => {
      const ticketId = where.id;
      const attractionId = ticketId.replace('ticket-', '');
      return Promise.resolve(makeBookableProduct(ticketId, attractionId));
    });
    mockPrisma.dailyStock.findUnique.mockImplementation(({ where }) => {
      const ticketId = where.ticketProductId_date.ticketProductId;
      if (ticketId === 'ticket-a2') {
        return Promise.resolve({ capacity: 1, bookedQuantity: 0, heldQuantity: 0 });
      }
      return Promise.resolve(null);
    });
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);

    const result = await generateItinerary({
      city: 'Da Nang',
      days: 1,
      people: 2,
      pace: 'packed',
      startDate: '2099-01-10',
    });

    const activities = result.data.days.flatMap((day) => day.activities);
    expect(result.data.availabilityChecked).toBe(true);
    expect(activities.map((activity) => activity.attractionId)).toEqual(['a1']);
    expect(activities[0].visitDate).toBe('2099-01-10');
  });

  test('date-aware itinerary excludes split tickets beyond shared slot capacity', async () => {
    const sharedSlot = {
      id: 'slot-a1-morning',
      startTime: '08:00',
      endTime: '11:00',
      maxCapacity: 3,
    };
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttractionWithChildTicket('a1', 100000, 50000, 5),
    ]);
    mockPrisma.ticketProduct.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(makeBookableProduct(where.id, 'a1', 20, [sharedSlot])),
    );
    mockPrisma.dailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.timeSlotStock.findMany.mockResolvedValue([]);

    const result = await generateItinerary({
      city: 'Da Nang',
      days: 1,
      adults: 2,
      children: 2,
      pace: 'relaxed',
      startDate: '2099-01-10',
    });

    expect(result.data.availabilityChecked).toBe(true);
    expect(result.data.days).toHaveLength(0);
    expect(result.data.generationWarning).toBeTruthy();
  });

  test('date-aware itinerary still asks LLM for polished title and tips', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      makeAttraction('a1', 50000, 5),
    ]);
    mockPrisma.ticketProduct.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(makeBookableProduct(where.id, 'a1')),
    );
    mockPrisma.dailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);
    generateJSON.mockResolvedValue({
      data: { title: 'Da Nang nhe nhang', tips: ['Mang nuoc', 'Di som'] },
      provider: 'mock-llm',
    });

    const result = await generateItinerary({
      city: 'Da Nang',
      days: 1,
      people: 1,
      startDate: '2099-01-10',
    });

    expect(generateJSON).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('mock-llm');
    expect(result.data.title).toBe('Da Nang nhe nhang');
    expect(result.data.tips).toEqual(['Mang nuoc', 'Di som']);
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

  test('adds authenticated customer booking and support context for personal ticket questions', async () => {
    generateText.mockResolvedValue({ text: 'ok', provider: 'mock' });
    mockPrisma.booking.findMany.mockResolvedValueOnce([
      {
        id: 'booking-1',
        status: 'CONFIRMED',
        totalAmount: { toString: () => '250000' },
        snapshotAttractionTitle: 'Ba Na Hills',
        snapshotTicketName: 'Adult ticket',
        snapshotVisitDate: new Date('2099-01-10T00:00:00.000Z'),
        snapshotTimeSlotLabel: '08:00 - 11:00',
        voucher: { code: 'SUMMER10' },
        reservation: {
          quantity: 2,
          date: new Date('2099-01-10T00:00:00.000Z'),
          timeSlot: { startTime: '08:00', endTime: '11:00' },
          ticketProduct: {
            name: 'Adult ticket',
            attraction: { title: 'Ba Na Hills', city: 'Da Nang' },
          },
        },
        refundRequests: [],
        ticketInstances: [{ status: 'VALID' }, { status: 'USED' }],
      },
    ]);
    mockPrisma.supportTicket.findMany.mockResolvedValueOnce([
      {
        id: 'support-1',
        status: 'OPEN',
        subject: 'Can ho tro ve',
        bookingId: 'booking-1',
        updatedAt: new Date('2099-01-11T00:00:00.000Z'),
      },
    ]);

    await chatWithUser('ve cua toi trang thai the nao?', [], {
      userId: 'user-1',
      fullName: 'Nguyen Van A',
    });

    const userPrompt = generateText.mock.calls[0][1];
    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(userPrompt).toContain('DU LIEU CA NHAN CUA KHACH');
    expect(userPrompt).toContain('Ba Na Hills');
    expect(userPrompt).toContain('/my-tickets');
    expect(userPrompt).toContain('/support');
    expect(userPrompt).toContain('/my-support');
    expect(userPrompt).toContain('voucher: co ap dung');
    expect(userPrompt).not.toContain('/tickets/booking-1');
    expect(userPrompt).not.toContain('/support?bookingId=booking-1');
    expect(userPrompt).not.toContain('/my-support?ticketId=support-1');
    expect(userPrompt).not.toContain('SUMMER10');
    expect(userPrompt).not.toContain('Nguyen Van A');
    expect(userPrompt).not.toContain('booking-1');
    expect(userPrompt).not.toContain('support-1');
    expect(userPrompt).not.toContain('qrCodeToken');
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
