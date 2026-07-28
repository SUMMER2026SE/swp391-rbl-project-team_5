jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const { Prisma } = require('@prisma/client');
const mockPrisma = require('./helpers/mockPrisma');
const {
  createBooking,
  buildManualApprovalView,
  confirmReservationAndStock,
  extractItineraryTicketItems,
  getItineraryBookingProgress,
  itineraryContainsReservation,
  resolveBookingPaymentStatus,
  validateItineraryBookingContext,
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

describe('manual approval booking view', () => {
  test('exposes payment-before-approval policy and the exact earlier deadline', () => {
    const view = buildManualApprovalView({
      status: 'PENDING_PARTNER',
      snapshotVisitDate: new Date('2026-07-29T00:00:00.000Z'),
      snapshotActivityStartTime: '08:00',
      payments: [{
        status: 'SUCCESS',
        isDuplicate: false,
        paidAt: new Date('2026-07-28T10:00:00.000Z'),
      }],
      reservation: {},
    });

    expect(view).toEqual({
      required: true,
      paymentCapturedBeforeApproval: true,
      approvalDeadline: new Date('2026-07-29T01:00:00.000Z'),
      maximumResponseHours: 24,
      deadlineRule: 'EARLIER_OF_24_HOURS_OR_ACTIVITY_START',
      timeoutOutcome: 'CANCEL_AND_MANDATORY_FULL_REFUND',
    });
  });

  test('does not expose a pending approval policy for an already confirmed booking', () => {
    expect(buildManualApprovalView({ status: 'CONFIRMED' })).toBeNull();
  });
});

describe('confirmReservationAndStock', () => {
  test('chuyển đúng 8 chỗ cho 2 gói gia đình 4 khách', async () => {
    const tx = {
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      reservation: { update: jest.fn().mockResolvedValue({}) },
    };
    const reservation = {
      id: 'reservation-family',
      ticketProductId: 'ticket-family',
      timeSlotId: 'slot-family',
      date: new Date('2026-08-20T00:00:00.000Z'),
      quantity: 2,
      snapshotAdmissionCount: 4,
      status: 'HELD',
      ticketProduct: { attractionId: 'attraction-1' },
    };

    await confirmReservationAndStock(tx, reservation);

    expect(tx.dailyStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ heldQuantity: { gte: 8 } }),
      data: {
        heldQuantity: { decrement: 8 },
        bookedQuantity: { increment: 8 },
      },
    }));
    expect(tx.attractionDailyStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        heldQty: { decrement: 8 },
        bookedQty: { increment: 8 },
      },
    }));
    expect(tx.timeSlotStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        heldQty: { decrement: 8 },
        bookedQty: { increment: 8 },
      },
    }));
  });
});

describe('itinerary booking context', () => {
  const itinerary = {
    id: 'itinerary-1',
    data: {
      startDate: '2026-08-20',
      days: [{
        day: 1,
        visitDate: '2026-08-20',
        activities: [{
          attractionId: 'attraction-1',
          ticketItems: [{
            ticketId: 'ticket-1',
            quantity: 2,
            suggestedTimeSlot: { timeSlotId: 'slot-1' },
          }],
        }],
      }],
    },
    partyRoom: {
      id: 'room-1',
      status: 'FINALIZED',
      version: 7,
      bookingStartedAt: null,
      bookingVersion: null,
    },
  };
  const reservation = {
    ticketProductId: 'ticket-1',
    timeSlotId: 'slot-1',
    date: new Date('2026-08-20T00:00:00.000Z'),
    quantity: 2,
    ticketProduct: { attractionId: 'attraction-1' },
  };

  test('chỉ chấp nhận đúng dòng vé đã chốt, gồm ngày, slot và số lượng', () => {
    const [item] = extractItineraryTicketItems(itinerary);

    expect(item.id).toBe('attraction-1__ticket-1__2026-08-20__slot-1__0');
    expect(itineraryContainsReservation(itinerary, reservation)).toBe(true);
    expect(itineraryContainsReservation(itinerary, {
      ...reservation,
      quantity: 3,
    })).toBe(false);
  });

  test('khóa phiên bản phòng ở lần tạo booking đầu tiên', async () => {
    const [item] = extractItineraryTicketItems(itinerary);
    const tx = {
      savedItinerary: { findFirst: jest.fn().mockResolvedValue(itinerary) },
      booking: { findFirst: jest.fn().mockResolvedValue(null) },
      partyRoom: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const now = new Date('2026-08-01T00:00:00.000Z');

    await expect(validateItineraryBookingContext(tx, {
      context: { itineraryId: itinerary.id, itemId: item.id, version: 7 },
      reservation,
      userId: 'user-1',
      now,
    })).resolves.toBe(itinerary);
    expect(tx.partyRoom.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'room-1',
        status: 'FINALIZED',
        version: 7,
        bookingStartedAt: null,
      },
      data: { bookingStartedAt: now, bookingVersion: 7 },
    });
  });

  test('không cho giả mạo itemId của một dòng vé khác', async () => {
    const tx = {
      savedItinerary: { findFirst: jest.fn().mockResolvedValue(itinerary) },
      booking: { findFirst: jest.fn() },
      partyRoom: { updateMany: jest.fn() },
    };

    await expect(validateItineraryBookingContext(tx, {
      context: { itineraryId: itinerary.id, itemId: 'forged-item', version: 7 },
      reservation,
      userId: 'user-1',
      now: new Date(),
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.booking.findFirst).not.toHaveBeenCalled();
    expect(tx.partyRoom.updateMany).not.toHaveBeenCalled();
  });
});

describe('getItineraryBookingProgress', () => {
  test('reports independent partial outcomes without reopening blocked refund lines', async () => {
    mockPrisma.savedItinerary.findFirst.mockResolvedValue({
      id: 'itinerary-progress',
      planId: 'plan-progress',
      title: 'Lịch trình kiểm thử',
      data: {
        days: [{
          activities: [{
            attractionId: 'attraction-1',
            ticketItems: [
              { ticketId: 'ticket-1', quantity: 1 },
              { ticketId: 'ticket-2', quantity: 1 },
              { ticketId: 'ticket-3', quantity: 1 },
              { ticketId: 'ticket-4', quantity: 1 },
            ],
          }],
        }],
      },
    });
    mockPrisma.booking.findMany.mockResolvedValue([
      {
        id: 'booking-no-show',
        itineraryVersion: 1,
        itineraryItemId: 'item-completed',
        status: 'NO_SHOW',
        reservationId: 'reservation-1',
        paymentMethod: 'vnpay',
        refundRequired: false,
        totalAmount: new Decimal(100000),
        createdAt: new Date('2026-07-28T04:00:00.000Z'),
        reservation: { expiresAt: new Date('2026-07-28T04:15:00.000Z') },
        refundRequests: [],
        payments: [{
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
          paidAt: new Date('2026-07-28T03:00:00.000Z'),
        }],
      },
      {
        id: 'booking-refund',
        itineraryVersion: 1,
        itineraryItemId: 'item-refund',
        status: 'REFUND_REQUESTED',
        reservationId: 'reservation-2',
        paymentMethod: 'vnpay',
        refundRequired: true,
        totalAmount: new Decimal(200000),
        createdAt: new Date('2026-07-28T03:00:00.000Z'),
        reservation: { expiresAt: new Date('2026-07-28T03:15:00.000Z') },
        refundRequests: [{
          id: 'refund-1',
          mandatory: false,
          status: 'PROCESSING',
          amount: new Decimal(200000),
        }],
        payments: [{
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
          paidAt: new Date('2026-07-28T02:00:00.000Z'),
        }],
      },
      {
        id: 'booking-cancelled',
        itineraryVersion: 1,
        itineraryItemId: 'item-retry',
        status: 'CANCELLED',
        reservationId: 'reservation-3',
        paymentMethod: 'bank_transfer',
        refundRequired: true,
        totalAmount: new Decimal(300000),
        createdAt: new Date('2026-07-28T02:00:00.000Z'),
        reservation: { expiresAt: new Date('2026-07-28T02:15:00.000Z') },
        refundRequests: [],
        payments: [{
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'BANK_TRANSFER',
          paidAt: new Date('2026-07-28T01:00:00.000Z'),
        }],
      },
    ]);
    const req = {
      params: { itineraryId: 'itinerary-progress' },
      user: { id: 'user-1' },
    };
    const res = makeResponse();
    const next = jest.fn();

    await getItineraryBookingProgress(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        transactionPolicy: {
          mode: 'SEQUENTIAL_INDEPENDENT',
          atomic: false,
          rollbackCompletedBookingsOnLaterFailure: false,
        },
        summary: {
          plannedItemCount: 4,
          startedCount: 3,
          completedCount: 1,
          paymentPendingCount: 0,
          refundPendingCount: 1,
          actionRequiredCount: 1,
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            bookingId: 'booking-no-show',
            fulfilled: true,
            lineState: 'COMPLETED',
          }),
          expect.objectContaining({
            bookingId: 'booking-refund',
            lineState: 'REFUND_PENDING',
            nextAction: 'TRACK_REFUND',
            replacementAllowed: false,
          }),
          expect.objectContaining({
            bookingId: 'booking-cancelled',
            lineState: 'ACTION_REQUIRED',
            nextAction: 'CREATE_REPLACEMENT',
            replacementAllowed: true,
          }),
        ]),
      }),
    }));
    expect(next).not.toHaveBeenCalled();
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

  test('chặn voucher loyalty của người khác (không phải chủ sở hữu)', async () => {
    mockPrisma.voucher.findUnique.mockResolvedValue({
      id: 'voucher-lt',
      code: 'LTABCDEFGH',
      discountType: 'FIXED',
      discountValue: new Decimal(50000),
      maxDiscount: null,
      minSpend: new Decimal(200000),
      expiryDate: new Date(Date.now() + 86400000),
      isActive: true,
      usageLimit: 1,
      usedCount: 0,
      userId: 'owner-1',
      source: 'LOYALTY',
    });
    const res = makeResponse();

    await validateAndApplyVoucher({
      user: { id: 'attacker-2' },
      body: { voucherCode: 'LTABCDEFGH', subtotalAmount: 300000 },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('không thuộc về tài khoản') }),
    );
  });

  test('cho phép chủ sở hữu dùng voucher loyalty của mình', async () => {
    mockPrisma.voucher.findUnique.mockResolvedValue({
      id: 'voucher-lt',
      code: 'LTABCDEFGH',
      discountType: 'FIXED',
      discountValue: new Decimal(50000),
      maxDiscount: null,
      minSpend: new Decimal(200000),
      expiryDate: new Date(Date.now() + 86400000),
      isActive: true,
      usageLimit: 1,
      usedCount: 0,
      userId: 'owner-1',
      source: 'LOYALTY',
    });
    const res = makeResponse();

    await validateAndApplyVoucher({
      user: { id: 'owner-1' },
      body: { voucherCode: 'LTABCDEFGH', subtotalAmount: 300000 },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ discountAmount: 50000, totalAmount: 250000 }),
    }));
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
      snapshotTicketRestrictions: {
        minAgeYears: 12,
        maxAgeYears: 65,
        minHeightCm: 120,
        maxHeightCm: 210,
        requiresAdult: true,
      },
      snapshotCommissionRate: new Decimal('0.25'),
      ticketProduct: {
        id: 'ticket-1',
        name: 'Vé người lớn',
        type: 'ADULT',
        description: 'Vé tham quan tiêu chuẩn',
        inclusions: ['Vé vào cổng', 'Bảo hiểm tham quan'],
        exclusions: ['Đồ ăn'],
        status: 'ACTIVE',
        archivedAt: null,
        sellingPrice: new Decimal(120000),
        attraction: {
          id: 'attraction-1',
          title: 'Test Attraction',
          address: '1 Test',
          district: null,
          city: 'Đà Nẵng',
          images: [],
          meetingPoint: 'Quầy vé cổng chính',
          checkInInstructions: 'Xuất trình mã QR tại quầy kiểm soát trước khi vào cổng.',
          accessibilityInfo: 'Có hỗ trợ xe lăn.',
          whatToBring: ['CCCD'],
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
    expect(createData.snapshotTicketRestrictions).toEqual({
      minAgeYears: 12,
      maxAgeYears: 65,
      minHeightCm: 120,
      maxHeightCm: 210,
      requiresAdult: true,
    });
    expect(createData).toMatchObject({
      snapshotMeetingPoint: 'Quầy vé cổng chính',
      snapshotCheckInInstructions: 'Xuất trình mã QR tại quầy kiểm soát trước khi vào cổng.',
      snapshotAccessibilityInfo: 'Có hỗ trợ xe lăn.',
      snapshotWhatToBring: ['CCCD'],
      snapshotInclusions: ['Vé vào cổng', 'Bảo hiểm tham quan'],
      snapshotExclusions: ['Đồ ăn'],
    });
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
