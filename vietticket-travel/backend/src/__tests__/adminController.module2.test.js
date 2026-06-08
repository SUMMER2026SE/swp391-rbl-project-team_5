jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendAccountStatusEmail: jest.fn().mockResolvedValue(),
  sendPartnerReviewEmail: jest.fn().mockResolvedValue(),
  sendAttractionViolationEmail: jest.fn().mockResolvedValue(),
}));

const mockPrisma = require('./helpers/mockPrisma');
const mailer = require('../utils/mailer');
const {
  getPartners,
  reviewPartner,
  reviewAttraction,
  hideAttraction,
} = require('../controllers/adminController');

afterEach(() => jest.clearAllMocks());

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('getPartners', () => {
  test('✅ Trả danh sách đối tác lọc theo status=PENDING', async () => {
    mockPrisma.partnerProfile.findMany.mockResolvedValue([
      { id: 'p-001', businessName: 'Cty A', status: 'PENDING', taxCode: '0102030405', createdAt: new Date() },
    ]);
    const req = { query: { status: 'PENDING' } };
    const res = createRes();
    await getPartners(req, res, jest.fn());

    expect(mockPrisma.partnerProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING' } }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('❌ Trả 400 khi status không hợp lệ', async () => {
    const req = { query: { status: 'WRONG' } };
    const res = createRes();
    await getPartners(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.partnerProfile.findMany).not.toHaveBeenCalled();
  });
});

describe('reviewPartner', () => {
  test('✅ APPROVED nâng quyền user lên PARTNER + gửi email', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-001', userId: 'user-001', businessName: 'Cty A', user: { email: 'a@x.com' } });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);
    const req = { params: { id: 'p-001' }, body: { action: 'APPROVED' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mailer.sendPartnerReviewEmail).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVED' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ REJECTED yêu cầu rejectionReason', async () => {
    const req = { params: { id: 'p-001' }, body: { action: 'REJECTED' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ REJECTED kèm lý do hợp lệ', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-001', userId: 'user-001', businessName: 'Cty A', user: { email: 'a@x.com' } });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);
    const req = { params: { id: 'p-001' }, body: { action: 'REJECTED', rejectionReason: 'Hồ sơ thiếu giấy phép' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Trả 400 khi action không hợp lệ', async () => {
    const req = { params: { id: 'p-001' }, body: { action: 'MAYBE' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 404 khi không tìm thấy đối tác', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    const req = { params: { id: 'p-x' }, body: { action: 'APPROVED' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reviewAttraction', () => {
  test('✅ APPROVED cập nhật trạng thái APPROVED', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001' });
    mockPrisma.attraction.update.mockResolvedValue({});
    const req = { params: { id: 'attr-001' }, body: { action: 'APPROVED' } };
    const res = createRes();
    await reviewAttraction(req, res, jest.fn());
    expect(mockPrisma.attraction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', rejectionReason: null }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ REJECTED yêu cầu lý do', async () => {
    const req = { params: { id: 'attr-001' }, body: { action: 'REJECTED' } };
    const res = createRes();
    await reviewAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 404 khi không tìm thấy địa điểm', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const req = { params: { id: 'attr-x' }, body: { action: 'APPROVED' } };
    const res = createRes();
    await reviewAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('hideAttraction', () => {
  test('✅ Ẩn địa điểm (SUSPENDED) + gửi email vi phạm', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001', title: 'Suối Tiên',
      partner: { businessName: 'Cty A', user: { email: 'a@x.com' } },
    });
    mockPrisma.attraction.update.mockResolvedValue({});
    const req = { params: { id: 'attr-001' }, body: { reason: 'Vé lậu trái phép' } };
    const res = createRes();
    await hideAttraction(req, res, jest.fn());

    expect(mockPrisma.attraction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'SUSPENDED' },
    }));
    expect(mailer.sendAttractionViolationEmail).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Trả 400 khi thiếu reason', async () => {
    const req = { params: { id: 'attr-001' }, body: {} };
    const res = createRes();
    await hideAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 404 khi không tìm thấy địa điểm', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const req = { params: { id: 'attr-x' }, body: { reason: 'x' } };
    const res = createRes();
    await hideAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
