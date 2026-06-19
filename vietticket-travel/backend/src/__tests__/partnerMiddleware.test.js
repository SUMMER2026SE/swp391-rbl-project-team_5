jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const {
  requirePartner,
  requireApprovedPartner,
  requireActiveEmployer,
} = require('../middleware/partnerMiddleware');

afterEach(() => jest.clearAllMocks());

describe('partner middleware', () => {
  test('requirePartner nạp hồ sơ PENDING để trang trạng thái có thể đọc', async () => {
    const partner = { id: 'partner-001', status: 'PENDING' };
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(partner);
    const req = { user: { id: 'user-001' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requirePartner(req, res, next);

    expect(req.partner).toEqual(partner);
    expect(next).toHaveBeenCalled();
  });

  test('requireApprovedPartner chặn hồ sơ chưa được duyệt', () => {
    const req = { partner: { id: 'partner-001', status: 'REJECTED' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireApprovedPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('requireApprovedPartner cho phép hồ sơ APPROVED', () => {
    const req = { partner: { id: 'partner-001', status: 'APPROVED' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireApprovedPartner(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  describe('requireActiveEmployer', () => {
    test('chặn nhân viên khi đối tác chủ quản bị đình chỉ (SUSPENDED)', async () => {
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
      const req = { user: { id: 'staff-001', role: 'STAFF', employerPartnerId: 'partner-001' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireActiveEmployer(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('cho phép nhân viên khi đối tác chủ quản còn APPROVED', async () => {
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ status: 'APPROVED' });
      const req = { user: { id: 'staff-001', role: 'STAFF', employerPartnerId: 'partner-001' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireActiveEmployer(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('chặn nhân viên chưa thuộc đối tác nào', async () => {
      const req = { user: { id: 'staff-001', role: 'STAFF', employerPartnerId: null } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireActiveEmployer(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('ADMIN không thuộc đối tác nào -> bỏ qua kiểm tra', async () => {
      const req = { user: { id: 'admin-001', role: 'ADMIN' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireActiveEmployer(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockPrisma.partnerProfile.findUnique).not.toHaveBeenCalled();
    });
  });
});
