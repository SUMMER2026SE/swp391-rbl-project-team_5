jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const {
  requirePartner,
  requireApprovedPartner,
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
});
