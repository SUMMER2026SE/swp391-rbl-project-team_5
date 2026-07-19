jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { updateSettings, getDashboard } = require('../controllers/partnerController');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  mockPrisma.auditLog.create.mockResolvedValue({});
});

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const PARTNER = {
  id: 'partner-001',
  status: 'APPROVED',
  bankName: 'Vietcombank',
  branchName: 'HCM',
  bankAccountNumber: '0123456789',
  bankAccountName: 'NGUYEN VAN A',
  swiftCode: null,
  payoutCurrency: 'VND',
};

describe('updateSettings', () => {
  test('✅ Cập nhật thông tin hiển thị nhưng không sửa tên pháp lý', async () => {
    mockPrisma.partnerProfile.update.mockResolvedValue({
      ...PARTNER,
      businessName: 'Tên pháp lý',
      website: 'https://example.com',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-001', fullName: 'A', email: 'a@x.com', profile: {} });
    mockPrisma.user.update.mockResolvedValue({ id: 'user-001', fullName: 'B', email: 'a@x.com', profile: { phoneNumber: '0987654321' } });

    const req = {
      partner: PARTNER, user: { id: 'user-001' },
      headers: {},
      body: {
        displayName: 'Thương hiệu B',
        phone: '0987654321',
        website: 'https://example.com',
      },
    };
    const res = createRes();
    await updateSettings(req, res, jest.fn());

    expect(mockPrisma.partnerProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'partner-001' },
      data: expect.objectContaining({ website: 'https://example.com' }),
    }));
    expect(mockPrisma.partnerProfile.update.mock.calls[0][0].data)
      .not.toHaveProperty('businessName');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PARTNER_PROFILE_UPDATED',
        metadata: expect.objectContaining({
          changedFields: expect.arrayContaining(['website', 'fullName', 'phoneNumber']),
        }),
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ partner: expect.any(Object) }));
  });

  test('❌ Không cho đổi tên pháp lý qua API cài đặt', async () => {
    const req = { partner: PARTNER, user: { id: 'user-001' }, body: { businessName: '   ' } };
    const res = createRes();
    await updateSettings(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'KYC_CHANGE_REQUIRES_REVIEW',
      fields: ['businessName'],
    }));
  });

  test('❌ Trả 400 khi số điện thoại không hợp lệ', async () => {
    const req = { partner: PARTNER, user: { id: 'user-001' }, body: { phone: 'abc123' } };
    const res = createRes();
    await updateSettings(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('requires payout changes to go through KYC review', async () => {
    const req = {
      partner: PARTNER,
      user: { id: 'user-001' },
      body: { bankAccountNumber: '9876543210' },
    };
    const res = createRes();

    await updateSettings(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'KYC_CHANGE_REQUIRES_REVIEW',
      fields: ['bankAccountNumber'],
    }));
    expect(mockPrisma.partnerProfile.update).not.toHaveBeenCalled();
  });

  test('also blocks payout changes for OAuth accounts instead of bypassing reauthentication', async () => {
    const req = {
      partner: PARTNER,
      user: { id: 'user-001' },
      headers: {},
      body: {
        bankAccountNumber: '9876543210',
      },
    };
    const res = createRes();

    await updateSettings(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'KYC_CHANGE_REQUIRES_REVIEW',
    }));
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('getDashboard', () => {
  test('✅ Trả thống kê tổng quan từ dữ liệu thực', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      { id: 'attr-001', status: 'APPROVED', publicationStatus: 'ACTIVE' },
      { id: 'attr-002', status: 'DRAFT', publicationStatus: 'PAUSED' },
    ]);
    mockPrisma.ticketProduct.count.mockResolvedValue(5);
    mockPrisma.booking.findMany.mockResolvedValue([]);

    const req = { partner: PARTNER };
    const res = createRes();
    await getDashboard(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      stats: expect.objectContaining({
        totalAttractions: 2,
        activeAttractions: 1,
        totalTickets: 5,
      }),
      partnerStatus: 'APPROVED',
    }));
  });

  test('✅ Không gọi count khi partner chưa có attraction nào', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);
    mockPrisma.booking.findMany.mockResolvedValue([]);
    const req = { partner: PARTNER };
    const res = createRes();
    await getDashboard(req, res, jest.fn());
    expect(mockPrisma.ticketProduct.count).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      stats: expect.objectContaining({ totalAttractions: 0, totalTickets: 0 }),
    }));
  });
});
