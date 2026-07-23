'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const {
  calculatePressureScore,
  getAttractionPressure,
  getPressureLabel,
  getVietnamDateKey,
  parseDateKey,
} = require('../services/arrivalPressureService');
const mockPrisma = require('./helpers/mockPrisma');

describe('arrivalPressureService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  test('returns a quiet score for a lightly booked attraction', () => {
    const result = calculatePressureScore({
      bookedQty: 10,
      heldQty: 0,
      capacity: 100,
      checkinsLast15Minutes: 0,
      showRate: 0.9,
    });

    expect(result.score).toBe(6);
    expect(result.level).toBe('QUIET');
    expect(result.label).toBe('Thoáng');
  });

  test('caps a fully loaded attraction at 100 and exposes the busy level', () => {
    const result = calculatePressureScore({
      bookedQty: 100,
      heldQty: 20,
      capacity: 100,
      checkinsLast15Minutes: 40,
      waitingGuests: 50,
      showRate: 1,
    });

    expect(result.score).toBe(100);
    expect(result.level).toBe('VERY_BUSY');
    expect(getPressureLabel(result.level)).toBe('Rất đông');
  });

  test('marks zero-capacity or closed attractions as closed, not quiet', () => {
    expect(calculatePressureScore({ capacity: 0 }).level).toBe('CLOSED');
    expect(calculatePressureScore({ capacity: 100, closed: true }).level).toBe('CLOSED');
  });

  test('never labels sold-out inventory as quiet before check-in starts', () => {
    const result = calculatePressureScore({
      bookedQty: 100,
      heldQty: 0,
      capacity: 100,
      checkinsLast15Minutes: 0,
      showRate: 0.9,
    });

    expect(result.score).toBe(85);
    expect(result.level).toBe('VERY_BUSY');
    expect(result.inventoryRatio).toBe(1);
  });

  test('rejects invalid dates and accepts strict calendar dates', () => {
    expect(parseDateKey('2099-02-28').key).toBe('2099-02-28');
    expect(() => parseDateKey('2099-02-29')).toThrow('không phải là ngày hợp lệ');
    expect(() => parseDateKey('2099/02/28')).toThrow('định dạng YYYY-MM-DD');
  });

  test('uses the Vietnam calendar date around the UTC day boundary', () => {
    expect(getVietnamDateKey(new Date('2099-03-09T18:30:00.000Z'))).toBe('2099-03-10');
    expect(getVietnamDateKey(new Date('2099-03-10T16:59:59.000Z'))).toBe('2099-03-10');
    expect(getVietnamDateKey(new Date('2099-03-10T17:00:00.000Z'))).toBe('2099-03-11');
  });

  test('combines stock, booking history and QR check-ins into a transparent pressure response', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Bảo tàng Chăm',
      city: 'Đà Nẵng',
      defaultCapacity: 100,
      operationalStatus: 'ACTIVE',
      environment: 'INDOOR',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      archivedAt: null,
    });
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue({
      capacity: 100,
      bookedQty: 50,
      heldQty: 5,
    });
    mockPrisma.specialDate.findUnique.mockResolvedValue({ closed: false, capacity: null, note: null });
    mockPrisma.timeSlot.findMany.mockResolvedValue([]);
    mockPrisma.booking.count.mockResolvedValueOnce(20).mockResolvedValueOnce(5);
    mockPrisma.ticketInstance.count.mockResolvedValue(3);
    mockPrisma.smartQueueEntry.findMany.mockResolvedValue([{
      partySize: 7,
      liveTripItem: { scheduledStart: new Date('2099-03-10T02:00:00.000Z') },
    }]);

    const result = await getAttractionPressure('a1', '2099-03-10', {
      prismaClient: mockPrisma,
      publicOnly: true,
      now: new Date('2099-03-10T02:00:00.000Z'),
    });

    expect(result.summary.bookedQty).toBe(50);
    expect(result.summary.heldQty).toBe(5);
    expect(result.summary.checkinsLast15Minutes).toBe(3);
    expect(result.summary.waitingGuests).toBe(7);
    expect(result.showRate).toBe(0.8);
    expect(result.dataBasis).toBe('BOOKING_STOCK_QR_AND_SMART_QUEUE');
    expect(mockPrisma.ticketInstance.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        checkedInAt: {
          gte: new Date('2099-03-10T01:45:00.000Z'),
          lte: new Date('2099-03-10T02:00:00.000Z'),
        },
      }),
    });
  });

  test('attributes waiting guests only to their scheduled slot', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Bảo tàng Chăm',
      city: 'Đà Nẵng',
      defaultCapacity: 100,
      operationalStatus: 'ACTIVE',
      environment: 'INDOOR',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      archivedAt: null,
    });
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue({
      capacity: 100,
      bookedQty: 40,
      heldQty: 0,
    });
    mockPrisma.specialDate.findUnique.mockResolvedValue(null);
    mockPrisma.timeSlot.findMany.mockResolvedValue([
      {
        id: 'slot-morning',
        startTime: '09:00',
        endTime: '10:00',
        maxCapacity: 100,
        timeSlotStocks: [{ bookedQty: 40, heldQty: 0 }],
      },
      {
        id: 'slot-afternoon',
        startTime: '15:00',
        endTime: '16:00',
        maxCapacity: 100,
        timeSlotStocks: [{ bookedQty: 20, heldQty: 0 }],
      },
    ]);
    mockPrisma.booking.count.mockResolvedValue(0);
    mockPrisma.ticketInstance.count.mockResolvedValue(0);
    mockPrisma.smartQueueEntry.findMany.mockResolvedValue([{
      partySize: 10,
      liveTripItem: { scheduledStart: new Date('2099-03-10T02:00:00.000Z') },
    }]);

    const result = await getAttractionPressure('a1', '2099-03-10', {
      prismaClient: mockPrisma,
      now: new Date('2099-03-10T02:15:00.000Z'),
    });

    expect(result.summary.waitingGuests).toBe(10);
    expect(result.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ timeSlotId: 'slot-morning', waitingGuests: 10 }),
      expect.objectContaining({ timeSlotId: 'slot-afternoon', waitingGuests: 0 }),
    ]));
  });

  test('does not expose pressure for an attraction that is not publicly bookable', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Draft attraction',
      city: 'Đà Nẵng',
      defaultCapacity: 100,
      operationalStatus: 'ACTIVE',
      environment: 'OUTDOOR',
      status: 'PENDING',
      publicationStatus: 'PAUSED',
      archivedAt: null,
    });

    await expect(getAttractionPressure('a1', '2099-03-10', {
      prismaClient: mockPrisma,
      publicOnly: true,
    })).rejects.toMatchObject({ statusCode: 404, code: 'ATTRACTION_NOT_FOUND' });
    expect(mockPrisma.attractionDailyStock.findUnique).not.toHaveBeenCalled();
  });
});
