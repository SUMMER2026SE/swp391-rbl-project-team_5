'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/refundService', () => ({
  releaseHeldInventory: jest.fn(),
  releaseInventory: jest.fn(),
}));
jest.mock('../services/voucherRedemptionService', () => ({
  releaseVoucherRedemption: jest.fn(),
}));
jest.mock('../services/mandatoryRefundService', () => ({
  getCapturedPayment: jest.fn((booking) => booking?.payments?.[0] || null),
  queueMandatoryRefund: jest.fn(),
  queueRecoveryFullRefund: jest.fn(),
}));
jest.mock('../services/recoveryService', () => ({
  ORIGINAL_BOOKING_INCLUDE: {
    payments: true,
    ticketInstances: true,
    reservation: true,
  },
  createRecoveryCaseForCancellation: jest.fn(),
  resolveRecoveryFundingBooking: jest.fn(),
}));
jest.mock('../services/bookingNotificationService', () => ({
  OPERATIONAL_CANCELLATION_TOPIC: 'OPERATIONAL_CANCELLATION',
  enqueueBookingNotification: jest.fn(),
}));
jest.mock('../utils/auditLog', () => ({
  writeAuditLog: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
const {
  releaseHeldInventory,
} = require('../utils/refundService');
const {
  resolveRecoveryFundingBooking,
} = require('../services/recoveryService');
const {
  enqueueBookingNotification,
} = require('../services/bookingNotificationService');
const {
  remediateSuspendedBookings,
} = require('../services/operationalSuspensionService');

function futureBooking(overrides = {}) {
  return {
    id: 'booking-1',
    userId: 'customer-1',
    status: 'PENDING_PAYMENT',
    isForecastTrainingSample: false,
    voucherId: null,
    totalAmount: 200000,
    snapshotVisitDate: new Date('2030-08-01T00:00:00.000Z'),
    snapshotActivityStartTime: '09:00',
    ticketInstances: [],
    payments: [],
    reservation: {
      id: 'reservation-1',
      status: 'HELD',
      ticketProductId: 'ticket-1',
      timeSlotId: null,
      date: new Date('2030-08-01T00:00:00.000Z'),
      quantity: 2,
      ticketProduct: {
        attractionId: 'attraction-1',
        attraction: { openTime: '09:00', closeTime: '17:00' },
      },
    },
    ...overrides,
  };
}

function txFor(booking) {
  return {
    booking: {
      findUnique: jest.fn().mockResolvedValue(booking),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    ticketInstance: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    supportTicket: {
      create: jest.fn().mockResolvedValue({ id: 'support-1' }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.booking.findMany.mockResolvedValue([{ id: 'booking-1', userId: 'customer-1' }]);
  releaseHeldInventory.mockResolvedValue(true);
  resolveRecoveryFundingBooking.mockResolvedValue(null);
  enqueueBookingNotification.mockResolvedValue({ id: 'outbox-1' });
});

describe('operational suspension customer remediation', () => {
  test('cancels an unpaid future hold, releases stock and queues durable notification', async () => {
    const booking = futureBooking();
    const tx = txFor(booking);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const summary = await remediateSuspendedBookings({
      attractionIds: ['attraction-1'],
      reason: 'Địa điểm tạm đóng vì an toàn',
      actorId: 'admin-1',
      now: new Date('2026-07-29T00:00:00.000Z'),
    });

    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        refundRequired: false,
        cancellationSource: 'SYSTEM_SUSPENSION',
      }),
    }));
    expect(releaseHeldInventory).toHaveBeenCalledWith(
      tx,
      booking.reservation,
      { status: 'CANCELLED' },
    );
    expect(enqueueBookingNotification).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        bookingId: 'booking-1',
        topic: 'OPERATIONAL_CANCELLATION',
      }),
    );
    expect(summary).toEqual(expect.objectContaining({
      affected: 1,
      cancelled: 1,
      unpaidReleased: 1,
      needsAttention: 0,
    }));
  });

  test('does not auto-cancel a checked-in booking and opens an urgent staff case', async () => {
    const booking = futureBooking({
      status: 'CONFIRMED',
      ticketInstances: [{ id: 'ticket-instance-1', status: 'USED' }],
      reservation: {
        ...futureBooking().reservation,
        status: 'CONFIRMED',
      },
    });
    const tx = txFor(booking);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const summary = await remediateSuspendedBookings({
      attractionIds: ['attraction-1'],
      reason: 'Đình chỉ khẩn cấp',
      actorId: 'admin-1',
      now: new Date('2026-07-29T00:00:00.000Z'),
    });

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.supportTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        priority: 'URGENT',
        status: 'OPEN',
      }),
    });
    expect(summary).toEqual(expect.objectContaining({
      affected: 1,
      cancelled: 0,
      needsAttention: 1,
    }));
  });
});
