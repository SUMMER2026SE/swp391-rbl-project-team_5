jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({}));

const prisma = require('./helpers/mockPrisma');
const {
  changePartnerCommissionRate,
  getFinancialTransactions,
} = require('../controllers/adminController');

function makeReqRes({ body = {}, query = {}, params = {} } = {}) {
  const req = {
    body,
    query,
    params,
    headers: {},
    user: { id: 'admin-1', role: 'ADMIN' },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

afterEach(() => jest.clearAllMocks());

describe('admin financial controller', () => {
  test('updates future commission rate and writes an audit log', async () => {
    prisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'partner-1',
      businessName: 'Museum Partner',
      commissionRate: 0.1,
    });
    const tx = {
      partnerProfile: {
        update: jest.fn().mockResolvedValue({
          id: 'partner-1',
          businessName: 'Museum Partner',
          status: 'APPROVED',
          commissionRate: 0.15,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      params: { id: 'partner-1' },
      body: { commissionRatePercent: 15 },
    });

    await changePartnerCommissionRate(req, res, next);

    expect(tx.partnerProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'partner-1' },
      data: { commissionRate: 0.15 },
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: 'admin-1',
        action: 'PARTNER_COMMISSION_RATE_CHANGED',
        metadata: expect.objectContaining({
          previousRate: 0.1,
          commissionRate: 0.15,
          appliesTo: 'FUTURE_BOOKINGS_ONLY',
        }),
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ commissionRatePercent: 15 }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test.each([null, '', '12.5', -1, 101])(
    'rejects invalid commission rate %p',
    async (commissionRatePercent) => {
      const { req, res, next } = makeReqRes({
        params: { id: 'partner-1' },
        body: { commissionRatePercent },
      });

      await changePartnerCommissionRate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.partnerProfile.findUnique).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    },
  );

  test('rejects unsupported transaction status before querying the ledger', async () => {
    const { req, res, next } = makeReqRes({
      query: { status: 'REFUNDED' },
    });

    await getFinancialTransactions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(prisma.refundTransaction.findMany).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
