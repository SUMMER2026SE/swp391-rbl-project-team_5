jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/availabilityService', () => ({
  getBookableSchedule: jest.fn(),
  getProductCapacity: jest.fn(),
  getSlotCapacity: jest.fn(),
  getTicketAvailabilityBatch: jest.fn(),
}));

const {
  getTicketAvailabilityBatch,
} = require('../services/availabilityService');
const {
  buildOriginalSnapshot,
  findEligibleRecoveryOptions,
  resolveRecoveryFundingBooking,
} = require('../services/recoveryService');

function makeContext(overrides = {}) {
  return {
    creditAmount: 500000,
    originalSnapshot: {
      attractionId: 'old-attraction',
      attractionTitle: 'Điểm cũ',
      city: 'Đà Nẵng',
      district: 'Hải Châu',
      latitude: 16.0544,
      longitude: 108.2022,
      environment: 'OUTDOOR',
      ticketType: 'ADULT',
      visitDate: '2026-08-15',
      startTime: '09:00',
      quantity: 2,
      ...overrides,
    },
  };
}

function makeProduct(overrides = {}) {
  return {
    id: 'new-product',
    name: 'Vé người lớn',
    type: 'ADULT',
    description: 'Trải nghiệm thay thế',
    sellingPrice: 200000,
    attraction: {
      id: 'new-attraction',
      title: 'Điểm thay thế',
      address: 'Đà Nẵng',
      city: 'Đà Nẵng',
      district: 'Hải Châu',
      latitude: 16.0644,
      longitude: 108.2122,
      environment: 'OUTDOOR',
      averageRating: 4.7,
      totalReviews: 120,
      images: [{ imageUrl: '/uploads/new.jpg' }],
      ...overrides.attraction,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'attraction'),
    ),
  };
}

describe('VietTicket Rescue option eligibility', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns only live slots with enough inventory and computes the refund difference', async () => {
    const client = {
      ticketProduct: { findMany: jest.fn().mockResolvedValue([makeProduct()]) },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['new-product', {
        closed: false,
        slots: [
          {
            timeSlotId: 'slot-full',
            startTime: '08:00',
            endTime: '09:00',
            availableTickets: 1,
            bookingClosed: false,
          },
          {
            timeSlotId: 'slot-open',
            startTime: '09:30',
            endTime: '11:30',
            availableTickets: 12,
            bookingClosed: false,
          },
        ],
      }],
    ]));

    const options = await findEligibleRecoveryOptions(client, makeContext());

    expect(options).toHaveLength(1);
    expect(options[0]).toEqual(expect.objectContaining({
      ticketProductId: 'new-product',
      timeSlotId: 'slot-open',
      quantity: 2,
      totalAmount: 400000,
      refundAmount: 100000,
      availableTickets: 12,
    }));
    expect(options[0].recommendationReasons).toContain(
      'Giữ phong cách trải nghiệm tương tự',
    );
  });

  test('does not send a more expensive product into the availability pipeline', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({ id: 'affordable', sellingPrice: 250000 }),
          makeProduct({ id: 'too-expensive', sellingPrice: 250001 }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map());

    await findEligibleRecoveryOptions(client, makeContext());

    expect(getTicketAvailabilityBatch).toHaveBeenCalledWith(
      client,
      ['affordable'],
      expect.any(Date),
      expect.objectContaining({ now: expect.any(Date) }),
    );
  });

  test('queries only same-city, same-ticket-type, public automatic-confirmation inventory', async () => {
    const client = {
      ticketProduct: { findMany: jest.fn().mockResolvedValue([]) },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map());

    await findEligibleRecoveryOptions(client, makeContext());

    expect(client.ticketProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'ADULT',
          attraction: expect.objectContaining({
            id: { not: 'old-attraction' },
            city: { equals: 'Đà Nẵng', mode: 'insensitive' },
            requiresManualApproval: false,
            publicationStatus: 'ACTIVE',
            operationalStatus: 'ACTIVE',
          }),
        }),
      }),
    );
  });
});

describe('VietTicket Rescue original snapshot', () => {
  test('uses immutable booking snapshots for customer-facing historical data', () => {
    const booking = {
      id: 'booking-old',
      totalAmount: 450000,
      snapshotAttractionId: 'snap-attraction',
      snapshotAttractionTitle: 'Tên tại lúc mua',
      snapshotAttractionCity: 'Đà Nẵng',
      snapshotTicketName: 'Vé snapshot',
      snapshotTicketType: 'ADULT',
      snapshotVisitDate: new Date('2026-08-15T00:00:00.000Z'),
      snapshotTimeSlotLabel: '09:00 - 11:00',
      reservation: {
        date: new Date('2026-08-15T00:00:00.000Z'),
        quantity: 2,
        timeSlot: { startTime: '09:00', endTime: '11:00' },
        ticketProduct: {
          name: 'Tên hiện tại',
          type: 'ADULT',
          attraction: {
            id: 'current-attraction',
            title: 'Tên hiện tại',
            city: 'Đà Nẵng',
            environment: 'OUTDOOR',
            images: [],
          },
        },
      },
    };

    expect(buildOriginalSnapshot(booking)).toEqual(expect.objectContaining({
      bookingId: 'booking-old',
      attractionId: 'snap-attraction',
      attractionTitle: 'Tên tại lúc mua',
      ticketName: 'Vé snapshot',
      visitDate: '2026-08-15',
      quantity: 2,
      totalAmount: 450000,
    }));
  });
});

describe('VietTicket Rescue funding trace', () => {
  test('uses the booking itself when it owns the captured VNPay payment', async () => {
    const booking = {
      id: 'booking-paid',
      payments: [{
        id: 'payment-vnpay',
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'VNPAY',
      }],
    };
    const tx = { recoveryCase: { findFirst: jest.fn() } };

    await expect(resolveRecoveryFundingBooking(tx, booking)).resolves.toBe(booking);
    expect(tx.recoveryCase.findFirst).not.toHaveBeenCalled();
  });

  test('traces a cancelled replacement back to the original VNPay booking', async () => {
    const replacement = {
      id: 'booking-replacement',
      payments: [{
        id: 'payment-credit',
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
      }],
    };
    const fundingBooking = {
      id: 'booking-vnpay-root',
      payments: [{
        id: 'payment-vnpay',
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'VNPAY',
      }],
    };
    const tx = {
      recoveryCase: {
        findFirst: jest.fn().mockResolvedValue({ fundingBooking }),
      },
    };

    await expect(resolveRecoveryFundingBooking(tx, replacement))
      .resolves.toBe(fundingBooking);
    expect(tx.recoveryCase.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { replacementBookingId: 'booking-replacement' },
    }));
  });

  test('refuses to invent refundable credit for an unlinked internal payment', async () => {
    const tx = {
      recoveryCase: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(resolveRecoveryFundingBooking(tx, {
      id: 'orphan-booking',
      payments: [{
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
      }],
    })).resolves.toBeNull();
  });
});
