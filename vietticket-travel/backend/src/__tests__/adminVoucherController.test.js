jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({}));

const prisma = require('./helpers/mockPrisma');
const {
  createVoucher,
  listVouchers,
  updateVoucher,
} = require('../controllers/adminController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function voucher(overrides = {}) {
  return {
    id: 'voucher-001',
    code: 'WELCOME10',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    maxDiscount: 50_000,
    minSpend: 200_000,
    expiryDate: new Date(Date.now() + 86_400_000),
    isActive: true,
    usageLimit: 100,
    usedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockReset();
});

describe('admin voucher management', () => {
  test('lists vouchers with pagination and computed operational status', async () => {
    prisma.voucher.findMany.mockResolvedValue([voucher()]);
    prisma.voucher.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((operations) => Promise.all(operations));
    const res = response();

    await listVouchers(
      { query: { page: '1', limit: '20', search: 'welcome' } },
      res,
      jest.fn(),
    );

    expect(prisma.voucher.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: { contains: 'WELCOME', mode: 'insensitive' } },
      skip: 0,
      take: 20,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        code: 'WELCOME10',
        operationalStatus: 'ACTIVE',
      })],
      pagination: expect.objectContaining({ total: 1, totalPages: 1 }),
    }));
  });

  test('rejects percentage values above 100 before touching the database', async () => {
    const res = response();

    await createVoucher(
      {
        body: {
          code: 'INVALID101',
          discountType: 'PERCENTAGE',
          discountValue: 101,
          expiryDate: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('creates a normalized voucher and writes an audit log atomically', async () => {
    const created = voucher();
    const tx = {
      voucher: { create: jest.fn().mockResolvedValue(created) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = response();

    await createVoucher(
      {
        body: {
          code: ' welcome10 ',
          discountType: 'percentage',
          discountValue: 10,
          maxDiscount: 50_000,
          minSpend: 200_000,
          usageLimit: 100,
          expiryDate: new Date(Date.now() + 86_400_000).toISOString(),
          isActive: true,
        },
        user: { id: 'admin-001' },
        headers: {},
      },
      res,
      jest.fn(),
    );

    expect(tx.voucher.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'WELCOME10',
        discountType: 'PERCENTAGE',
        discountValue: 10,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-001',
        action: 'VOUCHER_CREATED',
        entityType: 'VOUCHER',
        entityId: created.id,
      }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('does not allow financial terms to change after a voucher was used', async () => {
    prisma.voucher.findUnique.mockResolvedValue(voucher({ usedCount: 1 }));
    const res = response();

    await updateVoucher(
      {
        params: { id: 'voucher-001' },
        body: { discountValue: 20 },
      },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('requires a new value when changing the discount type', async () => {
    prisma.voucher.findUnique.mockResolvedValue(voucher());
    const res = response();

    await updateVoucher(
      {
        params: { id: 'voucher-001' },
        body: { discountType: 'FIXED' },
      },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Cần nhập lại giá trị giảm khi thay đổi loại voucher.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('requires a new value when changing the discount type', async () => {
    prisma.voucher.findUnique.mockResolvedValue(voucher());
    const res = response();

    await updateVoucher(
      {
        params: { id: 'voucher-001' },
        body: { discountType: 'FIXED' },
      },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Cần nhập lại giá trị giảm khi thay đổi loại voucher.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
