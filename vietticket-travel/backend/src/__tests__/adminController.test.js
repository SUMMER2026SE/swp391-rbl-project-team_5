jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendAccountStatusEmail: jest.fn(),
  sendPartnerReviewEmail: jest.fn(),
  sendAttractionReviewEmail: jest.fn(),
  sendAttractionViolationEmail: jest.fn(),
  sendAttractionRestoredEmail: jest.fn(),
  sendPartnerOperationalStatusEmail: jest.fn(),
  sendStaffInviteEmail: jest.fn().mockResolvedValue(),
}));

const mockPrisma = require('./helpers/mockPrisma');
const {
  changeUserStatus,
  createPlatformStaff,
  getAttractions,
  getAuditLogs,
} = require('../controllers/adminController');

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
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.user.findUnique.mockResolvedValue(targetUser);
    mockPrisma.$transaction.mockImplementation((cb) => cb(tx));

    const req = {
      params: { id: targetUser.id },
      body: { status: 'LOCKED', reason: 'Vi pham nghiem trong', sendEmail: false },
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
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'USER_ACCOUNT_LOCKED',
        actorId: 'admin-001',
        entityId: targetUser.id,
      }),
    }));
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

  test('does not allow locking the final active administrator', async () => {
    const targetAdmin = {
      id: 'admin-002',
      email: 'second-admin@example.com',
      fullName: 'Second Admin',
      role: 'ADMIN',
      roleMemberships: [{ role: 'ADMIN' }],
      status: 'ACTIVE',
      tokenVersion: 0,
      profile: null,
    };
    const tx = {
      user: {
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn(),
      },
      authSession: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.user.findUnique.mockResolvedValue(targetAdmin);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const next = jest.fn();

    await changeUserStatus({
      params: { id: targetAdmin.id },
      body: { status: 'LOCKED', reason: 'Khoa tai khoan quan tri thu nghiem' },
      user: { id: 'admin-001', role: 'ADMIN' },
    }, createRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(tx.user.update).not.toHaveBeenCalled();
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

describe('platform operations', () => {
  function createRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
  }

  test('creates an unassigned platform staff account with an expiring invite and audit log', async () => {
    const created = {
      id: 'staff-platform-1',
      fullName: 'Nguyen Van Ho Tro',
      email: 'support@vietticket.test',
      role: 'STAFF',
      roleMemberships: [{ role: 'STAFF' }],
      employerPartnerId: null,
      provider: 'LOCAL',
      status: 'ACTIVE',
      isEmailVerified: true,
      passwordHash: null,
      profile: { phoneNumber: '0901234567' },
    };
    const tx = {
      user: { create: jest.fn().mockResolvedValue(created) },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await createPlatformStaff({
      body: {
        fullName: 'Nguyen Van Ho Tro',
        email: 'SUPPORT@VIETTICKET.TEST',
        phoneNumber: '0901234567',
      },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'support@vietticket.test',
        role: 'STAFF',
        employerPartnerId: null,
        passwordHash: null,
      }),
    }));
    expect(tx.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: created.id,
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: 'admin-1',
        action: 'PLATFORM_STAFF_CREATED',
        entityId: created.id,
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('lists audit logs with server-side pagination and actor search', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));
    const res = createRes();

    await getAuditLogs({
      query: { search: 'admin', entityType: 'user', page: '1', limit: '25' },
    }, res, jest.fn());

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        entityType: { in: ['USER', 'User'] },
        OR: expect.any(Array),
      }),
      take: 25,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ id: 'log-1' }],
      pagination: expect.objectContaining({ total: 1, totalPages: 1 }),
    }));
  });
});
