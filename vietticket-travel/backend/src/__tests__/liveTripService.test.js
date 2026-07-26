'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const {
  activateLiveTrip,
  extractActivityDescriptors,
  resolveActivityTimes,
} = require('../services/liveTripService');
const mockPrisma = require('./helpers/mockPrisma');

describe('liveTripService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  });

  test('materialization accepts generated date-aware itinerary activities', () => {
    const result = extractActivityDescriptors(
      {
        startDate: '2099-03-10',
        days: [
          {
            visitDate: '2099-03-10',
            activities: [
              { attractionId: 'a1', title: 'Bảo tàng Chăm', suggestedTime: '08:00 - 10:00' },
              { attractionId: 'a2', title: 'Bà Nà Hills', suggestedTime: 'Chiều' },
            ],
          },
        ],
      },
      {},
    );

    expect(result.start.key).toBe('2099-03-10');
    expect(result.descriptors).toHaveLength(2);
    expect(result.descriptors[1].dateInfo.key).toBe('2099-03-10');
  });

  test('falls back to attraction opening hours and recommended duration', () => {
    expect(resolveActivityTimes({}, {
      openTime: '08:30',
      closeTime: '17:00',
      recommendedVisitMinutes: 120,
    })).toEqual({ startTime: '08:30', endTime: '10:30' });
  });

  test('rejects activities without an attraction id instead of creating phantom live items', () => {
    expect(() => extractActivityDescriptors({
      startDate: '2099-03-10',
      days: [{ activities: [{ title: 'Hoạt động tự do' }] }],
    }, {})).toThrow('chưa có attractionId');
  });

  test('requires a start date for old plans without a date', () => {
    expect(() => extractActivityDescriptors({
      days: [{ activities: [{ attractionId: 'a1', title: 'Điểm tham quan' }] }],
    }, {})).toThrow('chưa có ngày bắt đầu');
  });
  test('rejects explicit days outside the trip window or out of order', () => {
    expect(() => extractActivityDescriptors({
      startDate: '2099-03-10',
      days: [
        { visitDate: '2099-03-10', activities: [{ attractionId: 'a1' }] },
        { visitDate: '2099-03-09', activities: [{ attractionId: 'a2' }] },
      ],
    }, {})).toThrow();

    expect(() => extractActivityDescriptors({
      startDate: '2099-03-10',
      days: [
        { visitDate: '2099-03-25', activities: [{ attractionId: 'a1' }] },
      ],
    }, {})).toThrow();

    expect(() => extractActivityDescriptors({
      startDate: '2099-03-10',
      days: [
        { visitDate: '2099-03-11', activities: [{ attractionId: 'a1' }] },
        { visitDate: '2099-03-10', activities: [{ attractionId: 'a2' }] },
      ],
    }, {})).toThrow();
  });

  test('materializes a saved itinerary once and keeps the original booking unchanged', async () => {
    const createdTrip = {
      id: 'live-1',
      userId: 'user-1',
      savedItineraryId: 'saved-1',
      title: 'Da Nang 1 ngày',
      startDate: new Date('2099-03-10T00:00:00.000Z'),
      endDate: new Date('2099-03-10T00:00:00.000Z'),
      status: 'ACTIVE',
      createdAt: new Date('2099-03-01T00:00:00.000Z'),
      updatedAt: new Date('2099-03-01T00:00:00.000Z'),
      items: [],
    };

    mockPrisma.savedItinerary.findUnique.mockResolvedValue({
      id: 'saved-1',
      userId: 'user-1',
      planId: 'plan-1',
      title: 'Da Nang 1 ngày',
      criteria: { startDate: '2099-03-10' },
      data: {
        title: 'Da Nang 1 ngày',
        startDate: '2099-03-10',
        days: [{ activities: [{ attractionId: 'a1', suggestedTime: '08:00' }] }],
      },
    });
    mockPrisma.liveTrip.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdTrip);
    mockPrisma.attraction.findMany.mockResolvedValue([{
      id: 'a1',
      title: 'Bảo tàng Chăm',
      city: 'Đà Nẵng',
      openTime: '08:00',
      closeTime: '17:00',
      recommendedVisitMinutes: 120,
      isFullDay: false,
      operationalStatus: 'ACTIVE',
    }]);
    mockPrisma.booking.findMany.mockResolvedValue([]);
    mockPrisma.liveTrip.create.mockResolvedValue(createdTrip);

    const result = await activateLiveTrip({
      userId: 'user-1',
      planId: 'plan-1',
      prismaClient: mockPrisma,
    });

    expect(result.created).toBe(true);
    expect(mockPrisma.liveTrip.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        savedItineraryId: 'saved-1',
        items: {
          create: [expect.objectContaining({
            attractionId: 'a1',
            scheduledStart: new Date('2099-03-10T01:00:00.000Z'),
            scheduledEnd: new Date('2099-03-10T03:00:00.000Z'),
          })],
        },
      }),
    }));
  });

  test('is idempotent when the same saved itinerary is activated again', async () => {
    const existingTrip = {
      id: 'live-existing',
      userId: 'user-1',
      savedItineraryId: 'saved-1',
      title: 'Đà Nẵng',
      startDate: new Date('2099-03-10T00:00:00.000Z'),
      endDate: new Date('2099-03-10T00:00:00.000Z'),
      status: 'ACTIVE',
      createdAt: new Date('2099-03-01T00:00:00.000Z'),
      updatedAt: new Date('2099-03-01T00:00:00.000Z'),
      items: [],
    };
    mockPrisma.savedItinerary.findUnique.mockResolvedValue({
      id: 'saved-1',
      userId: 'user-1',
      planId: 'plan-1',
      title: 'Đà Nẵng',
      data: { startDate: '2099-03-10', days: [{ activities: [{ attractionId: 'a1' }] }] },
      criteria: {},
    });
    mockPrisma.liveTrip.findUnique.mockResolvedValue(existingTrip);

    const result = await activateLiveTrip({ userId: 'user-1', planId: 'plan-1', prismaClient: mockPrisma });

    expect(result).toEqual({ created: false, trip: expect.objectContaining({ id: 'live-existing' }) });
    expect(mockPrisma.attraction.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.liveTrip.create).not.toHaveBeenCalled();
  });

  test('reports an existing transaction winner as not newly created', async () => {
    const raceWinner = {
      id: 'live-race-winner',
      userId: 'user-1',
      savedItineraryId: 'saved-1',
      title: 'Đà Nẵng',
      startDate: new Date('2099-03-10T00:00:00.000Z'),
      endDate: new Date('2099-03-10T00:00:00.000Z'),
      status: 'ACTIVE',
      createdAt: new Date('2099-03-01T00:00:00.000Z'),
      updatedAt: new Date('2099-03-01T00:00:00.000Z'),
      items: [],
    };
    mockPrisma.savedItinerary.findUnique.mockResolvedValue({
      id: 'saved-1',
      userId: 'user-1',
      planId: 'plan-1',
      title: 'Đà Nẵng',
      data: { startDate: '2099-03-10', days: [{ activities: [{ attractionId: 'a1' }] }] },
      criteria: {},
    });
    mockPrisma.liveTrip.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raceWinner)
      .mockResolvedValueOnce(raceWinner);
    mockPrisma.attraction.findMany.mockResolvedValue([{
      id: 'a1',
      title: 'Bảo tàng Chăm',
      city: 'Đà Nẵng',
      openTime: '08:00',
      closeTime: '17:00',
      recommendedVisitMinutes: 120,
      isFullDay: false,
      operationalStatus: 'ACTIVE',
    }]);
    mockPrisma.booking.findMany.mockResolvedValue([]);

    const result = await activateLiveTrip({ userId: 'user-1', planId: 'plan-1', prismaClient: mockPrisma });

    expect(result.created).toBe(false);
    expect(result.trip.id).toBe('live-race-winner');
    expect(mockPrisma.liveTrip.create).not.toHaveBeenCalled();
  });
});
