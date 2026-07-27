'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendRefundStatusEmail: jest.fn(),
  sendReissueTicketEmail: jest.fn(),
}));
jest.mock('../controllers/paymentController', () => ({
  queryVnpayTransaction: jest.fn(),
  refundViaVnpay: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
const { todayInVietnam } = require('../utils/refundService');
const { lookupCheckinTarget } = require('../controllers/staffController');

const BOOKING_ID = 'aaaaaaaa-bbbb-cccc-dddd-1234567890ab';
// Mã đặt chỗ hiển thị = "VT-" + 12 ký tự cuối của UUID (viết hoa).
const BOOKING_REFERENCE = 'VT-1234567890AB';

function makeReqRes(overrides = {}) {
  const baseReq = {
    user: { id: 'staff-1', role: 'STAFF', employerPartnerId: 'partner-1' },
    params: {},
    query: {},
    body: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
  const req = {
    ...baseReq,
    ...overrides,
    user: { ...baseReq.user, ...(overrides.user || {}) },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

function bookingFixture(overrides = {}) {
  const today = todayInVietnam();
  const visitDate = new Date(`${today}T00:00:00.000Z`);
  return {
    id: BOOKING_ID,
    status: 'CONFIRMED',
    fullName: 'Nguyen Van A',
    phone: '0900000000',
    isForecastTrainingSample: false,
    snapshotVisitDate: visitDate,
    snapshotAttractionTitle: 'Bao tang My thuat',
    snapshotTicketName: 'Ve nguoi lon',
    snapshotTimeSlotLabel: null,
    reservation: {
      date: visitDate,
      quantity: 2,
      timeSlot: null,
      ticketProduct: {
        name: 'Ve nguoi lon',
        attraction: {
          id: 'attr-1',
          title: 'Bao tang My thuat',
          // Mở cả ngày để test không phụ thuộc giờ chạy.
          openTime: '00:00',
          closeTime: '23:59',
        },
      },
    },
    ...overrides,
  };
}

function ticketFixture(id, token, overrides = {}) {
  return {
    id,
    bookingId: BOOKING_ID,
    qrCodeToken: token,
    status: 'VALID',
    checkedInAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Mặc định: nhân viên ĐƯỢC phân công địa điểm của vé.
  prisma.staffAttractionAssignment.findFirst.mockResolvedValue({ id: 'assign-1' });
});

describe('lookupCheckinTarget - tra cứu bằng mã QR', () => {
  test('trả về TẤT CẢ vé trong đơn và đánh dấu vé vừa quét', async () => {
    const booking = bookingFixture();
    const scanned = ticketFixture('ticket-1', 'token-1');
    prisma.ticketInstance.findUnique.mockResolvedValue({ ...scanned, booking });
    prisma.ticketInstance.findMany.mockResolvedValue([
      scanned,
      ticketFixture('ticket-2', 'token-2', { status: 'USED', checkedInAt: new Date() }),
    ]);

    const { req, res, next } = makeReqRes({ query: { q: 'token-1' } });
    await lookupCheckinTarget(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.matchType).toBe('TICKET');
    expect(payload.data.tickets).toHaveLength(2);
    expect(payload.data.matchedTicketId).toBe('ticket-1');
    expect(payload.data.tickets[0]).toEqual(
      expect.objectContaining({ ticketId: 'ticket-1', token: 'token-1', isMatched: true, canCheckIn: true }),
    );
    // Vé đã dùng thì không cho check-in lại.
    expect(payload.data.tickets[1]).toEqual(
      expect.objectContaining({ ticketId: 'ticket-2', canCheckIn: false }),
    );
    expect(payload.data.summary).toEqual({ total: 2, valid: 1, used: 1, checkable: 1 });
  });

  test('bóc tiền tố VIETTICKET: trong nội dung mã QR', async () => {
    const booking = bookingFixture();
    const scanned = ticketFixture('ticket-1', 'token-1');
    prisma.ticketInstance.findUnique.mockResolvedValue({ ...scanned, booking });
    prisma.ticketInstance.findMany.mockResolvedValue([scanned]);

    const { req, res, next } = makeReqRes({ query: { q: 'VIETTICKET:token-1' } });
    await lookupCheckinTarget(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.ticketInstance.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { qrCodeToken: 'token-1' } }),
    );
  });
});

describe('lookupCheckinTarget - tra cứu bằng mã đặt chỗ VT-XXXX', () => {
  test('tìm đơn theo 12 ký tự cuối và trả về mọi vé', async () => {
    prisma.ticketInstance.findUnique.mockResolvedValue(null);
    prisma.booking.findFirst.mockResolvedValue({
      ...bookingFixture(),
      ticketInstances: [
        ticketFixture('ticket-1', 'token-1'),
        ticketFixture('ticket-2', 'token-2'),
      ],
    });

    const { req, res, next } = makeReqRes({ query: { q: BOOKING_REFERENCE } });
    await lookupCheckinTarget(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // Phải tìm theo hậu tố id, viết thường, và loại dữ liệu giả lập ML.
    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isForecastTrainingSample: false,
          id: { endsWith: '1234567890ab', mode: 'insensitive' },
        }),
      }),
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.matchType).toBe('BOOKING');
    expect(payload.data.tickets).toHaveLength(2);
    expect(payload.data.matchedTicketId).toBeNull();
    expect(payload.data.summary.checkable).toBe(2);
  });

  test('chấp nhận cả UUID đầy đủ của đơn', async () => {
    prisma.ticketInstance.findUnique.mockResolvedValue(null);
    prisma.booking.findFirst.mockResolvedValue({
      ...bookingFixture(),
      ticketInstances: [ticketFixture('ticket-1', 'token-1')],
    });

    const { req, res, next } = makeReqRes({ query: { q: BOOKING_ID } });
    await lookupCheckinTarget(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: BOOKING_ID }) }),
    );
  });

  test('đơn chưa có vé điện tử -> 409 kèm trạng thái đơn', async () => {
    prisma.ticketInstance.findUnique.mockResolvedValue(null);
    prisma.booking.findFirst.mockResolvedValue({
      ...bookingFixture({ status: 'PENDING_PAYMENT' }),
      ticketInstances: [],
    });

    const { req, res } = makeReqRes({ query: { q: BOOKING_REFERENCE } });
    await lookupCheckinTarget(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining('PENDING_PAYMENT') }),
      }),
    );
  });
});

describe('lookupCheckinTarget - lỗi đầu vào và phân quyền', () => {
  test('thiếu mã -> 400', async () => {
    const { req, res } = makeReqRes({ query: {} });
    await lookupCheckinTarget(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('không tìm thấy -> 404 và hướng dẫn nhập mã đặt chỗ', async () => {
    prisma.ticketInstance.findUnique.mockResolvedValue(null);
    prisma.booking.findFirst.mockResolvedValue(null);

    const { req, res } = makeReqRes({ query: { q: 'KHONGTONTAI123' } });
    await lookupCheckinTarget(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining('VT-') }),
      }),
    );
  });

  test('chuỗi quá ngắn không được coi là mã đặt chỗ (tránh khớp nhầm)', async () => {
    prisma.ticketInstance.findUnique.mockResolvedValue(null);

    const { req, res } = makeReqRes({ query: { q: 'VT-12' } });
    await lookupCheckinTarget(req, res, jest.fn());

    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('nhân viên chưa được phân công -> 403 nêu rõ địa điểm của vé', async () => {
    const booking = bookingFixture();
    prisma.ticketInstance.findUnique.mockResolvedValue({
      ...ticketFixture('ticket-1', 'token-1'),
      booking,
    });
    prisma.staffAttractionAssignment.findFirst.mockResolvedValue(null);
    prisma.attraction.findUnique.mockResolvedValue({ title: 'Bao tang My thuat' });
    prisma.staffAttractionAssignment.findMany.mockResolvedValue([
      { attraction: { title: 'Dinh Doc Lap' } },
    ]);

    const { req, res, next } = makeReqRes({ query: { q: 'token-1' } });
    await lookupCheckinTarget(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: expect.stringContaining('Bao tang My thuat'),
      }),
    );
    // Thông báo phải chỉ ra nhân viên đang được phân công ở đâu.
    expect(next.mock.calls[0][0].message).toContain('Dinh Doc Lap');
  });

  test('ADMIN không cần phân công vẫn tra cứu được', async () => {
    const booking = bookingFixture();
    const scanned = ticketFixture('ticket-1', 'token-1');
    prisma.ticketInstance.findUnique.mockResolvedValue({ ...scanned, booking });
    prisma.ticketInstance.findMany.mockResolvedValue([scanned]);
    prisma.staffAttractionAssignment.findFirst.mockResolvedValue(null);

    const { req, res, next } = makeReqRes({
      query: { q: 'token-1' },
      user: { id: 'admin-1', role: 'ADMIN', employerPartnerId: null },
    });
    await lookupCheckinTarget(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  test('vé thuộc dữ liệu giả lập dự báo -> 404', async () => {
    prisma.ticketInstance.findUnique.mockResolvedValue({
      ...ticketFixture('ticket-1', 'token-1'),
      booking: bookingFixture({ isForecastTrainingSample: true }),
    });

    const { req, res } = makeReqRes({ query: { q: 'token-1' } });
    await lookupCheckinTarget(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
