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
