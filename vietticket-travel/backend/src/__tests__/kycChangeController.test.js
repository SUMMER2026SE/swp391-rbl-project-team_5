'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../middleware/uploadMiddleware', () => ({
  isDocumentOwnedByUser: jest.fn(() => true),
}));

const prisma = require('./helpers/mockPrisma');
const {
  createKycChangeRequest,
  reviewKycChangeRequest,
} = require('../controllers/kycChangeController');

const CURRENT = {
  id: 'partner-1',
  status: 'APPROVED',
  businessName: 'Công ty Du lịch A',
  businessLicenseUrl: 'https://api.test/api/upload/documents/user-1-old.pdf',
  taxCode: '0123456789',
  registrationDate: new Date('2020-01-01T00:00:00.000Z'),
  representativeName: 'Nguyen Van A',
  representativePhone: '0901234567',
  businessAddress: '1 Nguyen Hue, TP.HCM',
  bankName: 'Vietcombank',
  branchName: 'TP.HCM',
  bankAccountNumber: '1234567890',
  bankAccountName: 'NGUYEN VAN A',
  swiftCode: '',
  payoutCurrency: 'VND',
};

const PROPOSED = {
  ...CURRENT,
  registrationDate: '2020-01-01',
  businessLicenseUrl: 'https://api.test/api/upload/documents/user-1-new.pdf',
  bankAccountNumber: '9999999999',
  reason: 'Doanh nghiệp thay đổi tài khoản nhận đối soát',
  confirmedAccurate: true,
};

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('partner KYC change request workflow', () => {
  test('stores proposed data without mutating the approved partner profile', async () => {
    prisma.partnerKycChangeRequest.findFirst.mockResolvedValue(null);
    const created = {
      id: 'change-1',
      partnerId: 'partner-1',
      requestedById: 'user-1',
      status: 'PENDING',
      proposedData: { fields: PROPOSED },
    };
    const tx = {
      partnerKycChangeRequest: {
        create: jest.fn().mockResolvedValue(created),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      partnerProfile: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const response = res();

    await createKycChangeRequest({
      body: PROPOSED,
      user: { id: 'user-1' },
      partner: CURRENT,
      headers: {},
      ip: '127.0.0.1',
    }, response, jest.fn());

    expect(tx.partnerKycChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerId: 'partner-1',
        requestedById: 'user-1',
        proposedData: expect.objectContaining({
          fields: expect.objectContaining({ bankAccountNumber: '9999999999' }),
          evidence: expect.objectContaining({ consentVersion: '2026-07-29-v1' }),
        }),
      }),
    });
    expect(tx.partnerProfile.update).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(201);
  });

  test('an admin approval atomically applies the validated proposal', async () => {
    const proposedFields = Object.fromEntries(
      Object.entries(PROPOSED).filter(([key]) =>
        !['id', 'status', 'reason', 'confirmedAccurate'].includes(key)),
    );
    prisma.partnerKycChangeRequest.findUnique.mockResolvedValue({
      id: 'change-1',
      partnerId: 'partner-1',
      requestedById: 'user-1',
      status: 'PENDING',
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      proposedData: {
        fields: proposedFields,
        evidence: {
          consentVersion: '2026-07-29-v1',
          acceptedAt: '2026-07-29T00:00:00.000Z',
          ipAddress: '127.0.0.1',
        },
      },
      partner: CURRENT,
    });
    const tx = {
      partnerKycChangeRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      partnerProfile: {
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const response = res();

    await reviewKycChangeRequest({
      params: { id: 'change-1' },
      body: { action: 'APPROVED', reviewNote: 'Đã đối chiếu giấy phép và tài khoản.' },
      user: { id: 'admin-2' },
      headers: {},
    }, response, jest.fn());

    expect(tx.partnerKycChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'change-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedById: 'admin-2',
        }),
      }),
    );
    expect(tx.partnerProfile.update).toHaveBeenCalledWith({
      where: { id: 'partner-1' },
      data: expect.objectContaining({
        bankAccountNumber: '9999999999',
        kycConsentVersion: '2026-07-29-v1',
      }),
    });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
    }));
  });
});
