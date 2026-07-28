jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  createSettlement,
  updateSettlementStatus,
} = require('../controllers/settlementController');

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('partner settlement ledger', () => {
  test('creates immutable booking lines from recognized amounts', async () => {
    prisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'partner-1',
      businessName: 'Partner One',
      status: 'APPROVED',
      bankName: 'Vietcombank',
      bankAccountName: 'PARTNER ONE',
      bankAccountNumber: '0123456789',
      payoutCurrency: 'VND',
    });
    const booking = {
      id: 'booking-1',
      status: 'COMPLETED',
      snapshotVisitDate: new Date('2026-07-01T00:00:00.000Z'),
      commissionRateSnapshot: 0.1,
      commissionAmountSnapshot: 10000,
      partnerNetAmountSnapshot: 90000,
      payments: [{ amount: 100000 }],
      refundTransactions: [],
    };
    const created = {
      id: 'settlement-1',
      partnerId: 'partner-1',
      status: 'DRAFT',
      grossAmount: 100000,
      refundAmount: 0,
      netAmount: 100000,
      commissionAmount: 10000,
      payableAmount: 90000,
      bookingCount: 1,
    };
    const tx = {
      booking: { findMany: jest.fn().mockResolvedValue([booking]) },
      partnerSettlement: {
        create: jest.fn().mockResolvedValue(created),
        findUnique: jest.fn().mockResolvedValue({ ...created, items: [] }),
      },
      partnerSettlementItem: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await createSettlement({
      body: {
        partnerId: 'partner-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
      },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(tx.partnerSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerId: 'partner-1',
        grossAmount: 100000,
        commissionAmount: 10000,
        payableAmount: 90000,
        bookingCount: 1,
        bankAccountLast4Snapshot: '6789',
      }),
    });
    expect(tx.partnerSettlementItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        settlementId: 'settlement-1',
        bookingId: 'booking-1',
        payableAmount: 90000,
      })],
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PARTNER_SETTLEMENT_CREATED',
        actorId: 'admin-1',
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('settles only the Rescue target net of a funding-ledger refund', async () => {
    prisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'partner-1',
      businessName: 'Partner One',
      status: 'APPROVED',
      bankName: 'Vietcombank',
      bankAccountName: 'PARTNER ONE',
      bankAccountNumber: '0123456789',
      payoutCurrency: 'VND',
    });
    const displacedSource = {
      id: 'booking-root-100',
      status: 'REFUNDED',
      snapshotVisitDate: new Date('2026-07-01T00:00:00.000Z'),
      recoveryCaseAsOriginal: { id: 'rescue-case-1', status: 'REPLACED' },
      commissionRateSnapshot: 0.1,
      commissionAmountSnapshot: 10000,
      partnerNetAmountSnapshot: 90000,
      payments: [{ amount: 100000 }],
      refundTransactions: [{
        id: 'refund-difference-20',
        status: 'SUCCESS',
        amount: 20000,
        refundRequest: { type: 'PARTNER_CANCELLATION' },
      }],
      refundRequestsTargeting: [{
        type: 'PARTNER_CANCELLATION',
        refundTransactions: [{
          id: 'refund-difference-20',
          status: 'SUCCESS',
          amount: 20000,
        }],
      }],
    };
    const replacement = {
      id: 'booking-replacement-80',
      status: 'REFUNDED',
      snapshotVisitDate: new Date('2026-07-01T00:00:00.000Z'),
      recoveryCaseAsOriginal: null,
      commissionRateSnapshot: 0.1,
      commissionAmountSnapshot: 8000,
      partnerNetAmountSnapshot: 72000,
      payments: [{ amount: 80000 }],
      refundTransactions: [],
      refundRequestsTargeting: [{
        type: 'CUSTOMER_CANCELLATION',
        refundTransactions: [{
          id: 'refund-target-40',
          status: 'SUCCESS',
          amount: 40000,
        }],
      }],
    };
    const created = {
      id: 'settlement-rescue',
      partnerId: 'partner-1',
      status: 'DRAFT',
      grossAmount: 80000,
      refundAmount: 40000,
      netAmount: 40000,
      commissionAmount: 4000,
      payableAmount: 36000,
      bookingCount: 1,
    };
    const tx = {
      // The first row is deliberately returned despite the where clause so
      // the amount calculator independently prevents a double payout.
      booking: {
        findMany: jest.fn().mockResolvedValue([displacedSource, replacement]),
      },
      partnerSettlement: {
        create: jest.fn().mockResolvedValue(created),
        findUnique: jest.fn().mockResolvedValue({ ...created, items: [] }),
      },
      partnerSettlementItem: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await createSettlement({
      body: {
        partnerId: 'partner-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
      },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(tx.booking.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        recoveryCaseAsOriginal: { is: null },
      }),
    );
    expect(tx.booking.findMany.mock.calls[0][0].select).toEqual(
      expect.objectContaining({
        refundRequestsTargeting: expect.any(Object),
      }),
    );
    expect(tx.partnerSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grossAmount: 80000,
        refundAmount: 40000,
        netAmount: 40000,
        commissionAmount: 4000,
        payableAmount: 36000,
        bookingCount: 1,
      }),
    });
    expect(tx.partnerSettlementItem.createMany).toHaveBeenCalledWith({
      data: [{
        settlementId: 'settlement-rescue',
        bookingId: 'booking-replacement-80',
        grossAmount: 80000,
        refundAmount: 40000,
        netAmount: 40000,
        commissionAmount: 4000,
        payableAmount: 36000,
      }],
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('does not create a payable line after a free Rescue cancellation', async () => {
    prisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'partner-1',
      businessName: 'Partner One',
      status: 'APPROVED',
      bankName: 'Vietcombank',
      bankAccountName: 'PARTNER ONE',
      bankAccountNumber: '0123456789',
      payoutCurrency: 'VND',
    });
    const tx = {
      booking: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'booking-replacement-80',
          status: 'REFUNDED',
          snapshotVisitDate: new Date('2026-07-01T00:00:00.000Z'),
          recoveryCaseAsOriginal: null,
          commissionRateSnapshot: 0.1,
          commissionAmountSnapshot: 8000,
          partnerNetAmountSnapshot: 72000,
          payments: [{ amount: 80000 }],
          refundTransactions: [],
          refundRequestsTargeting: [{
            type: 'CUSTOMER_CANCELLATION',
            refundTransactions: [{
              id: 'refund-target-80',
              status: 'SUCCESS',
              amount: 80000,
            }],
          }],
        }]),
      },
      partnerSettlement: {
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await createSettlement({
      body: {
        partnerId: 'partner-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
      },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.partnerSettlement.create).not.toHaveBeenCalled();
  });

  test('cancels only an eligible settlement and releases its booking lines', async () => {
    prisma.partnerSettlement.findUnique.mockResolvedValue({
      id: 'settlement-1',
      status: 'APPROVED',
    });
    const updated = {
      id: 'settlement-1',
      status: 'CANCELLED',
      grossAmount: 100000,
      refundAmount: 0,
      netAmount: 100000,
      commissionAmount: 10000,
      payableAmount: 90000,
    };
    const tx = {
      partnerSettlement: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(updated),
      },
      partnerSettlementItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await updateSettlementStatus({
      params: { id: 'settlement-1' },
      body: {
        status: 'CANCELLED',
        reason: 'Sai thông tin kỳ đối soát',
      },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(tx.partnerSettlementItem.updateMany).toHaveBeenCalledWith({
      where: { settlementId: 'settlement-1', releasedAt: null },
      data: { releasedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PARTNER_SETTLEMENT_CANCELLED',
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });

  test('does not allow marking a draft settlement paid directly', async () => {
    prisma.partnerSettlement.findUnique.mockResolvedValue({
      id: 'settlement-1',
      status: 'DRAFT',
    });
    const res = createRes();

    await updateSettlementStatus({
      params: { id: 'settlement-1' },
      body: { status: 'PAID', bankReference: 'FT-12345' },
      user: { id: 'admin-1' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
