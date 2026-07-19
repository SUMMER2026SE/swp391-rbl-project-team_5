jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const {
  requirePartner,
  requireApprovedPartner,
  requireOwnedAttraction,
  requireActiveEmployer,
  requireCheckInEmployer,
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

  describe('requireOwnedAttraction', () => {
    test('allows the current partner to continue before any upload is processed', async () => {
      const attraction = {
        id: 'attr-001',
        partnerId: 'partner-001',
        archivedAt: null,
      };
      mockPrisma.attraction.findUnique.mockResolvedValue(attraction);
      const req = {
        params: { id: attraction.id },
        partner: { id: 'partner-001' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireOwnedAttraction(req, res, next);

      expect(mockPrisma.attraction.findUnique).toHaveBeenCalledWith({
        where: { id: attraction.id },
        select: { id: true, partnerId: true, archivedAt: true },
      });
      expect(req.ownedAttraction).toEqual(attraction);
      expect(next).toHaveBeenCalled();
    });

    test('returns the same 404 for a missing or foreign attraction', async () => {
      mockPrisma.attraction.findUnique.mockResolvedValue({
        id: 'attr-foreign',
        partnerId: 'partner-002',
        archivedAt: null,
      });
      const req = {
        params: { id: 'attr-foreign' },
        partner: { id: 'partner-001' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireOwnedAttraction(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });
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

  describe('requireCheckInEmployer', () => {
    test('cho phép staff phục vụ vé đã xác nhận khi đối tác bị SUSPENDED', async () => {
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
      const req = { user: { id: 'staff-001', role: 'STAFF', employerPartnerId: 'partner-001' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireCheckInEmployer(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('chặn check-in khi hồ sơ chủ quản chưa từng được duyệt', async () => {
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ status: 'PENDING' });
      const req = { user: { id: 'staff-001', role: 'STAFF', employerPartnerId: 'partner-001' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await requireCheckInEmployer(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
