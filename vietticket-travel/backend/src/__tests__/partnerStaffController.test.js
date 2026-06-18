jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendStaffInviteEmail: jest.fn().mockResolvedValue({ sent: true }),
  sendAccountStatusEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

const prisma = require('./helpers/mockPrisma');
const { sendStaffInviteEmail, sendAccountStatusEmail } = require('../utils/mailer');
const {
  listStaff,
  createStaff,
  changeStaffStatus,
  replaceStaffAssignments,
} = require('../controllers/partnerStaffController');

function makeReqRes(overrides = {}) {
  const req = {
    user: { id: 'partner-user-1' },
    // req.partner do middleware requirePartner gắn vào.
    partner: { id: 'partner-1', businessName: 'Đối tác A' },
    params: {},
    query: {},
    body: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

function staffFixture(overrides = {}) {
  return {
    id: 'staff-1',
    email: 'nv1@example.com',
    fullName: 'Nguyen Van A',
    role: 'STAFF',
    status: 'ACTIVE',
    passwordHash: 'hashed',
    employerPartnerId: 'partner-1',
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    profile: { phoneNumber: '0901234567' },
    staffAssignments: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listStaff', () => {
  test('chỉ truy vấn nhân viên của đối tác đang đăng nhập', async () => {
    prisma.user.findMany.mockResolvedValue([staffFixture()]);
    const { req, res, next } = makeReqRes();

    await listStaff(req, res, next);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'STAFF', employerPartnerId: 'partner-1' },
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});

describe('createStaff', () => {
  test('tạo nhân viên thuộc đối tác và gửi email mời', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // email chưa dùng
    const tx = {
      user: { create: jest.fn().mockResolvedValue(staffFixture({ passwordHash: null })) },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const { req, res, next } = makeReqRes({
      body: { fullName: 'Nguyen Van A', email: 'nv1@example.com', phoneNumber: '0901234567' },
    });

    await createStaff(req, res, next);

    // Nhân viên được tạo với employerPartnerId của đối tác hiện tại.
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'STAFF',
          employerPartnerId: 'partner-1',
          passwordHash: null,
        }),
      }),
    );
    expect(sendStaffInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'nv1@example.com' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('trả 409 khi email đã được dùng', async () => {
    prisma.user.findUnique.mockResolvedValue(staffFixture());
    const { req, res, next } = makeReqRes({
      body: { fullName: 'Nguyen Van A', email: 'nv1@example.com' },
    });

    await createStaff(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sendStaffInviteEmail).not.toHaveBeenCalled();
  });

  test('trả 400 khi email không hợp lệ', async () => {
    const { req, res, next } = makeReqRes({
      body: { fullName: 'Nguyen Van A', email: 'khong-hop-le' },
    });

    await createStaff(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('changeStaffStatus', () => {
  test('không cho đổi trạng thái nhân viên của đối tác khác (404)', async () => {
    // Nhân viên thuộc đối tác KHÁC -> findOwnedStaff trả null.
    prisma.user.findUnique.mockResolvedValue(staffFixture({ employerPartnerId: 'partner-2' }));
    const { req, res, next } = makeReqRes({
      params: { staffId: 'staff-1' },
      body: { status: 'LOCKED' },
    });

    await changeStaffStatus(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('khóa nhân viên: tăng tokenVersion và thu hồi phiên đăng nhập', async () => {
    prisma.user.findUnique.mockResolvedValue(staffFixture({ status: 'ACTIVE' }));
    const tx = {
      user: { update: jest.fn().mockResolvedValue({}) },
      authSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const { req, res, next } = makeReqRes({
      params: { staffId: 'staff-1' },
      body: { status: 'LOCKED' },
    });

    await changeStaffStatus(req, res, next);

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'staff-1' },
        data: expect.objectContaining({ status: 'LOCKED', tokenVersion: { increment: 1 } }),
      }),
    );
    expect(tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'staff-1', revokedAt: null } }),
    );
    expect(sendAccountStatusEmail).toHaveBeenCalled();
  });
});

describe('replaceStaffAssignments', () => {
  test('từ chối (404) khi nhân viên thuộc đối tác khác', async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(staffFixture({ employerPartnerId: 'partner-2' })) },
      attraction: { count: jest.fn() },
      staffAttractionAssignment: { updateMany: jest.fn(), upsert: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const { req, res, next } = makeReqRes({
      params: { staffId: 'staff-1' },
      body: { attractionIds: ['attr-1'] },
    });

    await replaceStaffAssignments(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(tx.attraction.count).not.toHaveBeenCalled();
    expect(tx.staffAttractionAssignment.upsert).not.toHaveBeenCalled();
  });

  test('từ chối (400) khi địa điểm không thuộc đối tác', async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(staffFixture()) },
      // Chỉ 1/2 địa điểm thuộc đối tác -> count != length -> chặn.
      attraction: { count: jest.fn().mockResolvedValue(1) },
      staffAttractionAssignment: { updateMany: jest.fn(), upsert: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const { req, res, next } = makeReqRes({
      params: { staffId: 'staff-1' },
      body: { attractionIds: ['attr-1', 'attr-khac'] },
    });

    await replaceStaffAssignments(req, res, next);

    expect(tx.attraction.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ partnerId: 'partner-1', archivedAt: null }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(tx.staffAttractionAssignment.upsert).not.toHaveBeenCalled();
  });

  test('phân công thành công địa điểm hợp lệ của đối tác', async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(staffFixture()) },
      attraction: { count: jest.fn().mockResolvedValue(2) },
      staffAttractionAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const { req, res, next } = makeReqRes({
      params: { staffId: 'staff-1' },
      body: { attractionIds: ['attr-1', 'attr-2'] },
    });

    await replaceStaffAssignments(req, res, next);

    expect(tx.staffAttractionAssignment.upsert).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
