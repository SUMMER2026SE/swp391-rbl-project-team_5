jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendRefundStatusEmail: jest.fn().mockResolvedValue({ sent: true }),
  sendReissueTicketEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

const prisma = require('./helpers/mockPrisma');
const {
  sendRefundStatusEmail,
  sendReissueTicketEmail,
} = require('../utils/mailer');
const {
  listRefundRequests,
  processRefundRequest,
  reissueTicket,
} = require('../controllers/staffController');

function makeReqRes(overrides = {}) {
  const req = {
    user: { id: 'staff-1' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

function refundFixture(overrides = {}) {
  return {
    id: 'refund-1',
    bookingId: 'booking-1',
    amount: 90000,
    status: 'PENDING',
    booking: {
      id: 'booking-1',
      status: 'REFUND_REQUESTED',
      user: { fullName: 'Nguyen Van A', email: 'a@example.com' },
      reservation: {
        id: 'reservation-1',
        ticketProductId: 'ticket-1',
        timeSlotId: null,
        date: new Date('2026-06-10T00:00:00.000Z'),
        quantity: 1,
        status: 'CONFIRMED',
        ticketProduct: {
          refundPolicy: 'REFUND_WITH_FEE',
          refundFeeRate: 0.1,
        },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listRefundRequests', () => {
  test('returns 400 for an invalid status filter', async () => {
    const { req, res, next } = makeReqRes({ query: { status: 'UNKNOWN' } });

    await listRefundRequests(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.refundRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('processRefundRequest', () => {
  test('approves a pending request and releases inventory', async () => {
    const request = refundFixture();
    const tx = {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue({
          ...request,
          status: 'APPROVED',
        }),
      },
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn() },
      reservation: { update: jest.fn().mockResolvedValue({}) },
      ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      booking: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(tx.dailyStock.updateMany).toHaveBeenCalled();
    expect(tx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking-1' },
      data: { status: 'REFUNDED' },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(sendRefundStatusEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an already processed request', async () => {
    const tx = {
      refundRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValue(refundFixture({ status: 'APPROVED' })),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      params: { refundId: 'refund-1' },
      body: { action: 'REJECTED' },
    });

    await processRefundRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('reissueTicket', () => {
  test('expires valid tickets and creates replacement tokens', async () => {
    const oldTicket = {
      id: 'ticket-instance-1',
      ticketProductId: 'ticket-product-1',
      status: 'VALID',
    };
    const tx = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: 'CONFIRMED',
          user: { fullName: 'Nguyen Van A', email: 'a@example.com' },
          ticketInstances: [oldTicket],
        }),
      },
      ticketInstance: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: 'ticket-instance-2',
          ticketProductId: 'ticket-product-1',
          status: 'VALID',
        }),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      params: { bookingId: 'booking-1' },
    });

    await reissueTicket(req, res, next);

    expect(tx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking-1', status: 'VALID' },
      data: { status: 'EXPIRED' },
    });
    expect(tx.ticketInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        ticketProductId: 'ticket-product-1',
        qrCodeToken: expect.any(String),
        status: 'VALID',
      }),
    });
    expect(sendReissueTicketEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
