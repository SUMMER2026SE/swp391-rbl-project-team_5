jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const { getAdminBookings } = require('../controllers/adminController');

function makeReqRes(query = {}) {
  const req = { user: { id: 'admin-001', role: 'ADMIN' }, query, params: {}, body: {} };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

function makeBookingRow(overrides = {}) {
  return {
    id: 'booking-001',
    fullName: 'Nguyễn Văn A',
    email: 'a@example.com',
    phone: '0901234567',
    totalAmount: 500000,
    status: 'CONFIRMED',
    refundRequired: false,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    payments: [{ paymentGateway: 'VNPAY', status: 'SUCCESS', amount: 500000, createdAt: new Date() }],
    refundRequests: [],
    reservation: {
      date: new Date('2026-06-15T00:00:00.000Z'),
      quantity: 2,
      timeSlot: { startTime: '08:00', endTime: '10:00' },
      ticketProduct: {
        name: 'Vé người lớn',
        attraction: { title: 'Sun World', partner: { businessName: 'Sun Group' } },
      },
    },
    ...overrides,
  };
}

function mockHappyPath(rows = [makeBookingRow()]) {
  mockPrisma.booking.count
    .mockResolvedValueOnce(rows.length) // total theo filter
    .mockResolvedValueOnce(1); // refundRequired count
  mockPrisma.booking.findMany.mockResolvedValue(rows);
  mockPrisma.booking.groupBy.mockResolvedValue([
    { status: 'CONFIRMED', _count: { _all: 5 } },
    { status: 'CANCELLED', _count: { _all: 2 } },
  ]);
  mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 2500000 } });
}

afterEach(() => jest.clearAllMocks());

describe('getAdminBookings', () => {
  test('✅ Trả về danh sách phẳng + pagination + stats', async () => {
    mockHappyPath();

    const { req, res, next } = makeReqRes({ page: '1', limit: '10' });
    await getAdminBookings(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: [
          expect.objectContaining({
            id: 'booking-001',
            customer: 'Nguyễn Văn A',
            attraction: 'Sun World',
            partner: 'Sun Group',
            visitDate: '2026-06-15',
            timeSlot: '08:00 - 10:00',
            paymentGateway: 'VNPAY',
            paymentStatus: 'SUCCESS',
            totalAmount: 500000,
          }),
        ],
        pagination: expect.objectContaining({ total: 1, page: 1 }),
        stats: expect.objectContaining({
          countsByStatus: { CONFIRMED: 5, CANCELLED: 2 },
          refundRequired: 1,
          grossRevenue: 2500000,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('✅ Lọc theo status hợp lệ', async () => {
    mockHappyPath([]);

    const { req, res } = makeReqRes({ status: 'refund_requested' });
    await getAdminBookings(req, res, jest.fn());

    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'REFUND_REQUESTED' }),
      }),
    );
  });

  test('✅ Lọc refundRequired=true', async () => {
    mockHappyPath([]);

    const { req, res } = makeReqRes({ refundRequired: 'true' });
    await getAdminBookings(req, res, jest.fn());

    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ refundRequired: true }),
      }),
    );
  });

  test('❌ Status không hợp lệ: trả 400', async () => {
    const { req, res } = makeReqRes({ status: 'NOT_A_STATUS' });
    await getAdminBookings(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ Search áp dụng OR theo mã đơn / tên / email / địa điểm', async () => {
    mockHappyPath([]);

    const { req, res } = makeReqRes({ search: 'Sun' });
    await getAdminBookings(req, res, jest.fn());

    const where = mockPrisma.booking.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(4);
  });

  test('❌ Gọi next(error) khi DB ném lỗi', async () => {
    mockPrisma.booking.count.mockRejectedValue(new Error('DB error'));
    mockPrisma.booking.findMany.mockRejectedValue(new Error('DB error'));
    mockPrisma.booking.groupBy.mockRejectedValue(new Error('DB error'));
    mockPrisma.payment.aggregate.mockRejectedValue(new Error('DB error'));

    const { req, res, next } = makeReqRes();
    await getAdminBookings(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
