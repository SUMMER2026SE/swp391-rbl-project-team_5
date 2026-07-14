jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { registerPartner, getMyPartnerProfile } = require('../controllers/partnerController');

function mockReqRes(body = {}, user = { id: 'user-001', role: 'CUSTOMER' }) {
  const req = { body, user };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

afterEach(() => jest.clearAllMocks());

describe('registerPartner', () => {
  test('creates a pending partner profile for a customer', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    mockPrisma.partnerProfile.create.mockResolvedValue({
      id: 'p-001',
      userId: 'user-001',
      businessName: 'Cong ty Test',
      status: 'PENDING',
      createdAt: new Date(),
    });

    const { req, res, next } = mockReqRes({
      businessName: 'Cong ty Test',
      taxCode: '0123456789',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
    });
    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('returns 409 when the user already has a non-resubmittable partner profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-existing' });
    const { req, res, next } = mockReqRes({
      businessName: 'Test',
      taxCode: '0123456789',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
    });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test.each([
    ['ADMIN'],
    ['STAFF'],
  ])('blocks %s from submitting partner KYC', async (role) => {
    const { req, res, next } = mockReqRes({
      businessName: 'Test',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
    }, { id: 'user-001', role });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPrisma.partnerProfile.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.partnerProfile.create).not.toHaveBeenCalled();
  });

  test('blocks a suspended partner from self-restoring by resubmitting KYC', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-existing',
      userId: 'user-001',
      status: 'SUSPENDED',
      businessName: 'Old Name',
    });
    const { req, res, next } = mockReqRes({
      businessName: 'New Name',
      taxCode: '0123456789',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
    }, { id: 'user-001', role: 'PARTNER' });

    await registerPartner(req, res, next);

    expect(mockPrisma.partnerProfile.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('returns a business conflict when another partner already owns the tax code', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    mockPrisma.partnerProfile.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['taxCode'] },
    });
    const { req, res, next } = mockReqRes({
      businessName: 'New Company',
      taxCode: '0123456789',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
    });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'TAX_CODE_ALREADY_REGISTERED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 400 when businessName is missing', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    const { req, res, next } = mockReqRes({ taxCode: '0123456789' });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('getMyPartnerProfile', () => {
  test('returns the current partner profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-001',
      businessName: 'Cong ty Test',
      status: 'APPROVED',
    });
    const { req, res, next } = mockReqRes();

    await getMyPartnerProfile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 404 when the profile does not exist', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    const { req, res, next } = mockReqRes();

    await getMyPartnerProfile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
