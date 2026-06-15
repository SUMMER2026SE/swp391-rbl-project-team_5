jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const {
  listAttractions,
  getAttraction,
  createAttraction,
  updateAttraction,
  deleteAttraction,
  uploadImages,
  deleteImage,
  setPrimaryImage,
  listCategories,
  submitAttraction,
} = require('../controllers/attractionController');

afterEach(() => jest.clearAllMocks());

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const PARTNER = { id: 'partner-001' };

describe('listAttractions (Partner Portal)', () => {
  test('✅ Trả danh sách + pagination, lọc theo partner hiện tại', async () => {
    const rows = [{
      id: 'attr-001', title: 'Suối Tiên', city: 'TP. HCM',
      status: 'APPROVED', images: [], categories: [], openTime: null, closeTime: null,
    }];
    mockPrisma.$transaction.mockResolvedValue([rows, 1]);

    const req = { partner: PARTNER, query: { page: '1', limit: '10' } };
    const res = createRes();
    await listAttractions(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      attractions: expect.any(Array),
      pagination: expect.objectContaining({ total: 1, page: 1, limit: 10, totalPages: 1 }),
    }));
  });

  test('✅ status=active lọc theo publicationStatus ACTIVE', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);
    mockPrisma.attraction.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));

    const req = { partner: PARTNER, query: { status: 'active', search: 'Suoi', city: 'TP. HCM' } };
    await listAttractions(req, createRes(), jest.fn());

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        partnerId: 'partner-001',
        publicationStatus: 'ACTIVE',
        city: 'TP. HCM',
        title: { contains: 'Suoi', mode: 'insensitive' },
      }),
    }));
  });

  test('✅ limit bị giới hạn ở MAX_LIMIT = 50', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);
    mockPrisma.attraction.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));

    const req = { partner: PARTNER, query: { limit: '999' } };
    await listAttractions(req, createRes(), jest.fn());

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});

describe('getAttraction (Partner Portal)', () => {
  test('✅ Trả về chi tiết khi attraction thuộc về partner', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001', title: 'Suối Tiên', partnerId: 'partner-001',
      city: 'TP. HCM', address: 'abc', images: [], categories: [],
    });
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await getAttraction(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ attraction: expect.any(Object) }));
  });

  test('❌ Trả 404 khi attraction thuộc partner khác', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'other-partner' });
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await getAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('createAttraction', () => {
  function setupCreate(overrides = {}) {
    const create = jest.fn().mockResolvedValue({ id: 'attr-001' });
    const tx = {
      attraction: { create },
      attractionCategory: { createMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
      attractionImage: { createMany: jest.fn() },
      category: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-001', name: 'Công viên' }) },
    };
    mockPrisma.$transaction.mockImplementation((cb) => cb(tx));
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001', title: 'Suối Tiên', status: 'DRAFT', description: '',
      address: '120 Xa lộ', city: 'TP. HCM', images: [], categories: [],
      createdAt: new Date('2026-06-07T00:00:00.000Z'), ...overrides,
    });
    return { create, tx };
  }

  test('✅ Luôn ép trạng thái DRAFT dù FE gửi active', async () => {
    const { create } = setupCreate();
    const req = {
      partner: PARTNER,
      body: { name: 'Suối Tiên', address: '120 Xa lộ', province: 'TP. HCM', status: 'active' },
    };
    const res = createRes();
    await createAttraction(req, res, jest.fn());

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ partnerId: 'partner-001', status: 'DRAFT' }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('❌ Trả 400 khi thiếu tên', async () => {
    const req = { partner: PARTNER, body: { address: 'x', province: 'TP. HCM' } };
    const res = createRes();
    await createAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi thiếu địa chỉ', async () => {
    const req = { partner: PARTNER, body: { name: 'Suối Tiên', province: 'TP. HCM' } };
    const res = createRes();
    await createAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ Gắn category active có sẵn qua tên', async () => {
    const { tx } = setupCreate();
    const req = {
      partner: PARTNER,
      body: { name: 'Suối Tiên', address: '120 Xa lộ', province: 'TP. HCM', category: 'Công viên' },
    };
    await createAttraction(req, createRes(), jest.fn());
    expect(tx.category.findFirst).toHaveBeenCalled();
    expect(tx.attractionCategory.create).toHaveBeenCalled();
  });
});

describe('updateAttraction', () => {
  test('❌ Trả 404 khi không sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'other' });
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { name: 'New' } };
    const res = createRes();
    await updateAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('✅ Bỏ qua status client, không cho client tự đổi moderation state', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001', status: 'DRAFT' });
    const tx = {
      attraction: { update: jest.fn() },
      attractionCategory: { deleteMany: jest.fn(), create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { status: 'active' } };
    const res = createRes();
    await updateAttraction(req, res, jest.fn());
    expect(tx.attraction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DRAFT' }),
    }));
    expect(res.json).toHaveBeenCalled();
  });

  test('✅ Cập nhật thành công khi hợp lệ', async () => {
    mockPrisma.attraction.findUnique
      .mockResolvedValueOnce({ id: 'attr-001', partnerId: 'partner-001', status: 'DRAFT' })
      .mockResolvedValueOnce({ id: 'attr-001', title: 'New', city: 'TP. HCM', address: 'x', images: [], categories: [] });
    const tx = { attraction: { update: jest.fn() }, category: { upsert: jest.fn() }, attractionCategory: { deleteMany: jest.fn(), create: jest.fn() } };
    mockPrisma.$transaction.mockImplementation((cb) => cb(tx));

    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { name: 'New' } };
    const res = createRes();
    await updateAttraction(req, res, jest.fn());
    expect(tx.attraction.update).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ attraction: expect.any(Object) }));
  });

  test('✅ Sửa địa điểm đã public chỉ tạo draft, không ghi đè dữ liệu live', async () => {
    const live = {
      id: 'attr-live',
      partnerId: 'partner-001',
      title: 'Tên đang bán',
      description: 'Mô tả đang bán',
      address: 'Địa chỉ cũ',
      city: 'TP. HCM',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      images: [{ id: 'img-1', imageUrl: '/live.jpg', isPrimary: true }],
      categories: [{ category: { id: 'cat-1', name: 'Công viên' } }],
    };
    mockPrisma.attraction.findUnique
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({
        ...live,
        status: 'DRAFT',
        draftData: { title: 'Tên mới', images: [] },
      });
    mockPrisma.attraction.update.mockResolvedValue({});

    const res = createRes();
    await updateAttraction(
      { partner: PARTNER, params: { id: 'attr-live' }, body: { name: 'Tên mới' } },
      res,
      jest.fn(),
    );

    expect(mockPrisma.attraction.update).toHaveBeenCalledWith({
      where: { id: 'attr-live' },
      data: expect.objectContaining({
        status: 'DRAFT',
        draftData: expect.objectContaining({ title: 'Tên mới' }),
      }),
    });
    expect(mockPrisma.attraction.update.mock.calls[0][0].data.title).toBeUndefined();
  });

  test('❌ Khóa chỉnh sửa khi phiên bản đang PENDING', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
      status: 'PENDING',
      images: [],
      categories: [],
    });
    const next = jest.fn();
    await updateAttraction(
      { partner: PARTNER, params: { id: 'attr-001' }, body: { name: 'Không được sửa' } },
      createRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(mockPrisma.attraction.update).not.toHaveBeenCalled();
  });
});

describe('deleteAttraction', () => {
  test('✅ Xóa khi sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001' });
    mockPrisma.booking.count.mockResolvedValue(0);
    mockPrisma.attraction.update.mockResolvedValue({});
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await deleteAttraction(req, res, jest.fn());
    expect(mockPrisma.attraction.update).toHaveBeenCalledWith({
      where: { id: 'attr-001' },
      data: { archivedAt: expect.any(Date), publicationStatus: 'ARCHIVED' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('❌ Trả 404 khi không sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const req = { partner: PARTNER, params: { id: 'x' } };
    const res = createRes();
    await deleteAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('❌ Không lưu trữ khi còn booking tương lai', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
    });
    mockPrisma.booking.count.mockResolvedValue(2);
    const res = createRes();
    await deleteAttraction(
      { partner: PARTNER, params: { id: 'attr-001' } },
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.attraction.update).not.toHaveBeenCalled();
  });
});

describe('uploadImages', () => {
  test('❌ Trả 400 khi không có file', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001', images: [] });
    const req = { partner: PARTNER, params: { id: 'attr-001' }, files: [] };
    const res = createRes();
    await uploadImages(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ Ảnh đầu tiên là primary nếu chưa có ảnh primary', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001', images: [] });
    mockPrisma.attractionImage.create
      .mockResolvedValueOnce({ id: 'img-1', imageUrl: 'http://h/uploads/a.png', isPrimary: true })
      .mockResolvedValueOnce({ id: 'img-2', imageUrl: 'http://h/uploads/b.png', isPrimary: false });
    mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));

    const req = {
      partner: PARTNER, params: { id: 'attr-001' },
      protocol: 'http', get: () => 'localhost',
      files: [{ filename: 'a.png' }, { filename: 'b.png' }],
    };
    const res = createRes();
    await uploadImages(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ images: expect.any(Array) }));
  });
});

describe('manage attraction images', () => {
  test('✅ Xóa ảnh primary và chuyển primary sang ảnh còn lại', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
      images: [
        { id: 'img-1', isPrimary: true },
        { id: 'img-2', isPrimary: false },
      ],
    });
    const tx = {
      attractionImage: {
        delete: jest.fn(),
        update: jest.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const req = {
      partner: PARTNER,
      params: { id: 'attr-001', imageId: 'img-1' },
    };
    const res = createRes();
    await deleteImage(req, res, jest.fn());

    expect(tx.attractionImage.delete).toHaveBeenCalledWith({ where: { id: 'img-1' } });
    expect(tx.attractionImage.update).toHaveBeenCalledWith({
      where: { id: 'img-2' },
      data: { isPrimary: true },
    });
    expect(res.json).toHaveBeenCalledWith({ message: 'Đã xóa ảnh.' });
  });

  test('✅ Đặt ảnh đại diện trong một transaction', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
      images: [{ id: 'img-2', isPrimary: false }],
    });
    const tx = {
      attractionImage: {
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const req = {
      partner: PARTNER,
      params: { id: 'attr-001', imageId: 'img-2' },
    };
    const res = createRes();
    await setPrimaryImage(req, res, jest.fn());

    expect(tx.attractionImage.updateMany).toHaveBeenCalledWith({
      where: { attractionId: 'attr-001', isPrimary: true },
      data: { isPrimary: false },
    });
    expect(tx.attractionImage.update).toHaveBeenCalledWith({
      where: { id: 'img-2' },
      data: { isPrimary: true },
    });
    expect(res.json).toHaveBeenCalledWith({ message: 'Đã cập nhật ảnh đại diện.' });
  });

  test('❌ Không cho thao tác ảnh không thuộc địa điểm', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
      images: [],
    });
    const res = createRes();
    await deleteImage(
      { partner: PARTNER, params: { id: 'attr-001', imageId: 'unknown' } },
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('listCategories', () => {
  test('✅ Trả danh sách category', async () => {
    mockPrisma.category.findMany.mockResolvedValue([{ id: 'cat-001', name: 'Công viên' }]);
    const res = createRes();
    await listCategories({}, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ categories: [{ id: 'cat-001', name: 'Công viên' }] });
  });
});

describe('submitAttraction (gửi duyệt)', () => {
  const baseReq = (status) => ({
    user: { id: 'user-001' }, params: { id: 'attr-001' },
    _status: status,
  });

  test('✅ DRAFT -> PENDING', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
      status: 'DRAFT',
      revision: 0,
      title: 'Suối Tiên',
      description: 'Mô tả đầy đủ về trải nghiệm tham quan dành cho mọi du khách.',
      address: '120 Xa lộ',
      city: 'TP. HCM',
      openTime: '08:00',
      closeTime: '17:00',
      latitude: 10.8,
      longitude: 106.7,
      images: [{ id: 'img-1', imageUrl: '/a.jpg', isPrimary: true }],
      categories: [{ category: { id: 'cat-1', name: 'Công viên' } }],
      ticketProducts: [{ id: 't-1', name: 'Vé', originalPrice: 100, sellingPrice: 80, status: 'ACTIVE', refundPolicy: 'NON_REFUNDABLE', refundFeeRate: 0 }],
      timeSlots: [{ id: 's-1', startTime: '08:00', endTime: '17:00', maxCapacity: 100, isActive: true }],
    });
    const tx = {
      attraction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'attr-001', status: 'PENDING' }),
      },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const req = baseReq('DRAFT');
    const res = createRes();
    await submitAttraction(req, res, jest.fn());
    expect(tx.attraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'attr-001', status: { in: ['DRAFT', 'REJECTED'] } }),
      data: expect.objectContaining({ status: 'PENDING', revision: { increment: 1 } }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Không gửi duyệt khi hồ sơ thiếu thông tin bắt buộc', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      partnerId: 'partner-001',
      status: 'DRAFT',
      title: 'Thiếu dữ liệu',
      description: '',
      address: 'x',
      city: 'TP. HCM',
      images: [],
      categories: [],
    });
    const res = createRes();
    await submitAttraction(baseReq('DRAFT'), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'INCOMPLETE_ATTRACTION' }),
    }));
  });

  test('❌ Trả 403 khi không sở hữu địa điểm', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'other', status: 'DRAFT' });
    const req = baseReq('DRAFT');
    const res = createRes();
    await submitAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Trả 400 khi đang ở trạng thái không cho gửi duyệt (APPROVED)', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001', status: 'APPROVED' });
    const req = baseReq('APPROVED');
    const res = createRes();
    await submitAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 404 khi địa điểm không tồn tại', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const req = baseReq('DRAFT');
    const res = createRes();
    await submitAttraction(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
