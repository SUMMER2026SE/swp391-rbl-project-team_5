jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { updateSettings, getDashboard } = require('../controllers/partnerController');

afterEach(() => jest.clearAllMocks());

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const PARTNER = { id: 'partner-001', status: 'APPROVED' };

describe('updateSettings', () => {
  test('✅ Cập nhật thông tin doanh nghiệp + tài khoản', async () => {
    mockPrisma.partnerProfile.update.mockResolvedValue({ id: 'partner-001', businessName: 'Tên mới', status: 'APPROVED' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-001', fullName: 'A', email: 'a@x.com', profile: {} });
    mockPrisma.user.update.mockResolvedValue({ id: 'user-001', fullName: 'B', email: 'a@x.com', profile: { phoneNumber: '0987654321' } });

    const req = {
      partner: PARTNER, user: { id: 'user-001' },
      body: { businessName: 'Tên mới', displayName: 'B', phone: '0987654321' },
    };
    const res = createRes();
    await updateSettings(req, res, jest.fn());

    expect(mockPrisma.partnerProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'partner-001' },
      data: expect.objectContaining({ businessName: 'Tên mới' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ partner: expect.any(Object) }));
  });

  test('❌ Trả 400 khi businessName rỗng', async () => {
    const req = { partner: PARTNER, user: { id: 'user-001' }, body: { businessName: '   ' } };
    const res = createRes();
    await updateSettings(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi số điện thoại không hợp lệ', async () => {
    const req = { partner: PARTNER, user: { id: 'user-001' }, body: { phone: 'abc123' } };
    const res = createRes();
    await updateSettings(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('getDashboard', () => {
  test('✅ Trả thống kê tổng quan từ dữ liệu thực', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      { id: 'attr-001', status: 'APPROVED' },
      { id: 'attr-002', status: 'DRAFT' },
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
