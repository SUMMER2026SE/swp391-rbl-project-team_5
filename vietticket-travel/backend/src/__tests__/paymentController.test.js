jest.mock('../config/prisma', () => ({
  payment: { findUnique: jest.fn() },
  booking: { findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../utils/vnpay', () => ({
  verifyVnpaySignature: jest.fn(),
  buildVnpayUrl: jest.fn(),
  formatVnpDate: jest.fn(() => '20260609120000'),
  createVnpRequestId: jest.fn(() => '0123456789abcdef0123456789abcdef'),
  signRefundData: jest.fn(() => 'refund-signature'),
  signQueryData: jest.fn(() => 'query-signature'),
  verifyRefundResponseSignature: jest.fn(() => true),
  verifyQueryResponseSignature: jest.fn(() => true),
}));
jest.mock('../controllers/bookingController', () => ({
  confirmReservationAndStock: jest.fn(),
  createTicketInstances: jest.fn(),
}));
jest.mock('../realtime/events', () => ({
  queueNewBookingNotification: jest.fn(),
  emitBookingStatusUpdated: jest.fn(),
}));
jest.mock('../services/ticketEmailService', () => ({
  queueConfirmedTicketEmail: jest.fn(),
}));

const prisma = require('../config/prisma');
const { verifyVnpaySignature, buildVnpayUrl } = require('../utils/vnpay');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('../controllers/bookingController');
const {
  queueNewBookingNotification,
  emitBookingStatusUpdated,
} = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');
const {
  vnpayIpn,
  vnpayReturn,
  createVNPayUrl,
  refundViaVnpay,
  queryVnpayTransaction,
} = require('../controllers/paymentController');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  return res;
}

// totalAmount 100000 -> vnp_Amount hợp lệ = 10000000
const VALID_AMOUNT = '10000000';
const CALLBACK_PAY_DATE = '20260609120500';
const CALLBACK_CREATE_DATE = '20260609120000';
const CALLBACK_EXPIRE_DATE = '20260609121000';
const CALLBACK_DEADLINE = new Date('2026-06-09T05:10:00.000Z');

function baseQuery(overrides = {}) {
  return {
    vnp_TxnRef: 'txnref123',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_Amount: VALID_AMOUNT,
    vnp_PayDate: CALLBACK_PAY_DATE,
    vnp_SecureHash: 'hash',
    ...overrides,
  };
}

function paymentFixture({ requiresManualApproval = false, partnerStatus = 'APPROVED' } = {}) {
  return {
    id: 'pay-1',
    bookingId: 'booking-1',
    transactionId: 'txnref123',
    paymentGateway: 'VNPAY',
    amount: 100000,
    expiresAt: CALLBACK_DEADLINE,
    rawResponse: {
      vnp_CreateDate: CALLBACK_CREATE_DATE,
      vnp_ExpireDate: CALLBACK_EXPIRE_DATE,
    },
    booking: {
      id: 'booking-1',
      userId: 'user-1',
      totalAmount: 100000,
      reservation: {
        id: 'res-1',
        ticketProductId: 'tkt-1',
        quantity: 2,
        status: 'HELD',
        date: new Date('2026-06-20T00:00:00.000Z'),
        expiresAt: CALLBACK_DEADLINE,
        paymentDeadline: CALLBACK_DEADLINE,
        ticketProduct: {
          id: 'tkt-1',
          attractionId: 'attr-1',
          status: 'ACTIVE',
          archivedAt: null,
          attraction: {
            id: 'attr-1',
            publishedAt: new Date('2026-06-01T00:00:00.000Z'),
            publicationStatus: 'ACTIVE',
            status: 'APPROVED',
            archivedAt: null,
            requiresManualApproval,
            partner: { status: partnerStatus },
          },
        },
      },
    },
  };
}

// tx mock: current booking trả về theo cấu hình
function setupTx({
  payments = [{ status: 'PENDING' }],
  reservationStatus = 'HELD',
  bookingStatus = 'PENDING_PAYMENT',
  partnerStatus = 'APPROVED',
  requiresManualApproval = false,
} = {}) {
  const tx = {
    booking: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'booking-1',
        userId: 'user-1',
        status: bookingStatus,
        totalAmount: 100000,
        payments: payments.map((p) => ({
          id: p.id || 'pay-1',
          amount: 100000,
          paymentGateway: 'VNPAY',
          expiresAt: CALLBACK_DEADLINE,
          rawResponse: {
            vnp_CreateDate: CALLBACK_CREATE_DATE,
            vnp_ExpireDate: CALLBACK_EXPIRE_DATE,
          },
          ...p,
        })),
        reservation: {
          id: 'res-1',
          ticketProductId: 'tkt-1',
          quantity: 2,
          date: new Date('2026-06-20T00:00:00.000Z'),
          status: reservationStatus,
          expiresAt: CALLBACK_DEADLINE,
          paymentDeadline: CALLBACK_DEADLINE,
          ticketProduct: {
            id: 'tkt-1',
            attractionId: 'attr-1',
            status: 'ACTIVE',
            archivedAt: null,
            attraction: {
              id: 'attr-1',
              publishedAt: new Date('2026-06-01T00:00:00.000Z'),
              publicationStatus: 'ACTIVE',
              status: 'APPROVED',
              archivedAt: null,
              requiresManualApproval,
              partner: { status: partnerStatus },
            },
          },
        },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    payment: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    reservation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ticketProduct: { findUnique: jest.fn().mockResolvedValue({ attractionId: 'attr-1' }) },
    voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    refundRequest: {
      upsert: jest.fn().mockResolvedValue({ id: 'ref-req-1', status: 'PROCESSING' }),
    },
    refundTransaction: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'refund-tx-1' }),
    },
  };
  prisma.$transaction.mockImplementation((cb) => cb(tx));
  return tx;
}


beforeEach(() => {
  jest.clearAllMocks();
});

describe('vnpayIpn', () => {
  test('97 khi sai chữ ký', async () => {
    verifyVnpaySignature.mockReturnValue(false);
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);
    expect(res.json).toHaveBeenCalledWith({ RspCode: '97', Message: 'Invalid signature' });
  });

  test('01 khi không tìm thấy đơn', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);
    expect(res.json).toHaveBeenCalledWith({ RspCode: '01', Message: 'Order not found' });
  });

  test('04 khi sai số tiền', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const res = makeRes();
    await vnpayIpn({ query: baseQuery({ vnp_Amount: '1' }) }, res);
    expect(res.json).toHaveBeenCalledWith({ RspCode: '04', Message: 'Invalid amount' });
  });

  test('02 khi đã có Payment SUCCESS (idempotent)', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx({ payments: [{ status: 'SUCCESS' }] });
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);
    expect(res.json).toHaveBeenCalledWith({ RspCode: '02', Message: 'Order already confirmed' });
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(queueNewBookingNotification).not.toHaveBeenCalled();
    expect(emitBookingStatusUpdated).not.toHaveBeenCalled();
    expect(queueConfirmedTicketEmail).not.toHaveBeenCalled();
  });

  test('thành công + KHÔNG cần duyệt -> CONFIRMED + tạo vé', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture({ requiresManualApproval: false }));
    const tx = setupTx();
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          rawResponse: expect.objectContaining({
            vnp_CreateDate: CALLBACK_CREATE_DATE,
            vnp_PayDate: CALLBACK_PAY_DATE,
          }),
        }),
      }),
    );
    expect(confirmReservationAndStock).toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CONFIRMED' } }),
    );
    expect(createTicketInstances).toHaveBeenCalledWith(tx, 'booking-1', 'tkt-1', 2);
    expect(queueNewBookingNotification).toHaveBeenCalledWith('booking-1');
    expect(emitBookingStatusUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'user-1', bookingId: 'booking-1', status: 'CONFIRMED' }),
    );
    expect(queueConfirmedTicketEmail).toHaveBeenCalledWith('booking-1');
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('thành công + CẦN duyệt -> PENDING_PARTNER, KHÔNG tạo vé', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture({ requiresManualApproval: true }));
    const tx = setupTx({ requiresManualApproval: true });
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(confirmReservationAndStock).toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING_PARTNER' } }),
    );
    expect(createTicketInstances).not.toHaveBeenCalled();
    expect(queueNewBookingNotification).toHaveBeenCalledWith('booking-1');
    expect(emitBookingStatusUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'user-1', bookingId: 'booking-1', status: 'PENDING_PARTNER' }),
    );
    expect(queueConfirmedTicketEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('thanh toán chuẩn đóng các lượt VNPay còn treo của cùng booking', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx({
      payments: [
        { id: 'pay-1', status: 'PENDING' },
        { id: 'pay-newer', status: 'PENDING' },
      ],
    });
    const res = makeRes();

    await vnpayIpn({ query: baseQuery() }, res);

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking-1',
        id: { not: 'pay-1' },
        status: 'PENDING',
      },
      data: {
        status: 'FAILED',
        failureReason: 'SUPERSEDED_BY_SUCCESSFUL_PAYMENT',
      },
    });
  });

  test('payment thành công sau deadline -> không issue vé và đưa vào hoàn tiền bắt buộc', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx();
    const res = makeRes();

    await vnpayIpn({
      query: baseQuery({ vnp_PayDate: '20260609121100' }),
    }, res);

    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(createTicketInstances).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        refundRequired: true,
        cancellationSource: 'PAYMENT_AFTER_EXPIRY',
      }),
    }));
    expect(tx.refundRequest.upsert).toHaveBeenCalled();
    expect(tx.refundTransaction.create).toHaveBeenCalled();
  });

  test('callback đến trễ nhưng signed pay time còn trong deadline -> vẫn xác nhận', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-09T06:00:00.000Z'));
    try {
      verifyVnpaySignature.mockReturnValue(true);
      prisma.payment.findUnique.mockResolvedValue(paymentFixture());
      const tx = setupTx();
      const res = makeRes();

      await vnpayIpn({ query: baseQuery() }, res);

      expect(confirmReservationAndStock).toHaveBeenCalledWith(tx, expect.objectContaining({
        id: 'res-1',
      }));
      expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'CONFIRMED' },
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  test('vnp_PayDate bị lược bỏ nhưng callback signed đến trong deadline -> vẫn xác nhận', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-09T05:05:00.000Z'));
    try {
      verifyVnpaySignature.mockReturnValue(true);
      prisma.payment.findUnique.mockResolvedValue(paymentFixture());
      const tx = setupTx();
      const res = makeRes();

      await vnpayIpn({
        query: baseQuery({ vnp_PayDate: undefined }),
      }, res);

      expect(confirmReservationAndStock).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ id: 'res-1' }),
      );
      expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          paidAt: new Date('2026-06-09T05:05:00.000Z'),
          rawResponse: expect.objectContaining({
            captureTimingSource: 'MERCHANT_RECEIVED_AT',
          }),
        }),
      }));
      expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'CONFIRMED' },
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  test('payment success thiếu vnp_PayDate hợp lệ -> fail closed và hoàn tiền', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx();
    const res = makeRes();

    await vnpayIpn({
      query: baseQuery({ vnp_PayDate: '20260231090000' }),
    }, res);

    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', refundRequired: true }),
    }));
  });

  test('thanh toán trùng -> ghi nhận hoàn tiền, không gửi lại email/thông báo vé', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx({
      bookingStatus: 'CONFIRMED',
      reservationStatus: 'CONFIRMED',
      payments: [
        { id: 'pay-1', status: 'PENDING', amount: 100000 },
        { id: 'pay-success', status: 'SUCCESS', isDuplicate: false, amount: 100000 },
      ],
    });
    const res = makeRes();

    await vnpayIpn({ query: baseQuery() }, res);

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-1' },
        data: expect.objectContaining({ status: 'SUCCESS', isDuplicate: true }),
      }),
    );
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { refundRequired: true } }),
    );
    expect(tx.refundTransaction.upsert).toHaveBeenCalled();
    expect(queueNewBookingNotification).not.toHaveBeenCalled();
    expect(emitBookingStatusUpdated).not.toHaveBeenCalled();
    expect(queueConfirmedTicketEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Duplicate payment recorded for refund' });
  });

  test('thành công nhưng reservation đã EXPIRED -> CANCELLED + refundRequired', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx({ reservationStatus: 'EXPIRED' });
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED', refundRequired: true }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('thất bại -> Payment FAILED nhưng GIỮ Booking PENDING_PAYMENT (cho retry)', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx();
    const res = makeRes();
    await vnpayIpn({ query: baseQuery({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }) }, res);

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    // KHÔNG được hủy booking -> để khách thử lại
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(createTicketInstances).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('success nhưng booking đã CANCELLED -> không hồi sinh, gắn refundRequired', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx({ bookingStatus: 'CANCELLED', reservationStatus: 'HELD' });
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED', refundRequired: true }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('đối tác bị đình chỉ sau khi giữ chỗ -> hủy đơn, hoàn kho và bắt buộc hoàn tiền', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture({ partnerStatus: 'SUSPENDED' }));
    const tx = setupTx({ partnerStatus: 'SUSPENDED' });
    const res = makeRes();

    await vnpayIpn({ query: baseQuery() }, res);

    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'res-1', status: 'HELD' },
      data: { status: 'CANCELLED' },
    }));
    expect(tx.dailyStock.updateMany).toHaveBeenCalled();
    expect(tx.attractionDailyStock.updateMany).toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        refundRequired: true,
        cancellationSource: 'SALE_SUSPENDED_AFTER_HOLD',
      }),
    }));
    expect(tx.refundRequest.upsert).toHaveBeenCalled();
    expect(tx.refundTransaction.create).toHaveBeenCalled();
  });
});

describe('vnpayReturn', () => {
  test('return hợp lệ xử lý thanh toán khi IPN không gọi được vào localhost', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture({ requiresManualApproval: true }));
    const tx = setupTx({ requiresManualApproval: true });
    const res = makeRes();
    const next = jest.fn();

    await vnpayReturn({ query: baseQuery() }, res, next);

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
    );
    expect(confirmReservationAndStock).toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING_PARTNER' } }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('status=success'),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createVNPayUrl', () => {
  const VALID_ENV = {
    VNP_TMNCODE: 'TMN',
    VNP_HASHSECRET: 'SECRET',
    VNP_URL: 'https://sandbox/pay',
    VNP_RETURNURL: 'http://localhost:5000/api/payments/vnpay-return',
  };
  let savedEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    Object.assign(process.env, VALID_ENV);
    buildVnpayUrl.mockReturnValue('https://sandbox/pay?signed=1');
  });
  afterEach(() => {
    process.env = savedEnv;
  });

  // bookingFixture đủ điều kiện qua tất cả guard của createVNPayUrl
  function bookingFixture(over = {}) {
    return {
      id: 'booking-1',
      userId: 'user-1',
      paymentMethod: 'vnpay',
      status: 'PENDING_PAYMENT',
      reservationId: 'res-1',
      totalAmount: 100000,
      payments: [{ id: 'pay-1', status: 'PENDING', isDuplicate: false }],
      reservation: {
        id: 'res-1',
        status: 'HELD',
        ticketProduct: {
          id: 'tkt-1',
          status: 'ACTIVE',
          archivedAt: null,
          attraction: {
            publishedAt: new Date('2026-06-01T00:00:00.000Z'),
            publicationStatus: 'ACTIVE',
            status: 'APPROVED',
            archivedAt: null,
            partner: { status: 'APPROVED' },
          },
        },
        paymentDeadline: new Date(Date.now() + 10 * 60 * 1000), // 10 phút nữa
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        paymentAttemptCount: 0,
      },
      ...over,
    };
  }

  function makeReq() {
    return {
      user: { id: 'user-1' },
      body: { bookingId: 'booking-1' },
      headers: {},
      socket: { remoteAddress: '1.2.3.4' },
    };
  }

  test('404 khi không tìm thấy / không phải chủ đơn', async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400 khi không phải phương thức vnpay', async () => {
    prisma.booking.findUnique.mockResolvedValue(bookingFixture({ paymentMethod: 'onsite' }));
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('409 khi đơn không ở trạng thái chờ thanh toán', async () => {
    prisma.booking.findUnique.mockResolvedValue(bookingFixture({ status: 'CONFIRMED' }));
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('409 khi reservation đã hết hạn thanh toán', async () => {
    prisma.booking.findUnique.mockResolvedValue(bookingFixture({
      reservation: {
        id: 'res-1',
        status: 'HELD',
        ticketProduct: {
          id: 'tkt-1',
          status: 'ACTIVE',
          archivedAt: null,
          attraction: {
            publishedAt: new Date('2026-06-01T00:00:00.000Z'),
            publicationStatus: 'ACTIVE',
            status: 'APPROVED',
            archivedAt: null,
            partner: { status: 'APPROVED' },
          },
        },
        paymentDeadline: new Date(Date.now() - 1000), // đã qua
        expiresAt: new Date(Date.now() - 1000),
        paymentAttemptCount: 0,
      },
    }));
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('500 khi thiếu cấu hình VNPay', async () => {
    delete process.env.VNP_HASHSECRET;
    prisma.booking.findUnique.mockResolvedValue(bookingFixture());
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test.each([
    [4999, 'tối thiểu'],
    [100000.5, 'số nguyên VND'],
  ])('400 khi tổng tiền VNPay không hợp lệ: %p', async (totalAmount, message) => {
    prisma.booking.findUnique.mockResolvedValue(bookingFixture({ totalAmount }));
    const res = makeRes();

    await createVNPayUrl(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining(message),
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('thành công -> tăng attemptCount, tạo Payment mới, trả paymentUrl', async () => {
    prisma.booking.findUnique.mockResolvedValue(bookingFixture());
    const tx = {
      // Code dùng updateMany với guard để atomic increment + tránh race condition
      reservation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payment: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());

    expect(tx.reservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'res-1', status: 'HELD' }),
        data: expect.objectContaining({ paymentAttemptCount: { increment: 1 } }),
      }),
    );
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionId: expect.any(String),
          status: 'PENDING',
          rawResponse: expect.objectContaining({
            vnp_CreateDate: '20260609120000',
            vnp_ExpireDate: '20260609120000',
          }),
        }),
      }),
    );
    const transactionId = tx.payment.create.mock.calls[0][0].data.transactionId;
    expect(transactionId).toContain('0123456789ab');
    expect(transactionId).toMatch(/\d{13}$/);
    expect(buildVnpayUrl).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { paymentUrl: 'https://sandbox/pay?signed=1' },
    });
  });
});

describe('refundViaVnpay validation', () => {
  const payment = {
    amount: 100000,
    transactionId: 'txn-ref-1',
    rawResponse: {
      vnp_TransactionNo: '99999',
      vnp_CreateDate: '20260610115500',
      vnp_PayDate: '20260610120000',
    },
  };
  let savedEnv;
  let savedFetch;

  beforeEach(() => {
    savedEnv = { ...process.env };
    savedFetch = global.fetch;
    Object.assign(process.env, {
      VNP_TMNCODE: 'TESTCODE',
      VNP_HASHSECRET: 'TESTSECRET',
      VNP_API: 'https://sandbox.example/refund',
    });
  });

  afterEach(() => {
    process.env = savedEnv;
    global.fetch = savedFetch;
  });

  test('chặn hoàn toàn phần nếu số tiền không bằng giao dịch gốc', async () => {
    await expect(refundViaVnpay({
      payment,
      amount: 90000,
      transactionType: '02',
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('chặn hoàn một phần nếu số tiền bằng toàn bộ giao dịch', async () => {
    await expect(refundViaVnpay({
      payment,
      amount: 100000,
      transactionType: '03',
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('chặn loại giao dịch không thuộc 02/03', async () => {
    await expect(refundViaVnpay({
      payment,
      amount: 90000,
      transactionType: '01',
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('đánh dấu kết quả không xác định nếu lỗi mạng xảy ra sau khi bắt đầu gửi', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout'));

    await expect(refundViaVnpay({
      payment,
      amount: 90000,
      transactionType: '03',
      requestId: 'request-1',
    })).rejects.toMatchObject({ gatewayAttempted: true });
  });

  test('refund gửi original vnp_CreateDate, không gửi vnp_PayDate', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
      }),
    });

    await refundViaVnpay({
      payment,
      amount: 90000,
      transactionType: '03',
      requestId: 'request-original-date',
    });

    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.vnp_TransactionDate).toBe('20260610115500');
    expect(request.vnp_TransactionDate).not.toBe(payment.rawResponse.vnp_PayDate);
  });

  test('QueryDR gửi original vnp_CreateDate', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_Amount: '10000000',
      }),
    });

    await queryVnpayTransaction({
      payment,
      requestId: 'query-original-date',
    });

    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.vnp_Command).toBe('querydr');
    expect(request.vnp_TransactionDate).toBe('20260610115500');
  });

  test('legacy Payment derive create date từ timestamp suffix an toàn', async () => {
    const legacyTimestamp = new Date('2026-06-09T05:00:00.000Z').getTime();
    const legacyPayment = {
      ...payment,
      bookingId: 'booking-1',
      transactionId: `booking1${legacyTimestamp}`,
      rawResponse: {
        vnp_TransactionNo: '99999',
        vnp_PayDate: '20260610120000',
      },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
      }),
    });

    await refundViaVnpay({
      payment: legacyPayment,
      amount: 90000,
      transactionType: '03',
      requestId: 'legacy-request',
    });

    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.vnp_TransactionDate).toBe('20260609120000');
  });

  test('legacy Payment không derive được create date -> fail rõ trước khi gọi gateway', async () => {
    global.fetch = jest.fn();
    await expect(refundViaVnpay({
      payment: {
        ...payment,
        rawResponse: {
          vnp_TransactionNo: '99999',
          vnp_PayDate: '20260610120000',
        },
      },
      amount: 90000,
      transactionType: '03',
    })).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('original vnp_CreateDate'),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
