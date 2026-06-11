jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  lookupTicketByQr,
  checkInTicket,
  listTodayBookings,
} = require('../controllers/staffController');

const TOKEN = 'qr-token-001';
const BOOKING_ID = 'booking-001';

// Hôm nay theo giờ VN (logic giống todayInVietnam) để dựng vé "đúng ngày".
const TODAY_VN = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

function makeReqRes(overrides = {}) {
  const req = {
    user: { id: 'staff-001', email: 'staff@vietticket.vn' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

function makeInstance({ ticketStatus = 'VALID', bookingStatus = 'CONFIRMED', visitDay = TODAY_VN } = {}) {
  return {
    id: 'ti-001',
    bookingId: BOOKING_ID,
    qrCodeToken: TOKEN,
    status: ticketStatus,
    updatedAt: new Date(),
    booking: {
      id: BOOKING_ID,
      status: bookingStatus,
      fullName: 'Nguyễn Văn A',
      phone: '0901234567',
      reservation: {
        date: new Date(`${visitDay}T00:00:00.000Z`),
        quantity: 2,
        timeSlot: { startTime: '08:00', endTime: '10:00' },
        ticketProduct: {
          name: 'Vé người lớn',
          attraction: { title: 'Sun World' },
        },
      },
    },
  };
}

afterEach(() => jest.clearAllMocks());

describe('lookupTicketByQr', () => {
  test('✅ Vé hợp lệ đúng ngày: canCheckIn = true', async () => {
    mockPrisma.ticketInstance.findUnique.mockResolvedValue(makeInstance());

    const { req, res, next } = makeReqRes({ params: { token: TOKEN } });
    await lookupTicketByQr(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          canCheckIn: true,
          blockReason: null,
          customer: 'Nguyễn Văn A',
          quantity: 2,
        }),
      }),
    );
  });

  test('✅ Chấp nhận chuỗi QR đầy đủ "VIETTICKET:<token>"', async () => {
    mockPrisma.ticketInstance.findUnique.mockResolvedValue(makeInstance());

    const { req, res } = makeReqRes({ params: { token: `VIETTICKET:${TOKEN}` } });
    await lookupTicketByQr(req, res, jest.fn());

    expect(mockPrisma.ticketInstance.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { qrCodeToken: TOKEN } }),
    );
  });

  test('❌ Vé đã USED: canCheckIn = false với lý do đã check-in', async () => {
    mockPrisma.ticketInstance.findUnique.mockResolvedValue(
      makeInstance({ ticketStatus: 'USED' }),
    );

    const { req, res } = makeReqRes({ params: { token: TOKEN } });
    await lookupTicketByQr(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canCheckIn: false,
          blockReason: expect.stringContaining('ĐÃ ĐƯỢC CHECK-IN'),
        }),
      }),
    );
  });

  test('❌ Vé của ngày mai: chưa tới ngày tham quan', async () => {
    const tomorrow = new Date(Date.now() + 31 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockPrisma.ticketInstance.findUnique.mockResolvedValue(
      makeInstance({ visitDay: tomorrow }),
    );

    const { req, res } = makeReqRes({ params: { token: TOKEN } });
    await lookupTicketByQr(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canCheckIn: false,
          blockReason: expect.stringContaining('chưa tới ngày tham quan'),
        }),
      }),
    );
  });

  test('❌ Không tìm thấy vé: trả 404', async () => {
    mockPrisma.ticketInstance.findUnique.mockResolvedValue(null);

    const { req, res } = makeReqRes({ params: { token: 'khong-ton-tai' } });
    await lookupTicketByQr(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('checkInTicket', () => {
  function makeTx(instance, updatedCount = 2) {
    return {
      ticketInstance: {
        findUnique: jest.fn().mockResolvedValue(instance),
        updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
      },
    };
  }

  test('✅ Check-in thành công: mọi vé VALID của đơn → USED', async () => {
    const instance = makeInstance();
    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeTx(instance);
      return fn(capturedTx);
    });

    const { req, res, next } = makeReqRes({ params: { token: TOKEN } });
    await checkInTicket(req, res, next);

    expect(capturedTx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID, status: 'VALID' },
      data: { status: 'USED' },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ checkedInCount: 2, ticketStatus: 'USED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('❌ Vé đã USED: trả 409, không update', async () => {
    const instance = makeInstance({ ticketStatus: 'USED' });
    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeTx(instance);
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({ params: { token: TOKEN } });
    await checkInTicket(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(capturedTx.ticketInstance.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Vé REFUNDED: trả 409 với thông báo hoàn tiền', async () => {
    const instance = makeInstance({ ticketStatus: 'REFUNDED' });
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(makeTx(instance)));

    const { req, res } = makeReqRes({ params: { token: TOKEN } });
    await checkInTicket(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining('hoàn tiền') }),
      }),
    );
  });

  test('❌ Đơn không CONFIRMED: trả 409', async () => {
    const instance = makeInstance({ bookingStatus: 'REFUND_REQUESTED' });
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(makeTx(instance)));

    const { req, res } = makeReqRes({ params: { token: TOKEN } });
    await checkInTicket(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('❌ Hai nhân viên quét cùng lúc: request sau nhận 409 (updateMany count = 0)', async () => {
    const instance = makeInstance();
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(makeTx(instance, 0)));

    const { req, res } = makeReqRes({ params: { token: TOKEN } });
    await checkInTicket(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('nhân viên khác'),
        }),
      }),
    );
  });

  test('❌ Không tìm thấy vé: trả 404', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn) =>
      fn({ ticketInstance: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() } }),
    );

    const { req, res } = makeReqRes({ params: { token: 'khong-ton-tai' } });
    await checkInTicket(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('listTodayBookings', () => {
  test('✅ Trả về danh sách đơn hôm nay kèm trạng thái check-in', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        id: BOOKING_ID,
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        ticketInstances: [{ status: 'USED' }, { status: 'USED' }],
        reservation: {
          quantity: 2,
          timeSlot: null,
          ticketProduct: { name: 'Vé người lớn', attraction: { title: 'Sun World' } },
        },
      },
      {
        id: 'booking-002',
        fullName: 'Trần Thị B',
        phone: null,
        ticketInstances: [{ status: 'VALID' }],
        reservation: {
          quantity: 1,
          timeSlot: { startTime: '14:00', endTime: '16:00' },
          ticketProduct: { name: 'Vé trẻ em', attraction: { title: 'Sun World' } },
        },
      },
    ]);

    const { req, res, next } = makeReqRes();
    await listTodayBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ bookingId: BOOKING_ID, checkedIn: true }),
          expect.objectContaining({ bookingId: 'booking-002', checkedIn: false }),
        ]),
        meta: expect.objectContaining({ total: 2, checkedIn: 1 }),
      }),
    );
  });

  test('✅ Chỉ truy vấn đơn CONFIRMED/COMPLETED của hôm nay', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([]);

    const { req, res } = makeReqRes();
    await listTodayBookings(req, res, jest.fn());

    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        }),
      }),
    );
  });
});
