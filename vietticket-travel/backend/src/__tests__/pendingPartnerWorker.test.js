jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../realtime/events', () => ({
  emitBookingStatusUpdated: jest.fn(),
}));
jest.mock('../utils/mailer', () => ({
  sendHoldExpiredEmail: jest.fn().mockResolvedValue(),
  sendPendingApprovalExpiredEmail: jest.fn().mockResolvedValue(),
}));

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { emitBookingStatusUpdated } = require('../realtime/events');
const { sendPendingApprovalExpiredEmail } = require('../utils/mailer');
const {
  sweepExpiredPartnerApprovals,
} = require('../utils/pendingPartnerWorker');

function makeExpiredBooking() {
  return {
    id: 'booking-expired',
    userId: 'user-1',
    voucherId: 'voucher-1',
    email: 'customer@example.com',
    fullName: 'Nguyễn Văn A',
    status: 'PENDING_PARTNER',
    totalAmount: 250000,
    payments: [{
      id: 'payment-1',
      status: 'SUCCESS',
      isDuplicate: false,
      paymentGateway: 'VNPAY',
      amount: 250000,
      paidAt: new Date('2026-07-09T08:00:00.000Z'),
      createdAt: new Date('2026-07-09T08:00:00.000Z'),
    }],
    refundRequests: [],
    reservation: {
      id: 'reservation-1',
      ticketProductId: 'ticket-1',
      timeSlotId: 'slot-1',
      date: new Date('2026-07-10T00:00:00.000Z'),
      quantity: 2,
      status: 'CONFIRMED',
      timeSlot: { startTime: '08:00', endTime: '10:00' },
      ticketProduct: {
        attractionId: 'attraction-1',
        attraction: { openTime: '08:00', closeTime: '17:00' },
      },
    },
  };
}

function makeTx(booking = makeExpiredBooking()) {
  return {
    booking: {
      findUnique: jest.fn().mockResolvedValue(booking),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    reservation: { update: jest.fn().mockResolvedValue({}) },
    voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    refundRequest: {
      upsert: jest.fn().mockResolvedValue({ id: 'refund-1', status: 'PROCESSING' }),
      update: jest.fn(),
    },
    refundTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'refund-tx-1', status: 'PENDING' }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('hủy đơn quá 24 giờ, hoàn kho và tạo yêu cầu hoàn 100%', async () => {
  const tx = makeTx();
  prisma.booking.findMany.mockResolvedValue([{ id: 'booking-expired' }]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  const now = new Date('2026-07-11T12:00:00.000Z');
  const count = await sweepExpiredPartnerApprovals({ now });

  expect(count).toBe(1);
  expect(prisma.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ status: 'PENDING_PARTNER' }),
  }));
  expect(tx.booking.updateMany).toHaveBeenCalledWith({
    where: { id: 'booking-expired', status: 'PENDING_PARTNER' },
    data: expect.objectContaining({
      status: 'CANCELLED',
      refundRequired: true,
      cancellationSource: 'SYSTEM_APPROVAL_TIMEOUT',
    }),
  });
  expect(tx.dailyStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: { bookedQuantity: { decrement: 2 } },
  }));
  expect(tx.refundRequest.upsert).toHaveBeenCalledWith({
    where: { requestKey: 'mandatory:SYSTEM_CANCELLATION:booking-expired' },
    update: {},
    create: expect.objectContaining({
      bookingId: 'booking-expired',
      amount: 250000,
      status: 'PROCESSING',
      type: 'SYSTEM_CANCELLATION',
      mandatory: true,
    }),
  });
  expect(tx.refundTransaction.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      bookingId: 'booking-expired',
      paymentId: 'payment-1',
      refundRequestId: 'refund-1',
      status: 'PENDING',
    }),
  });
  expect(tx.voucher.updateMany).toHaveBeenCalled();
  expect(emitBookingStatusUpdated).toHaveBeenCalledWith(expect.objectContaining({
    status: 'CANCELLED',
  }));
  expect(sendPendingApprovalExpiredEmail).toHaveBeenCalled();
  expect(prisma.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  expect(prisma.booking.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
    take: 200,
    where: expect.objectContaining({
      payments: { some: { status: 'SUCCESS', isDuplicate: false } },
    }),
  }));
});

test('bỏ qua an toàn nếu partner đã xử lý đơn trước khi worker claim', async () => {
  const tx = makeTx({ ...makeExpiredBooking(), status: 'CONFIRMED' });
  prisma.booking.findMany.mockResolvedValue([{ id: 'booking-expired' }]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepExpiredPartnerApprovals()).resolves.toBe(0);
  expect(tx.booking.updateMany).not.toHaveBeenCalled();
  expect(tx.refundRequest.upsert).not.toHaveBeenCalled();
});
