jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../middleware/uploadMiddleware', () => ({
  isDocumentOwnedByUser: jest.fn(() => true),
  removeUnreferencedDocumentsForUser: jest.fn().mockResolvedValue(undefined),
}));
const mockPrisma = require('./helpers/mockPrisma');
const {
  isDocumentOwnedByUser,
  removeUnreferencedDocumentsForUser,
} = require('../middleware/uploadMiddleware');
const { registerPartner, getMyPartnerProfile } = require('../controllers/partnerController');

const VALID_KYC = {
  businessName: 'Cong ty Test',
  taxCode: '0123456789',
  businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
  registrationDate: '2020-01-15',
  representativeName: 'Nguyen Van A',
  representativePhone: '0901234567',
  businessAddress: '1 Nguyen Hue, HCM',
  bankName: 'Vietcombank',
  branchName: 'HCM',
  bankAccountNumber: '0123456789',
  bankAccountName: 'NGUYEN VAN A',
  payoutCurrency: 'VND',
  kycConsentAccepted: true,
};

function mockReqRes(body = {}, user = { id: 'user-001', role: 'CUSTOMER' }) {
  const req = {
    body,
    user,
    ip: '127.0.0.1',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-001',
    email: 'customer@example.com',
    fullName: 'Customer',
    role: 'CUSTOMER',
    roleMemberships: [{ role: 'CUSTOMER' }],
    profile: null,
  });
  isDocumentOwnedByUser.mockReturnValue(true);
});

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

    const { req, res, next } = mockReqRes({ ...VALID_KYC });
    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('returns 409 when the user already has a non-resubmittable partner profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-existing' });
    const { req, res, next } = mockReqRes({ ...VALID_KYC, businessName: 'Test' });

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
    const { req, res, next } = mockReqRes(
      { ...VALID_KYC, businessName: 'New Name' },
      { id: 'user-001', role: 'PARTNER' },
    );

    await registerPartner(req, res, next);

    expect(mockPrisma.partnerProfile.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('xóa tài liệu KYC cũ sau khi hồ sơ bị từ chối được nộp lại thành công', async () => {
    const existing = {
      id: 'p-existing',
      userId: 'user-001',
      status: 'REJECTED',
      businessName: 'Old Name',
      businessLicenseUrl:
        'http://localhost/api/upload/documents/user-001-old-license.pdf',
    };
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(existing);
    mockPrisma.partnerProfile.update.mockImplementation(({ data }) => Promise.resolve({
      ...existing,
      ...data,
      id: existing.id,
      createdAt: new Date(),
    }));
    const { req, res, next } = mockReqRes({ ...VALID_KYC });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(removeUnreferencedDocumentsForUser).toHaveBeenCalledWith(
      'user-001',
      [VALID_KYC.businessLicenseUrl],
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns a business conflict when another partner already owns the tax code', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    mockPrisma.partnerProfile.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['taxCode'] },
    });
    const { req, res, next } = mockReqRes({ ...VALID_KYC, businessName: 'New Company' });

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

  test('rejects a KYC document that is not an existing upload owned by the applicant', async () => {
    isDocumentOwnedByUser.mockReturnValue(false);
    const { req, res, next } = mockReqRes({ ...VALID_KYC });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.partnerProfile.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.partnerProfile.create).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
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
