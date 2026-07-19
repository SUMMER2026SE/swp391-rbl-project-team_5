jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const { Prisma } = require('@prisma/client');
const mockPrisma = require('./helpers/mockPrisma');
const {
  createBooking,
  resolveBookingPaymentStatus,
  validateAndApplyVoucher,
} = require('../controllers/bookingController');

const { Decimal } = Prisma;

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

afterEach(() => jest.clearAllMocks());

describe('resolveBookingPaymentStatus', () => {
  test('ưu tiên giao dịch SUCCESS chuẩn dù lượt thử mới hơn vẫn PENDING', () => {
    expect(resolveBookingPaymentStatus([
      { id: 'new-attempt', status: 'PENDING', isDuplicate: false },
      { id: 'paid-attempt', status: 'SUCCESS', isDuplicate: false },
    ])).toBe('SUCCESS');
  });

  test('không dùng giao dịch SUCCESS trùng làm trạng thái thanh toán của đơn', () => {
    expect(resolveBookingPaymentStatus([
      { id: 'duplicate', status: 'SUCCESS', isDuplicate: true },
      { id: 'failed-attempt', status: 'FAILED', isDuplicate: false },
    ])).toBe('FAILED');
  });
});

describe('validateAndApplyVoucher', () => {
  test('tính voucher phần trăm và áp dụng maxDiscount', async () => {
    mockPrisma.voucher.findUnique.mockResolvedValue({
      id: 'voucher-1',
      code: 'VIETTICKET10',
      discountType: 'PERCENTAGE',
      discountValue: new Decimal(10),
      maxDiscount: new Decimal(50000),
      minSpend: new Decimal(150000),
      expiryDate: new Date(Date.now() + 86400000),
      isActive: true,
      usageLimit: null,
      usedCount: 0,
    });

    const req = {
      body: { voucherCode: 'vietticket10', subtotalAmount: 800000 },
    };
    const res = makeResponse();
    const next = jest.fn();

    await validateAndApplyVoucher(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          discountAmount: 50000,
          totalAmount: 750000,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('từ chối voucher khi chưa đạt minSpend', async () => {
    mockPrisma.voucher.findUnique.mockResolvedValue({
      id: 'voucher-2',
      code: 'GIAM20',
      discountType: 'FIXED',
      discountValue: new Decimal(20000),
      maxDiscount: null,
      minSpend: new Decimal(100000),
      expiryDate: new Date(Date.now() + 86400000),
      isActive: true,
      usageLimit: null,
      usedCount: 0,
    });

    const req = {
      body: { voucherCode: 'GIAM20', subtotalAmount: 90000 },
    };
    const res = makeResponse();

    await validateAndApplyVoucher(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('100.000') }),
    );
  });

  test('làm tròn voucher phần trăm về số nguyên VND theo half-up', async () => {
    mockPrisma.voucher.findUnique.mockResolvedValue({
      id: 'voucher-rounding',
      code: 'ROUND125',
      discountType: 'PERCENTAGE',
      discountValue: new Decimal('12.5'),
      maxDiscount: null,
      minSpend: null,
      expiryDate: new Date(Date.now() + 86400000),
      isActive: true,
      usageLimit: null,
      usedCount: 0,
    });
    const res = makeResponse();

    await validateAndApplyVoucher({
      body: { voucherCode: 'ROUND125', subtotalAmount: 99999 },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        discountAmount: 12500,
        totalAmount: 87499,
      }),
    }));
  });

  test('từ chối subtotal có phần lẻ VND ngay ở bước preview voucher', async () => {
    const res = makeResponse();

    await validateAndApplyVoucher({
      body: { voucherCode: 'ANY', subtotalAmount: 100000.5 },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('số nguyên VND'),
    }));
    expect(mockPrisma.voucher.findUnique).not.toHaveBeenCalled();
  });
});

describe('createBooking', () => {
  test('tính tổng tiền ở server và tăng usedCount trong transaction', async () => {
    const reservation = {
      id: 'reservation-1',
      userId: 'user-1',
      ticketProductId: 'ticket-1',
      timeSlotId: 'slot-1',
      date: new Date('2026-06-20T00:00:00.000Z'),
      quantity: 2,
      status: 'HELD',
      expiresAt: new Date(Date.now() + 600000),
      snapshotUnitPrice: new Decimal(100003),
      snapshotRefundPolicy: 'REFUND_WITH_FEE',
      snapshotRefundFeeRate: new Decimal('0.15'),
      snapshotRefundCutoffHours: 72,
      snapshotCommissionRate: new Decimal('0.25'),
      ticketProduct: {
        id: 'ticket-1',
        status: 'ACTIVE',
        archivedAt: null,
        sellingPrice: new Decimal(120000),
        attraction: {
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
          publicationStatus: 'ACTIVE',
          status: 'APPROVED',
          archivedAt: null,
          requiresManualApproval: false,
          partner: { status: 'APPROVED' },
        },
      },
    };
    const voucher = {
      id: 'voucher-1',
      code: 'GIAM20',
      discountType: 'FIXED',
      discountValue: new Decimal(20000),
      maxDiscount: null,
      minSpend: new Decimal(100000),
      expiryDate: new Date(Date.now() + 86400000),
      isActive: true,
      usageLimit: 10,
      usedCount: 1,
    };
    const tx = {
      reservation: {
        findUnique: jest.fn().mockResolvedValue(reservation),
      },
      booking: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'booking-1',
            userId: 'user-1',
            subtotalAmount: new Decimal(240000),
            discountAmount: new Decimal(20000),
            totalAmount: new Decimal(220000),
            status: 'PENDING_PAYMENT',
            paymentMethod: 'vnpay',
            fullName: 'Test User',
            email: 'test@example.com',
            phone: null,
            note: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            voucher,
            payments: [{ status: 'PENDING' }],
            ticketInstances: [],
            reservation: {
              ...reservation,
              timeSlot: { startTime: '08:00', endTime: '10:00' },
              ticketProduct: {
                ...reservation.ticketProduct,
                name: 'Vé người lớn',
                attraction: {
                  id: 'attraction-1',
                  publishedAt: new Date('2026-06-01T00:00:00.000Z'),
                  publicationStatus: 'ACTIVE',
                  status: 'APPROVED',
                  archivedAt: null,
                  title: 'Test Attraction',
                  address: '1 Test',
                  district: null,
                  city: 'Đà Nẵng',
                  images: [],
                  partner: { status: 'APPROVED' },
                },
              },
            },
          }),
        create: jest.fn().mockResolvedValue({ id: 'booking-1' }),
      },
      voucher: {
        findUnique: jest.fn().mockResolvedValue(voucher),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const req = {
      user: {
        id: 'user-1',
        fullName: 'Test User',
        email: 'test@example.com',
        profile: null,
      },
      body: {
        reservationId: 'reservation-1',
        voucherCode: 'GIAM20',
        paymentMethod: 'vnpay',
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    await createBooking(req, res, next);

    expect(tx.voucher.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { usedCount: { increment: 1 } },
      }),
    );
    expect(tx.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotalAmount: expect.any(Decimal),
          discountAmount: expect.any(Decimal),
          totalAmount: expect.any(Decimal),
        }),
      }),
    );
    const createData = tx.booking.create.mock.calls[0][0].data;
    expect(createData.subtotalAmount.toString()).toBe('200006');
    expect(createData.discountAmount.toString()).toBe('20000');
    expect(createData.totalAmount.toString()).toBe('180006');
    expect(createData.snapshotUnitPrice.toString()).toBe('100003');
    expect(createData.snapshotRefundPolicy).toBe('REFUND_WITH_FEE');
    expect(createData.snapshotRefundFeeRate.toString()).toBe('0.15');
    expect(createData.snapshotRefundCutoffHours).toBe(72);
    expect(createData.commissionRateSnapshot).toBe(0.25);
    expect(createData.commissionAmountSnapshot.toString()).toBe('45002');
    expect(createData.partnerNetAmountSnapshot.toString()).toBe('135004');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    [120000.5, 'số nguyên VND'],
    [2000, 'tối thiểu'],
  ])('không tạo booking có price/total không thể thanh toán-an-toàn: %p', async (
    sellingPrice,
    expectedMessage,
  ) => {
    const reservation = {
      id: 'reservation-invalid-money',
      userId: 'user-1',
      ticketProductId: 'ticket-1',
      timeSlotId: null,
      date: new Date('2026-06-20T00:00:00.000Z'),
      quantity: 1,
      status: 'HELD',
      expiresAt: new Date(Date.now() + 600000),
      timeSlot: null,
      ticketProduct: {
        id: 'ticket-1',
        name: 'Vé',
        type: 'ADULT',
        description: '',
        sellingPrice: new Decimal(sellingPrice),
        refundPolicy: 'NON_REFUNDABLE',
        refundFeeRate: new Decimal(0),
        refundCutoffHours: 24,
        status: 'ACTIVE',
        archivedAt: null,
        attraction: {
          id: 'attraction-1',
          title: 'Điểm đến',
          address: '1 Test',
          city: 'Đà Nẵng',
          district: null,
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
          publicationStatus: 'ACTIVE',
          status: 'APPROVED',
          archivedAt: null,
          images: [],
          partner: { status: 'APPROVED', commissionRate: new Decimal('0.1') },
        },
      },
    };
    const tx = {
      reservation: { findUnique: jest.fn().mockResolvedValue(reservation) },
      booking: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    const res = makeResponse();

    await createBooking({
      user: { id: 'user-1', fullName: 'Test', email: 'test@example.com' },
      body: {
        reservationId: reservation.id,
        paymentMethod: 'vnpay',
      },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining(expectedMessage),
    }));
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
});
