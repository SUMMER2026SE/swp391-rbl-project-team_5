jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  getPartnerBookings,
  approveBooking,
  rejectBooking,
  cancelConfirmedBooking,
  getDashboard,
} = require('../controllers/partnerController');

// ─── Helpers ────────────────────────────────────────────────────────────────
const PARTNER_ID   = 'partner-001';
const BOOKING_ID   = 'booking-001';
const ATTRACTION_ID = 'attraction-001';
const TICKET_ID    = 'ticket-001';
const RESERVATION_ID = 'reservation-001';
const FUTURE_VISIT_DATE = new Date(Date.now() + 48 * 60 * 60 * 1000);

function makeReqRes(overrides = {}) {
  const req = {
    partner: { id: PARTNER_ID },
    user:    { id: 'user-001' },
    params:  {},
    query:   {},
    body:    {},
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

// Booking mẫu thuộc partner-001
function makeBooking(statusOverride = 'PENDING_PARTNER') {
  return {
    id: BOOKING_ID,
    userId: 'user-001',
    reservationId: RESERVATION_ID,
    status: statusOverride,
    totalAmount: 500000,
    fullName: 'Nguyễn Văn A',
    phone: '0901234567',
    createdAt: new Date(),
    ticketInstances: [],
    // PENDING_PARTNER nghĩa là đã thanh toán thành công qua cổng
    payments: [{
      id: 'pay-001',
      status: 'SUCCESS',
      isDuplicate: false,
      paymentGateway: 'VNPAY',
      amount: 500000,
      paidAt: new Date(),
      createdAt: new Date(),
    }],
    refundRequests: [],
    reservation: {
      id: RESERVATION_ID,
      ticketProductId: TICKET_ID,
      timeSlotId: null,
      date: FUTURE_VISIT_DATE,
      quantity: 2,
      status: statusOverride === 'CONFIRMED' ? 'CONFIRMED' : 'HELD',
      ticketProduct: {
        id: TICKET_ID,
        attractionId: ATTRACTION_ID,
        name: 'Vé người lớn',
        attraction: {
          id: ATTRACTION_ID,
          title: 'Sun World',
          partnerId: PARTNER_ID,
          openTime: '08:00',
          closeTime: '17:00',
        },
      },
    },
  };
}

afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// 1. getPartnerBookings
// ═══════════════════════════════════════════════════════════════════════════
describe('getPartnerBookings', () => {
  test('✅ Trả về danh sách có phân trang khi có dữ liệu', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([{ id: ATTRACTION_ID }]);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([{ id: RESERVATION_ID }]);
    mockPrisma.booking.count.mockResolvedValue(1);
    mockPrisma.booking.findMany
      .mockResolvedValueOnce([
      {
        id: BOOKING_ID,
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        totalAmount: 500000,
        status: 'PENDING_PARTNER',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        reservation: {
          date: new Date('2026-06-10T00:00:00Z'),
          quantity: 2,
          timeSlot: null,
          ticketProduct: {
            name: 'Vé người lớn',
            attraction: { title: 'Sun World' },
          },
        },
      },
      ])
      .mockResolvedValueOnce([
        {
          status: 'COMPLETED',
          commissionRateSnapshot: 0.16,
          commissionAmountSnapshot: 80000,
          partnerNetAmountSnapshot: 420000,
          payments: [{ amount: 500000 }],
          refundTransactions: [],
        },
      ]);
    mockPrisma.booking.groupBy.mockResolvedValue([
      { status: 'CONFIRMED', _count: { _all: 3 } },
      { status: 'PENDING_PARTNER', _count: { _all: 2 } },
    ]);

    const { req, res, next } = makeReqRes({ query: { page: '1', limit: '10' } });
    await getPartnerBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: BOOKING_ID,
            status: 'pending_partner',
            customer: 'Nguyễn Văn A',
          }),
        ]),
        pagination: expect.objectContaining({ total: 1, page: 1 }),
        stats: {
          total: 5,
          confirmed: 3,
          pendingPartner: 2,
          recognizedRevenue: 420000,
        },
      }),
    );
    expect(mockPrisma.booking.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        payments: { some: { status: 'SUCCESS', isDuplicate: false } },
        status: { not: 'PENDING_PAYMENT' },
      }),
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('✅ Trả về mảng rỗng khi partner chưa có attraction', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: {} });
    await getPartnerBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
    expect(res.json.mock.calls[0][0].stats).toEqual({
      total: 0,
      confirmed: 0,
      pendingPartner: 0,
      recognizedRevenue: 0,
    });
  });

  test('✅ Trả về mảng rỗng khi không có ticketProduct', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([{ id: ATTRACTION_ID }]);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: {} });
    await getPartnerBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
  });

  test('✅ Trả về mảng rỗng khi không có reservation', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([{ id: ATTRACTION_ID }]);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: {} });
    await getPartnerBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
  });

  test('✅ Lọc đúng theo status=confirmed', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([{ id: ATTRACTION_ID }]);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([{ id: RESERVATION_ID }]);
    mockPrisma.booking.count.mockResolvedValue(0);
    mockPrisma.booking.findMany.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: { status: 'confirmed' } });
    await getPartnerBookings(req, res, next);

    // Đảm bảo where clause có status: 'CONFIRMED'
    expect(mockPrisma.booking.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
  });

  test('✅ Page và limit được clamp đúng (limit max 50)', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([{ id: ATTRACTION_ID }]);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([{ id: RESERVATION_ID }]);
    mockPrisma.booking.count.mockResolvedValue(0);
    mockPrisma.booking.findMany.mockResolvedValue([]);

    const { req, res } = makeReqRes({ query: { page: '0', limit: '999' } });
    await getPartnerBookings(req, res, jest.fn());

    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }), // page=max(1,0)=1, limit=min(50,999)=50
    );
  });

  test('❌ Gọi next(error) khi DB ném lỗi', async () => {
    mockPrisma.attraction.findMany.mockRejectedValue(new Error('DB error'));

    const { req, res, next } = makeReqRes({ query: {} });
    await getPartnerBookings(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. approveBooking
// ═══════════════════════════════════════════════════════════════════════════
// Tạo tx mock cho approveBooking: controller re-read booking TRONG transaction
// nên tx.booking.findUnique phải trả về trạng thái hiện tại của đơn.
function makeApproveTx(booking, { existingTicketCount = 0, claimCount = 1 } = {}) {
  return {
    dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ticketProduct: { findUnique: jest.fn().mockResolvedValue({ attractionId: ATTRACTION_ID }) },
    reservation:   { update:     jest.fn().mockResolvedValue({}) },
    booking:       {
      findUnique: jest.fn().mockResolvedValue(booking),
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
    },
    ticketInstance: {
      count:      jest.fn().mockResolvedValue(existingTicketCount),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

describe('approveBooking', () => {
  test('✅ Duyệt thành công: booking PENDING_PARTNER → CONFIRMED + tạo TicketInstance', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(makeApproveTx(booking)));

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ id: BOOKING_ID, status: 'confirmed' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('✅ Duyệt thành công: DailyStock.heldQuantity-- và bookedQuantity++ khi reservation HELD', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeApproveTx(booking);
      return fn(capturedTx);
    });

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(capturedTx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: 'PENDING_PARTNER' },
      data: { status: 'CONFIRMED' },
    });
    expect(capturedTx.dailyStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          heldQuantity:  { decrement: 2 },
          bookedQuantity: { increment: 2 },
        }),
      }),
    );
    expect(capturedTx.ticketInstance.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ bookingId: BOOKING_ID, ticketProductId: TICKET_ID }),
        ]),
      }),
    );
  });

  test('✅ Không tạo TicketInstance trùng nếu đã tồn tại (đếm lại trong transaction)', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeApproveTx(booking, { existingTicketCount: 2 });
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, jest.fn());

    // createMany không được gọi vì tx.ticketInstance.count > 0
    expect(capturedTx.ticketInstance.createMany).not.toHaveBeenCalled();
  });

  test('❌ Hai request duyệt đồng thời: request sau bị chặn 409 vì re-read trong transaction', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    // Trong transaction, đơn đã bị request trước chuyển sang CONFIRMED
    const confirmedInside = { ...booking, status: 'CONFIRMED' };
    mockPrisma.$transaction.mockImplementation(async (fn) =>
      fn(makeApproveTx(confirmedInside)),
    );

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  test('❌ Hai request duyệt đồng thời: claim thất bại thì không trừ kho hoặc tạo vé', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeApproveTx(booking, { claimCount: 0 });
      return fn(capturedTx);
    });

    const { req, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(capturedTx.dailyStock.updateMany).not.toHaveBeenCalled();
    expect(capturedTx.ticketInstance.createMany).not.toHaveBeenCalled();
  });

  test('❌ Trả 404 khi không tìm thấy booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null);

    const { req, res, next } = makeReqRes({ params: { id: 'not-exist' } });
    await approveBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  test('❌ Trả 403 khi booking thuộc partner khác', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    booking.reservation.ticketProduct.attraction.partnerId = 'other-partner';
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Trả 400 khi booking ở trạng thái PENDING_PAYMENT (chưa thanh toán)', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('chờ đối tác duyệt') }),
    );
  });

  test('❌ Trả 400 khi booking đã CONFIRMED', async () => {
    const booking = makeBooking('CONFIRMED');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('đã được xác nhận') }),
    );
  });

  test('❌ Trả 400 khi booking đã CANCELLED', async () => {
    const booking = makeBooking('CANCELLED');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Gọi next(error) khi transaction ném lỗi', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);
    mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. rejectBooking
// ═══════════════════════════════════════════════════════════════════════════
describe('rejectBooking', () => {
  const REASON = 'Khung giờ này đã kín chỗ do sự cố vận hành';

  function makeRejectTx(booking = makeBooking('PENDING_PARTNER'), { claimCount = 1 } = {}) {
    return {
      dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      reservation:   { update:     jest.fn().mockResolvedValue({}) },
      booking:       {
        findUnique:  jest.fn().mockResolvedValue(booking),
        updateMany:  jest.fn().mockResolvedValue({ count: claimCount }),
      },
      refundRequest: {
        upsert: jest.fn().mockResolvedValue({ id: 'refund-001', status: 'PROCESSING' }),
        update: jest.fn(),
      },
      refundTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'refund-tx-001', status: 'PENDING' }),
      },
      voucher:       { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }

  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(makeRejectTx()));
  });

  test('✅ Từ chối thành công: booking → CANCELLED + hoàn trả DailyStock (reservation HELD)', async () => {
    const booking = makeBooking('PENDING_PARTNER'); // reservation.status = HELD
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking);
      return fn(capturedTx);
    });

    const { req, res, next } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'cancelled', refundRequired: true }),
      }),
    );
    // Khi reservation HELD → heldQuantity được giảm
    expect(capturedTx.dailyStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ heldQuantity: { decrement: 2 } }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('✅ Đơn đã thanh toán: gắn refundRequired + tạo RefundRequest hoàn 100%', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking);
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: 'PENDING_PARTNER' },
      data: expect.objectContaining({ status: 'CANCELLED', refundRequired: true }),
    });
    expect(capturedTx.refundRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestKey: `mandatory:PARTNER_CANCELLATION:${BOOKING_ID}` },
        create: expect.objectContaining({
          bookingId: BOOKING_ID,
          amount: 500000, // hoàn 100%, không trừ phí
          status: 'PROCESSING',
          type: 'PARTNER_CANCELLATION',
          mandatory: true,
          reason: expect.stringContaining(REASON),
        }),
      }),
    );
    expect(capturedTx.refundTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: BOOKING_ID,
          paymentId: 'pay-001',
          refundRequestId: 'refund-001',
          status: 'PENDING',
        }),
      }),
    );
  });

  test('✅ Đơn CHƯA thanh toán: không gắn refundRequired, không tạo RefundRequest', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    booking.payments = []; // chưa có payment SUCCESS
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking);
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: 'PENDING_PARTNER' },
      data: expect.objectContaining({ status: 'CANCELLED', refundRequired: false }),
    });
    expect(capturedTx.refundRequest.upsert).not.toHaveBeenCalled();
  });

  test('✅ Dùng requestKey riêng để không xung đột với yêu cầu hoàn tiền khác của booking', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    booking.refundRequests = [{ id: 'refund-cũ' }];
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking);
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.refundRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestKey: `mandatory:PARTNER_CANCELLATION:${BOOKING_ID}` },
      }),
    );
  });

  test('❌ Hai request từ chối đồng thời: claim thất bại thì không hoàn kho hoặc tạo refund', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking, { claimCount: 0 });
      return fn(capturedTx);
    });

    const { req, next } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(capturedTx.dailyStock.updateMany).not.toHaveBeenCalled();
    expect(capturedTx.refundRequest.upsert).not.toHaveBeenCalled();
  });

  test('❌ Trả 400 khi thiếu lý do từ chối', async () => {
    const { req, res } = makeReqRes({ params: { id: BOOKING_ID }, body: {} });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('lý do') }),
    );
    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled();
  });

  test('❌ Trả 400 khi từ chối booking đã CONFIRMED', async () => {
    const booking = makeBooking('CONFIRMED');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ Reservation và Booking đều được update → CANCELLED', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking);
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(capturedTx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: 'PENDING_PARTNER' },
      data: expect.objectContaining({ status: 'CANCELLED', refundRequired: true }),
    });
  });

  test('✅ Hoàn trả TimeSlotStock nếu reservation có timeSlotId', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    booking.reservation.timeSlotId = 'slot-001';
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      capturedTx = makeRejectTx(booking);
      return fn(capturedTx);
    });

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.timeSlotStock.updateMany).toHaveBeenCalled();
  });

  test('❌ Trả 404 khi không tìm thấy booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null);

    const { req, res, next } = makeReqRes({
      params: { id: 'not-exist' },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('❌ Trả 403 khi booking thuộc partner khác', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    booking.reservation.ticketProduct.attraction.partnerId = 'another-partner';
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Trả 400 khi booking ở trạng thái PENDING_PAYMENT (chưa thanh toán)', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('chờ đối tác duyệt') }),
    );
  });

  test('❌ Trả 400 khi booking đã CANCELLED', async () => {
    const booking = makeBooking('CANCELLED');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('chờ đối tác duyệt') }), // CANCELLED falls under status !== 'PENDING_PARTNER'
    );
  });

  test('❌ Gọi next(error) khi transaction ném lỗi', async () => {
    const booking = makeBooking('PENDING_PARTNER');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);
    mockPrisma.$transaction.mockRejectedValue(new Error('Transaction error'));

    const { req, res, next } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await rejectBooking(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. getDashboard
// ═══════════════════════════════════════════════════════════════════════════
describe('getDashboard', () => {
  test('✅ Trả về stats đầy đủ khi có dữ liệu thật', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      { id: ATTRACTION_ID, status: 'APPROVED', publicationStatus: 'ACTIVE' },
    ]);
    mockPrisma.ticketProduct.count.mockResolvedValue(3);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([{ id: RESERVATION_ID }]);

    // Booking tháng này
    mockPrisma.booking.findMany
      .mockResolvedValueOnce([
        {
          createdAt: new Date(),
          payments: [{ amount: 300000 }],
          reservation: { quantity: 1 },
        },
        {
          createdAt: new Date(),
          payments: [{ amount: 200000 }],
          reservation: { quantity: 1 },
        },
      ])
      .mockResolvedValueOnce([ // recentRaw
        {
          id: BOOKING_ID,
          fullName: 'Nguyễn Văn A',
          totalAmount: 500000,
          status: 'CONFIRMED',
          createdAt: new Date('2026-06-01T00:00:00Z'),
          reservation: {
            ticketProduct: {
              name: 'Vé người lớn',
              attraction: { title: 'Sun World' },
            },
          },
        },
      ]);
    mockPrisma.booking.count.mockResolvedValue(2); // pendingBookings
    mockPrisma.dailyStock.findMany.mockResolvedValue([]);

    const { req, res, next } = makeReqRes();
    await getDashboard(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({
          totalAttractions:        1,
          activeAttractions:       1,
          totalTickets:            3,
          totalBookingsThisMonth:  2,
          revenueThisMonth:        500000, // 300000 + 200000
          pendingBookings:         2,
        }),
        recentBookings: expect.arrayContaining([
          expect.objectContaining({ customer: 'Nguyễn Văn A' }),
        ]),
      }),
    );
    expect(mockPrisma.booking.findMany.mock.calls[1][0].where).toEqual(
      expect.objectContaining({
        status: { not: 'PENDING_PAYMENT' },
        payments: { some: { status: 'SUCCESS', isDuplicate: false } },
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('✅ Trả về stats = 0 khi partner chưa có attraction', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);
    mockPrisma.ticketProduct.count.mockResolvedValue(0);

    const { req, res } = makeReqRes();
    await getDashboard(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({
          totalAttractions:       0,
          totalBookingsThisMonth: 0,
          revenueThisMonth:       0,
          pendingBookings:        0,
        }),
        recentBookings: [],
      }),
    );
  });

  test('✅ Trả về stats booking = 0 khi không có reservation', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([{ id: ATTRACTION_ID, status: 'APPROVED' }]);
    mockPrisma.ticketProduct.count.mockResolvedValue(2);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([]); // không có reservation

    const { req, res } = makeReqRes();
    await getDashboard(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({
          totalBookingsThisMonth: 0,
          revenueThisMonth:       0,
        }),
      }),
    );
  });

  test('❌ Gọi next(error) khi DB ném lỗi', async () => {
    mockPrisma.attraction.findMany.mockRejectedValue(new Error('DB error'));

    const { req, res, next } = makeReqRes();
    await getDashboard(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('cancelConfirmedBooking', () => {
  const REASON = 'Diem tham quan dong cua dot xuat de bao tri';

  function makeCancelTx(booking) {
    return {
      booking: {
        findUnique: jest.fn().mockResolvedValue(booking),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      reservation: { update: jest.fn().mockResolvedValue({}) },
      ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      voucher: { updateMany: jest.fn() },
      refundRequest: {
        upsert: jest.fn().mockResolvedValue({ id: 'refund-cancel', status: 'PROCESSING' }),
        update: jest.fn(),
      },
      refundTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'refund-tx-cancel', status: 'PENDING' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
  }

  test('cancels an unused confirmed booking, releases inventory and queues a full refund', async () => {
    const booking = makeBooking('CONFIRMED');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);
    let tx;
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      tx = makeCancelTx(booking);
      return callback(tx);
    });

    const { req, res, next } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await cancelConfirmedBooking(req, res, next);

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: 'CONFIRMED' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        refundRequired: true,
        cancellationReason: REASON,
        cancellationSource: 'PARTNER',
      }),
    });
    expect(tx.dailyStock.updateMany).toHaveBeenCalled();
    expect(tx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID, status: 'VALID' },
      data: { status: 'EXPIRED' },
    });
    expect(tx.refundTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 500000, status: 'PENDING' }),
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('does not cancel a confirmed booking after its activity has started', async () => {
    const booking = makeBooking('CONFIRMED');
    booking.reservation.date = new Date('2026-01-01T00:00:00.000Z');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({
      params: { id: BOOKING_ID },
      body: { reason: REASON },
    });
    await cancelConfirmedBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
