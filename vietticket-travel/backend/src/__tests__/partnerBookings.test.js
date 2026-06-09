jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const {
  getPartnerBookings,
  approveBooking,
  rejectBooking,
  getDashboard,
} = require('../controllers/partnerController');

// ─── Helpers ────────────────────────────────────────────────────────────────
const PARTNER_ID   = 'partner-001';
const BOOKING_ID   = 'booking-001';
const ATTRACTION_ID = 'attraction-001';
const TICKET_ID    = 'ticket-001';
const RESERVATION_ID = 'reservation-001';

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
function makeBooking(statusOverride = 'PENDING_PAYMENT') {
  return {
    id: BOOKING_ID,
    userId: 'user-001',
    reservationId: RESERVATION_ID,
    status: statusOverride,
    totalAmount: 500000,
    fullName: 'Nguyễn Văn A',
    phone: '0901234567',
    createdAt: new Date('2026-06-01T08:00:00Z'),
    ticketInstances: [],
    reservation: {
      id: RESERVATION_ID,
      ticketProductId: TICKET_ID,
      timeSlotId: null,
      date: new Date('2026-06-10T00:00:00Z'),
      quantity: 2,
      status: statusOverride === 'CONFIRMED' ? 'CONFIRMED' : 'HELD',
      ticketProduct: {
        id: TICKET_ID,
        name: 'Vé người lớn',
        attraction: {
          id: ATTRACTION_ID,
          title: 'Sun World',
          partnerId: PARTNER_ID,
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
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        id: BOOKING_ID,
        fullName: 'Nguyễn Văn A',
        phone: '0901234567',
        totalAmount: 500000,
        status: 'PENDING_PAYMENT',
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
    ]);

    const { req, res, next } = makeReqRes({ query: { page: '1', limit: '10' } });
    await getPartnerBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: BOOKING_ID,
            status: 'pending_partner', // PENDING_PAYMENT → pending_partner
            customer: 'Nguyễn Văn A',
          }),
        ]),
        pagination: expect.objectContaining({ total: 1, page: 1 }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('✅ Trả về mảng rỗng khi partner chưa có attraction', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: {} });
    await getPartnerBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
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
describe('approveBooking', () => {
  // Setup $transaction để thực thi callback thật
  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CONFIRMED' }) },
        ticketInstance:{ createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };
      return fn(tx);
    });
  });

  test('✅ Duyệt thành công: booking PENDING_PAYMENT → CONFIRMED + tạo TicketInstance', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

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
    const booking = makeBooking('PENDING_PAYMENT');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CONFIRMED' }) },
        ticketInstance:{ createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };
      capturedTx = tx;
      return fn(tx);
    });

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

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

  test('✅ Không tạo TicketInstance trùng nếu đã tồn tại', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    booking.ticketInstances = [{ id: 'ti-001' }]; // đã có
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn() },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID }) },
        ticketInstance:{ createMany: jest.fn() },
      };
      capturedTx = tx;
      return fn(tx);
    });

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, jest.fn());

    // createMany không được gọi vì ticketInstances.length > 0
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
    const booking = makeBooking('PENDING_PAYMENT');
    booking.reservation.ticketProduct.attraction.partnerId = 'other-partner';
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await approveBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
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
    const booking = makeBooking('PENDING_PAYMENT');
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
  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CANCELLED' }) },
      };
      return fn(tx);
    });
  });

  test('✅ Từ chối thành công: booking → CANCELLED + hoàn trả DailyStock (reservation HELD)', async () => {
    const booking = makeBooking('PENDING_PAYMENT'); // reservation.status = HELD
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn() },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CANCELLED' }) },
      };
      capturedTx = tx;
      return fn(tx);
    });

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
    await rejectBooking(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'cancelled' }),
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

  test('✅ Từ chối booking đã CONFIRMED: hoàn trả bookedQuantity', async () => {
    const booking = makeBooking('CONFIRMED'); // reservation.status = CONFIRMED
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn() },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CANCELLED' }) },
      };
      capturedTx = tx;
      return fn(tx);
    });

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await rejectBooking(req, res, jest.fn());

    // reservation CONFIRMED → bookedQuantity được hoàn trả
    expect(capturedTx.dailyStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bookedQuantity: { decrement: 2 } }),
      }),
    );
  });

  test('✅ Reservation và Booking đều được update → CANCELLED', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn() },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CANCELLED' }) },
      };
      capturedTx = tx;
      return fn(tx);
    });

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(capturedTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
  });

  test('✅ Hoàn trả TimeSlotStock nếu reservation có timeSlotId', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    booking.reservation.timeSlotId = 'slot-001';
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    let capturedTx;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        dailyStock:    { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        reservation:   { update:     jest.fn().mockResolvedValue({}) },
        booking:       { update:     jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CANCELLED' }) },
      };
      capturedTx = tx;
      return fn(tx);
    });

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await rejectBooking(req, res, jest.fn());

    expect(capturedTx.timeSlotStock.updateMany).toHaveBeenCalled();
  });

  test('❌ Trả 404 khi không tìm thấy booking', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null);

    const { req, res, next } = makeReqRes({ params: { id: 'not-exist' } });
    await rejectBooking(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('❌ Trả 403 khi booking thuộc partner khác', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    booking.reservation.ticketProduct.attraction.partnerId = 'another-partner';
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Trả 400 khi booking đã CANCELLED', async () => {
    const booking = makeBooking('CANCELLED');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);

    const { req, res } = makeReqRes({ params: { id: BOOKING_ID } });
    await rejectBooking(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('đã bị hủy') }),
    );
  });

  test('❌ Gọi next(error) khi transaction ném lỗi', async () => {
    const booking = makeBooking('PENDING_PAYMENT');
    mockPrisma.booking.findUnique.mockResolvedValue(booking);
    mockPrisma.$transaction.mockRejectedValue(new Error('Transaction error'));

    const { req, res, next } = makeReqRes({ params: { id: BOOKING_ID } });
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
      { id: ATTRACTION_ID, status: 'APPROVED' },
    ]);
    mockPrisma.ticketProduct.count.mockResolvedValue(3);
    mockPrisma.ticketProduct.findMany.mockResolvedValue([{ id: TICKET_ID }]);
    mockPrisma.reservation.findMany.mockResolvedValue([{ id: RESERVATION_ID }]);

    // Booking tháng này
    mockPrisma.booking.findMany
      .mockResolvedValueOnce([{ totalAmount: 300000 }, { totalAmount: 200000 }]) // bookingsThisMonth
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
