jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendAccountStatusEmail: jest.fn().mockResolvedValue(),
  sendPartnerReviewEmail: jest.fn().mockResolvedValue(),
  sendPartnerOperationalStatusEmail: jest.fn().mockResolvedValue(),
  sendAttractionReviewEmail: jest.fn().mockResolvedValue(),
  sendAttractionViolationEmail: jest.fn().mockResolvedValue(),
  sendAttractionRestoredEmail: jest.fn().mockResolvedValue(),
}));
jest.mock('../middleware/uploadMiddleware', () => ({
  isDocumentOwnedByUser: jest.fn(() => true),
}));

const mockPrisma = require('./helpers/mockPrisma');
const mailer = require('../utils/mailer');
const { isDocumentOwnedByUser } = require('../middleware/uploadMiddleware');
const {
  getPartners,
  reviewPartner,
  changePartnerOperationalStatus,
  reviewAttraction,
  hideAttraction,
  restoreAttraction,
} = require('../controllers/adminController');

beforeEach(() => {
  jest.clearAllMocks();
  isDocumentOwnedByUser.mockReturnValue(true);
  mockPrisma.partnerProfile.count.mockResolvedValue(0);
  mockPrisma.partnerProfile.groupBy.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((operations) => (
    Array.isArray(operations) ? Promise.all(operations) : operations(mockPrisma)
  ));
});

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const COMPLETE_KYC = {
  id: 'p-001',
  userId: 'user-001',
  businessName: 'Cty A',
  businessLicenseUrl: 'https://api.vietticket.test/api/upload/documents/user-001-kyc.pdf',
  taxCode: '0102030405',
  registrationDate: new Date('2020-01-15T00:00:00.000Z'),
  representativeName: 'Nguyen Van A',
  representativePhone: '0901234567',
  businessAddress: '1 Nguyen Hue, HCM',
  bankName: 'Vietcombank',
  branchName: 'HCM',
  bankAccountNumber: '0123456789',
  bankAccountName: 'NGUYEN VAN A',
  swiftCode: null,
  payoutCurrency: 'VND',
  kycConsentAccepted: true,
  kycConsentVersion: '2026-07-17-v1',
  kycConsentAcceptedAt: new Date('2026-07-17T00:00:00.000Z'),
  status: 'PENDING',
  user: { id: 'user-001', email: 'a@x.com' },
};

describe('getPartners', () => {
  test('✅ Trả danh sách đối tác lọc theo status=PENDING', async () => {
    mockPrisma.partnerProfile.findMany.mockResolvedValue([
      { id: 'p-001', businessName: 'Cty A', status: 'PENDING', taxCode: '0102030405', createdAt: new Date() },
    ]);
    mockPrisma.partnerProfile.count.mockResolvedValue(1);
    mockPrisma.partnerProfile.groupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 1 } },
    ]);
    const req = { query: { status: 'PENDING' } };
    const res = createRes();
    await getPartners(req, res, jest.fn());

    expect(mockPrisma.partnerProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING' } }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      pagination: expect.objectContaining({ total: 1, page: 1 }),
      stats: expect.objectContaining({
        total: 1,
        byStatus: expect.objectContaining({ PENDING: 1 }),
      }),
    }));
  });

  test('❌ Trả 400 khi status không hợp lệ', async () => {
    const req = { query: { status: 'WRONG' } };
    const res = createRes();
    await getPartners(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.partnerProfile.findMany).not.toHaveBeenCalled();
  });

  test('never exposes a legacy untrusted legal-document URL to an administrator', async () => {
    isDocumentOwnedByUser.mockReturnValue(false);
    mockPrisma.partnerProfile.findMany.mockResolvedValue([{
      id: 'p-legacy',
      businessName: 'Legacy Partner',
      businessLicenseUrl: 'https://phishing.example/fake-license.pdf',
      status: 'PENDING',
      user: { id: 'user-legacy', email: 'legacy@example.com' },
    }]);
    const res = createRes();

    await getPartners({ query: {} }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({
          businessLicenseUrl: '',
          documentValidationStatus: 'MISSING_OR_UNTRUSTED',
        }),
      ],
    }));
  });
});

describe('reviewPartner', () => {
  test('✅ APPROVED nâng quyền user lên PARTNER + gửi email', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ ...COMPLETE_KYC });
    const tx = {
      partnerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { update: jest.fn() },
      userRoleMembership: { upsert: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = { params: { id: 'p-001' }, body: { action: 'APPROVED' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(tx.partnerProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-001', status: 'PENDING' },
      data: { status: 'APPROVED', rejectionReason: null },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      data: { role: 'PARTNER' },
    });
    expect(tx.userRoleMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: 'user-001', role: 'CUSTOMER' },
    }));
    expect(tx.userRoleMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: 'user-001', role: 'PARTNER' },
    }));
    expect(mailer.sendPartnerReviewEmail).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVED' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('fails closed when an administrator tries to approve incomplete legacy KYC', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-legacy',
      userId: 'user-legacy',
      businessName: 'Legacy Partner',
      businessLicenseUrl: 'https://api.vietticket.test/api/upload/documents/user-legacy-kyc.pdf',
      taxCode: '0102030405',
      status: 'PENDING',
      user: { id: 'user-legacy', email: 'legacy@example.com' },
    });
    const res = createRes();

    await reviewPartner({
      user: { id: 'admin-1', role: 'ADMIN' },
      params: { id: 'p-legacy' },
      body: { action: 'APPROVED' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PARTNER_KYC_INCOMPLETE' }),
    }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('fails closed when the stored KYC document is missing or untrusted', async () => {
    isDocumentOwnedByUser.mockReturnValue(false);
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ ...COMPLETE_KYC });
    const res = createRes();

    await reviewPartner({
      user: { id: 'admin-1', role: 'ADMIN' },
      params: { id: 'p-001' },
      body: { action: 'APPROVED' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PARTNER_KYC_DOCUMENT_INVALID' }),
    }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('❌ REJECTED yêu cầu rejectionReason', async () => {
    const req = { params: { id: 'p-001' }, body: { action: 'REJECTED' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ REJECTED kèm lý do hợp lệ', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-001', userId: 'user-001', businessName: 'Cty A', status: 'PENDING', user: { email: 'a@x.com' } });
    const tx = {
      partnerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { update: jest.fn() },
      userRoleMembership: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = { params: { id: 'p-001' }, body: { action: 'REJECTED', rejectionReason: 'Hồ sơ thiếu giấy phép' } };
    const res = createRes();
    await reviewPartner(req, res, jest.fn());

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      data: { role: 'CUSTOMER' },
    });
    expect(tx.userRoleMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: 'user-001', role: 'CUSTOMER' },
    }));
    expect(tx.userRoleMembership.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-001', role: 'PARTNER' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 409 and performs no side effects when a stale reviewer loses the atomic claim', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ ...COMPLETE_KYC });
    const tx = {
      partnerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { update: jest.fn() },
      userRoleMembership: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await reviewPartner({
      user: { id: 'admin-stale', role: 'ADMIN' },
      params: { id: 'p-001' },
      body: { action: 'APPROVED' },
    }, res, jest.fn());

    expect(tx.partnerProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-001', status: 'PENDING' },
      data: { status: 'APPROVED', rejectionReason: null },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userRoleMembership.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(mailer.sendPartnerReviewEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PARTNER_REVIEW_CONFLICT' }),
    }));
  });

  test('maps a database serialization conflict to the same safe 409 response', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ ...COMPLETE_KYC });
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' });
    const res = createRes();
    const next = jest.fn();

    await reviewPartner({
      user: { id: 'admin-racing', role: 'ADMIN' },
      params: { id: 'p-001' },
      body: { action: 'APPROVED' },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mailer.sendPartnerReviewEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PARTNER_REVIEW_CONFLICT' }),
    }));
  });

  test('allows exactly one winner when two administrators review the same pending profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ ...COMPLETE_KYC });
    let claimed = false;
    const tx = {
      partnerProfile: {
        updateMany: jest.fn().mockImplementation(async () => {
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        }),
      },
      user: { update: jest.fn() },
      userRoleMembership: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const approveRes = createRes();
    const rejectRes = createRes();

    await Promise.all([
      reviewPartner({
        user: { id: 'admin-approve', role: 'ADMIN' },
        params: { id: 'p-001' },
        body: { action: 'APPROVED' },
      }, approveRes, jest.fn()),
      reviewPartner({
        user: { id: 'admin-reject', role: 'ADMIN' },
        params: { id: 'p-001' },
        body: { action: 'REJECTED', rejectionReason: 'Giấy phép không đạt yêu cầu' },
      }, rejectRes, jest.fn()),
    ]);

    const statuses = [
      approveRes.status.mock.calls[0][0],
      rejectRes.status.mock.calls[0][0],
    ].sort();
    expect(statuses).toEqual([200, 409]);
    expect(tx.partnerProfile.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mailer.sendPartnerReviewEmail).toHaveBeenCalledTimes(1);
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

  test('does not allow an administrator to review their own partner profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-self',
      userId: 'admin-1',
      businessName: 'Self-owned business',
      status: 'PENDING',
      user: { email: 'admin@example.com' },
    });
    const res = createRes();

    await reviewPartner({
      user: { id: 'admin-1', role: 'ADMIN' },
      params: { id: 'p-self' },
      body: { action: 'APPROVED' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('changePartnerOperationalStatus', () => {
  test('đình chỉ đối tác APPROVED, lưu lý do và audit nhưng không thu hồi role', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-001',
      userId: 'user-001',
      businessName: 'Cty A',
      status: 'APPROVED',
      user: { email: 'a@x.com' },
    });
    const tx = {
      partnerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn() },
      userRoleMembership: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = {
      user: { id: 'admin-1' },
      params: { id: 'p-001' },
      body: { status: 'SUSPENDED', reason: 'Vi phạm điều khoản vận hành' },
      headers: {},
    };
    const res = createRes();

    await changePartnerOperationalStatus(req, res, jest.fn());

    expect(tx.partnerProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-001', status: 'APPROVED' },
      data: { status: 'SUSPENDED', rejectionReason: 'Vi phạm điều khoản vận hành' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PARTNER_SUSPENDED' }),
    }));
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userRoleMembership.deleteMany).not.toHaveBeenCalled();
    expect(mailer.sendPartnerOperationalStatusEmail).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('khôi phục chỉ từ SUSPENDED và xóa lý do đình chỉ', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-001',
      businessName: 'Cty A',
      status: 'SUSPENDED',
      rejectionReason: 'Vi phạm',
      user: { email: 'a@x.com' },
    });
    const tx = {
      partnerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await changePartnerOperationalStatus({
      user: { id: 'admin-1' },
      params: { id: 'p-001' },
      body: { status: 'APPROVED' },
      headers: {},
    }, res, jest.fn());

    expect(tx.partnerProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p-001', status: 'SUSPENDED' },
      data: { status: 'APPROVED', rejectionReason: null },
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('không cho đình chỉ hồ sơ đang PENDING', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-001',
      status: 'PENDING',
      user: {},
    });
    const res = createRes();

    await changePartnerOperationalStatus({
      params: { id: 'p-001' },
      body: { status: 'SUSPENDED', reason: 'x' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('reviewAttraction', () => {
  test('✅ APPROVED cập nhật trạng thái APPROVED', async () => {
    const submittedData = {
      title: 'Suối Tiên',
      description: 'Mô tả đầy đủ về trải nghiệm tham quan dành cho mọi du khách.',
      address: '120 Xa lộ',
      city: 'TP. HCM',
      openTime: '08:00',
      closeTime: '17:00',
      latitude: 10.8,
      longitude: 106.7,
      category: { id: 'cat-1', name: 'Công viên' },
      images: [{ id: 'img-1', url: '/a.jpg', isPrimary: true }],
      tickets: [{ id: 't-1', name: 'Vé', originalPrice: 100, sellingPrice: 80, status: 'ACTIVE', refundPolicy: 'NON_REFUNDABLE', refundFeeRate: 0 }],
      schedule: {
        openDays: [true, true, true, true, true, true, true],
        defaultCapacity: 100,
        timeSlots: [{ id: 's-1', start: '08:00', end: '17:00', capacity: 100, isActive: true }],
        specialDates: {},
      },
    };
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Suối Tiên',
      status: 'PENDING',
      revision: 2,
      submittedData,
      partner: { businessName: 'Cty A', user: { email: 'a@x.com' } },
    });
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true });
    const tx = {
      attractionDailyStock: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      timeSlotStock: { findMany: jest.fn().mockResolvedValue([]) },
      attraction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      attractionCategory: { deleteMany: jest.fn(), create: jest.fn() },
      attractionImage: { deleteMany: jest.fn(), createMany: jest.fn() },
      ticketProduct: {
        aggregate: jest.fn().mockResolvedValue({ _min: { sellingPrice: 80 } }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn(),
      },
      timeSlot: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
      specialDate: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = {
      user: { id: 'admin-1' },
      params: { id: 'attr-001' },
      body: { action: 'APPROVED' },
    };
    const res = createRes();
    await reviewAttraction(req, res, jest.fn());
    expect(tx.attraction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'APPROVED',
        publicationStatus: 'ACTIVE',
        rejectionReason: null,
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mailer.sendAttractionReviewEmail).toHaveBeenCalled();
  });

  test('keeps a previously paused attraction paused after approving an edited revision', async () => {
    const submittedData = {
      title: 'Suoi Tien',
      description: 'Mo ta day du ve trai nghiem tham quan danh cho moi du khach.',
      address: '120 Xa lo',
      city: 'TP. HCM',
      openTime: '08:00',
      closeTime: '17:00',
      latitude: 10.8,
      longitude: 106.7,
      category: { id: 'cat-1', name: 'Cong vien' },
      images: [{ id: 'img-1', url: '/a.jpg', isPrimary: true }],
      tickets: [{ id: 't-1', name: 'Ve', originalPrice: 100, sellingPrice: 80, status: 'ACTIVE', refundPolicy: 'NON_REFUNDABLE', refundFeeRate: 0 }],
      schedule: {
        openDays: [true, true, true, true, true, true, true],
        defaultCapacity: 100,
        timeSlots: [{ id: 's-1', start: '08:00', end: '17:00', capacity: 100, isActive: true }],
        specialDates: {},
      },
    };
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Suoi Tien',
      status: 'PENDING',
      publicationStatus: 'PAUSED',
      publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      revision: 3,
      submittedData,
      partner: { businessName: 'Cty A', user: { email: 'a@x.com' } },
    });
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true });
    const tx = {
      attractionDailyStock: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      timeSlotStock: { findMany: jest.fn().mockResolvedValue([]) },
      attraction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      attractionCategory: { deleteMany: jest.fn(), create: jest.fn() },
      attractionImage: { deleteMany: jest.fn(), createMany: jest.fn() },
      ticketProduct: {
        aggregate: jest.fn().mockResolvedValue({ _min: { sellingPrice: 80 } }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn(),
      },
      timeSlot: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
      specialDate: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = {
      user: { id: 'admin-1' },
      params: { id: 'attr-001' },
      body: { action: 'APPROVED' },
    };
    const res = createRes();

    await reviewAttraction(req, res, jest.fn());

    expect(tx.attraction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'APPROVED',
        publicationStatus: 'PAUSED',
      }),
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

  test('❌ Chặn duyệt lặp khi revision đã được admin khác xử lý', async () => {
    const submittedData = {
      title: 'Suối Tiên',
      description: 'Mô tả đầy đủ về trải nghiệm tham quan dành cho mọi du khách.',
      address: '120 Xa lộ',
      city: 'TP. HCM',
      openTime: '08:00',
      closeTime: '17:00',
      latitude: 10.8,
      longitude: 106.7,
      category: { id: 'cat-1', name: 'Công viên' },
      images: [{ id: 'img-1', url: '/a.jpg', isPrimary: true }],
      tickets: [{ id: 't-1', name: 'Vé', originalPrice: 100, sellingPrice: 80, status: 'ACTIVE', refundPolicy: 'NON_REFUNDABLE', refundFeeRate: 0 }],
      schedule: {
        openDays: [true, true, true, true, true, true, true],
        defaultCapacity: 100,
        timeSlots: [{ id: 's-1', start: '08:00', end: '17:00', capacity: 100, isActive: true }],
        specialDates: {},
      },
    };
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Suối Tiên',
      status: 'PENDING',
      revision: 3,
      submittedData,
      partner: { businessName: 'Cty A', user: { email: 'a@x.com' } },
    });
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true });
    const tx = {
      attraction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const next = jest.fn();
    await reviewAttraction(
      { user: { id: 'admin-2' }, params: { id: 'attr-001' }, body: { action: 'APPROVED' } },
      createRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });
});

describe('hideAttraction', () => {
  test('✅ Đình chỉ vận hành mà không ghi đè trạng thái kiểm duyệt + gửi email', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001', title: 'Suối Tiên', status: 'DRAFT',
      publicationStatus: 'ACTIVE', archivedAt: null,
      publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      partner: { businessName: 'Cty A', user: { email: 'a@x.com' } },
    });
    const tx = {
      attraction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = { params: { id: 'attr-001' }, body: { reason: 'Vé lậu trái phép' } };
    const res = createRes();
    await hideAttraction(req, res, jest.fn());

    expect(tx.attraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationalStatus: 'SUSPENDED',
        publicationStatus: 'PAUSED',
        suspensionReason: 'Vé lậu trái phép',
      }),
    }));
    expect(tx.attraction.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(tx.attraction.updateMany.mock.calls[0][0].data).not.toHaveProperty('rejectionReason');
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

describe('restoreAttraction', () => {
  test('khôi phục vận hành nhưng giữ trạng thái kiểm duyệt và PAUSED để đối tác tự mở bán', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Suối Tiên',
      status: 'PENDING',
      operationalStatus: 'SUSPENDED',
      publicationStatus: 'PAUSED',
      rejectionReason: null,
      suspensionReason: 'Vi phạm',
      archivedAt: null,
      partner: { businessName: 'Cty A', user: { email: 'a@x.com' } },
    });
    const tx = {
      attraction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = createRes();

    await restoreAttraction({
      user: { id: 'admin-1' },
      params: { id: 'attr-001' },
      headers: {},
    }, res, jest.fn());

    expect(tx.attraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationalStatus: 'ACTIVE',
        publicationStatus: 'PAUSED',
        suspensionReason: null,
      }),
    }));
    expect(mailer.sendAttractionRestoredEmail).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
