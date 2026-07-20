jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const {
  listTickets,
  createTicket,
  getTicket,
  updateTicket,
  deleteTicket,
  createTicketProduct,
  setupTimeSlots,
} = require('../controllers/ticketController');

afterEach(() => jest.clearAllMocks());

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const PARTNER = { id: 'partner-001' };
const OWNED_ATTRACTION = { id: 'attr-001', title: 'Suối Tiên', partnerId: 'partner-001' };

describe('listTickets (Partner Portal)', () => {
  test('✅ Trả danh sách vé của attraction sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(OWNED_ATTRACTION);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([
      { id: 'tkt-001', name: 'Vé người lớn', originalPrice: 150000, sellingPrice: 120000, status: 'ACTIVE', refundPolicy: 'NON_REFUNDABLE' },
    ]);
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await listTickets(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tickets: expect.any(Array) }));
  });

  test('❌ Trả 404 khi attraction không thuộc partner', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'other' });
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await listTickets(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('keeps live ticket packages visible when a published attraction has no draft yet', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      ...OWNED_ATTRACTION,
      publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      draftData: null,
      images: [],
      categories: [],
      timeSlots: [],
      specialDates: [],
      ticketProducts: [{
        id: 'ticket-live',
        name: 'Vé người lớn',
        type: 'ADULT',
        description: '',
        originalPrice: 150000,
        sellingPrice: 120000,
        status: 'ACTIVE',
        refundPolicy: 'NON_REFUNDABLE',
        refundFeeRate: 0,
        refundCutoffHours: 24,
        archivedAt: null,
      }],
    });
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();

    await listTickets(req, res, jest.fn());

    expect(mockPrisma.attraction.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ ticketProducts: expect.any(Object) }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      tickets: [expect.objectContaining({ id: 'ticket-live', name: 'Vé người lớn' })],
    }));
    expect(mockPrisma.ticketProduct.findMany).not.toHaveBeenCalled();
  });
});

describe('createTicket (Partner Portal)', () => {
  test('✅ Tạo vé thành công với mặc định hợp lý', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(OWNED_ATTRACTION);
    mockPrisma.ticketProduct.create.mockResolvedValue({
      id: 'tkt-001', name: 'Vé người lớn', type: 'ADULT', status: 'ACTIVE',
      refundPolicy: 'NON_REFUNDABLE', originalPrice: 150000, sellingPrice: 120000,
    });
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { name: 'Vé người lớn', originalPrice: 150000, sellingPrice: 120000 } };
    const res = createRes();
    await createTicket(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockPrisma.ticketProduct.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attractionId: 'attr-001', status: 'ACTIVE' }),
    }));
  });

  test('❌ Trả 400 khi giá bán > giá gốc', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(OWNED_ATTRACTION);
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { name: 'Vé', originalPrice: 100000, sellingPrice: 200000 } };
    const res = createRes();
    await createTicket(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.ticketProduct.create).not.toHaveBeenCalled();
  });

  test('❌ Trả 404 khi attraction không sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { name: 'Vé', originalPrice: 100, sellingPrice: 50 } };
    const res = createRes();
    await createTicket(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('getTicket / updateTicket / deleteTicket', () => {
  const ownedTicket = { id: 'tkt-001', name: 'Vé', originalPrice: 150000, sellingPrice: 120000, attraction: { partnerId: 'partner-001' } };

  test('✅ getTicket trả về vé sở hữu', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(ownedTicket);
    const req = { partner: PARTNER, params: { ticketId: 'tkt-001' } };
    const res = createRes();
    await getTicket(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ticket: expect.any(Object) }));
  });

  test('❌ getTicket trả 404 khi vé thuộc partner khác', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'other' } });
    const req = { partner: PARTNER, params: { ticketId: 'tkt-001' } };
    const res = createRes();
    await getTicket(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('❌ updateTicket chặn khi sellingPrice mới > originalPrice cũ', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(ownedTicket);
    const req = { partner: PARTNER, params: { ticketId: 'tkt-001' }, body: { sellingPrice: 999999 } };
    const res = createRes();
    await updateTicket(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.ticketProduct.update).not.toHaveBeenCalled();
  });

  test('✅ updateTicket cập nhật thành công', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(ownedTicket);
    mockPrisma.ticketProduct.update.mockResolvedValue({ ...ownedTicket, sellingPrice: 100000 });
    const req = { partner: PARTNER, params: { ticketId: 'tkt-001' }, body: { sellingPrice: 100000 } };
    const res = createRes();
    await updateTicket(req, res, jest.fn());
    expect(mockPrisma.ticketProduct.update).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ticket: expect.any(Object) }));
  });

  test('✅ deleteTicket xóa vé sở hữu', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(ownedTicket);
    mockPrisma.ticketProduct.update.mockResolvedValue({});
    const req = { partner: PARTNER, params: { ticketId: 'tkt-001' } };
    const res = createRes();
    await deleteTicket(req, res, jest.fn());
    expect(mockPrisma.ticketProduct.update).toHaveBeenCalledWith({
      where: { id: 'tkt-001' },
      data: { archivedAt: expect.any(Date), status: 'INACTIVE' },
    });
  });
});

describe('createTicketProduct (public partner flow)', () => {
  test('✅ Tạo vé khi là chủ sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001' });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.ticketProduct.create.mockResolvedValue({ id: 'tkt-002', name: 'Vé trẻ em', status: 'ACTIVE' });
    const req = {
      user: { id: 'user-001' }, params: { attractionId: 'attr-001' },
      body: { name: 'Vé trẻ em', description: 'desc', originalPrice: 100000, sellingPrice: 80000, refundPolicy: 'NON_REFUNDABLE' },
    };
    const res = createRes();
    await createTicketProduct(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockPrisma.ticketProduct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'ADULT' }),
    });
  });

  test('chuẩn hóa và lưu đúng loại vé sinh viên', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001' });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    mockPrisma.ticketProduct.create.mockResolvedValue({ id: 'tkt-student', name: 'Vé sinh viên', status: 'ACTIVE' });
    const req = {
      user: { id: 'user-001' },
      params: { attractionId: 'attr-001' },
      body: {
        name: 'Vé sinh viên',
        type: 'student',
        description: 'Xuất trình thẻ sinh viên còn hiệu lực.',
        originalPrice: 100000,
        sellingPrice: 80000,
        refundPolicy: 'NON_REFUNDABLE',
      },
    };
    const res = createRes();

    await createTicketProduct(req, res, jest.fn());

    expect(mockPrisma.ticketProduct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'STUDENT' }),
    });
  });

  test('❌ Trả 403 khi không phải chủ sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'other' });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = { user: { id: 'user-001' }, params: { attractionId: 'attr-001' }, body: { name: 'Vé', description: 'd', originalPrice: 1, sellingPrice: 1 } };
    const res = createRes();
    await createTicketProduct(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Trả 400 khi thiếu trường bắt buộc', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001' });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = { user: { id: 'user-001' }, params: { attractionId: 'attr-001' }, body: { name: 'Vé' } };
    const res = createRes();
    await createTicketProduct(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi refundPolicy không hợp lệ', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001' });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = { user: { id: 'user-001' }, params: { attractionId: 'attr-001' }, body: { name: 'Vé', description: 'd', originalPrice: 100, sellingPrice: 80, refundPolicy: 'WRONG' } };
    const res = createRes();
    await createTicketProduct(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('setupTimeSlots', () => {
  test('✅ Thiết lập khung giờ thành công', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'partner-001' } });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const tx = { timeSlot: { updateMany: jest.fn(), createMany: jest.fn() } };
    mockPrisma.$transaction.mockImplementation((cb) => cb(tx));
    const req = {
      user: { id: 'user-001' }, params: { ticketProductId: 'tkt-001' },
      body: { slots: [{ startTime: '08:00', endTime: '11:00', maxCapacity: 100 }] },
    };
    const res = createRes();
    await setupTimeSlots(req, res, jest.fn());
    expect(tx.timeSlot.updateMany).toHaveBeenCalled();
    expect(tx.timeSlot.createMany).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('blocks live slot changes for published attractions', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({
      id: 'tkt-001',
      attraction: {
        partnerId: 'partner-001',
        publishedAt: new Date('2026-06-01T00:00:00.000Z'),
        status: 'APPROVED',
      },
    });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });

    const req = {
      user: { id: 'user-001' },
      params: { ticketProductId: 'tkt-001' },
      body: { slots: [{ startTime: '08:00', endTime: '11:00', maxCapacity: 100 }] },
    };
    const res = createRes();

    await setupTimeSlots(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'REVIEW_REQUIRED' }),
    }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('❌ Trả 400 khi slot thiếu maxCapacity hợp lệ', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'partner-001' } });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = {
      user: { id: 'user-001' }, params: { ticketProductId: 'tkt-001' },
      body: { slots: [{ startTime: '08:00', endTime: '11:00', maxCapacity: 0 }] },
    };
    const res = createRes();
    await setupTimeSlots(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi giờ bắt đầu không trước giờ kết thúc', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'partner-001' } });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = {
      user: { id: 'user-001' }, params: { ticketProductId: 'tkt-001' },
      body: { slots: [{ startTime: '11:00', endTime: '08:00', maxCapacity: 10 }] },
    };
    const res = createRes();
    await setupTimeSlots(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('❌ Trả 400 khi các khung giờ bị chồng lấn', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'partner-001' } });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = {
      user: { id: 'user-001' }, params: { ticketProductId: 'tkt-001' },
      body: {
        slots: [
          { startTime: '08:00', endTime: '11:00', maxCapacity: 10 },
          { startTime: '10:30', endTime: '12:00', maxCapacity: 10 },
        ],
      },
    };
    const res = createRes();
    await setupTimeSlots(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('❌ Trả 403 khi không phải chủ sở hữu vé', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'other' } });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = { user: { id: 'user-001' }, params: { ticketProductId: 'tkt-001' }, body: { slots: [{ startTime: '08:00', endTime: '11:00', maxCapacity: 10 }] } };
    const res = createRes();
    await setupTimeSlots(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Trả 400 khi slots rỗng', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue({ id: 'tkt-001', attraction: { partnerId: 'partner-001' } });
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-001' });
    const req = { user: { id: 'user-001' }, params: { ticketProductId: 'tkt-001' }, body: { slots: [] } };
    const res = createRes();
    await setupTimeSlots(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
