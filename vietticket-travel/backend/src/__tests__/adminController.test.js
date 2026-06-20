jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendAccountStatusEmail: jest.fn(),
  sendPartnerReviewEmail: jest.fn(),
  sendAttractionReviewEmail: jest.fn(),
  sendAttractionViolationEmail: jest.fn(),
}));

const mockPrisma = require('./helpers/mockPrisma');
const { changeUserStatus, getAttractions } = require('../controllers/adminController');

afterEach(() => jest.clearAllMocks());

describe('changeUserStatus', () => {
  function createRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
  }

  test('khoa user, tang tokenVersion va thu hoi session dang mo', async () => {
    const targetUser = {
      id: 'user-001',
      email: 'customer@example.com',
      fullName: 'Customer A',
      role: 'CUSTOMER',
      provider: 'LOCAL',
      isEmailVerified: true,
      status: 'ACTIVE',
      tokenVersion: 0,
      profile: null,
    };
    const updatedUser = { ...targetUser, status: 'LOCKED', tokenVersion: 1 };
    const tx = {
      user: { update: jest.fn().mockResolvedValue(updatedUser) },
      authSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    mockPrisma.user.findUnique.mockResolvedValue(targetUser);
    mockPrisma.$transaction.mockImplementation((cb) => cb(tx));

    const req = {
      params: { id: targetUser.id },
      body: { status: 'LOCKED', reason: 'Vi pham', sendEmail: false },
      user: { id: 'admin-001', role: 'ADMIN' },
    };
    const res = createRes();
    const next = jest.fn();

    await changeUserStatus(req, res, next);

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: targetUser.id },
      data: expect.objectContaining({
        status: 'LOCKED',
        tokenVersion: { increment: 1 },
      }),
    }));
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: targetUser.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ id: targetUser.id, status: 'LOCKED' }),
    }));
  });

  test('khong cho admin tu khoa chinh minh', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-001',
      email: 'admin@example.com',
      fullName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      profile: null,
    });

    const req = {
      params: { id: 'admin-001' },
      body: { status: 'LOCKED' },
      user: { id: 'admin-001', role: 'ADMIN' },
    };
    const res = createRes();

    await changeUserStatus(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('getAttractions', () => {
  test('trả danh sách attraction cho trang Admin với dữ liệu đã map', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      {
        id: 'attr-001',
        title: 'Suối Tiên',
        description: 'Khu vui chơi',
        address: '120 Xa lộ Hà Nội',
        city: 'TP. HCM',
        status: 'PENDING',
        rejectionReason: null,
        averageRating: 4.5,
        totalReviews: 10,
        createdAt: new Date('2026-06-07T00:00:00.000Z'),
        partner: { id: 'partner-001', businessName: 'VietTicket Partner' },
        images: [{ imageUrl: 'https://example.com/image.jpg' }],
        categories: [{ category: { id: 'cat-001', name: 'Theme Park' } }],
        ticketProducts: [{ sellingPrice: 120000 }],
      },
    ]);
    mockPrisma.attraction.count.mockResolvedValue(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));

    const req = { query: { status: 'PENDING' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAttractions(req, res, next);

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', archivedAt: null },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [
        expect.objectContaining({
          id: 'attr-001',
          primaryImage: 'https://example.com/image.jpg',
          minPrice: 120000,
        }),
      ],
      pagination: expect.objectContaining({ total: 1 }),
    }));
  });

  test('từ chối status không hợp lệ', async () => {
    const req = { query: { status: 'HIDDEN' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAttractions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.attraction.findMany).not.toHaveBeenCalled();
  });
});
