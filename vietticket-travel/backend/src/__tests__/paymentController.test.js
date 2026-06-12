jest.mock('../config/prisma', () => ({
  payment: { findUnique: jest.fn() },
  booking: { findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../utils/vnpay', () => ({
  verifyVnpaySignature: jest.fn(),
  buildVnpayUrl: jest.fn(),
  formatVnpDate: jest.fn(() => '20260609120000'),
}));
jest.mock('../controllers/bookingController', () => ({
  confirmReservationAndStock: jest.fn(),
  createTicketInstances: jest.fn(),
}));

const prisma = require('../config/prisma');
const { verifyVnpaySignature, buildVnpayUrl } = require('../utils/vnpay');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('../controllers/bookingController');
const { vnpayIpn, createVNPayUrl } = require('../controllers/paymentController');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

// totalAmount 100000 -> vnp_Amount hợp lệ = 10000000
const VALID_AMOUNT = '10000000';

function baseQuery(overrides = {}) {
  return {
    vnp_TxnRef: 'txnref123',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_Amount: VALID_AMOUNT,
    vnp_SecureHash: 'hash',
    ...overrides,
  };
}

function paymentFixture({ requiresManualApproval = false } = {}) {
  return {
    id: 'pay-1',
    bookingId: 'booking-1',
    transactionId: 'txnref123',
    booking: {
      id: 'booking-1',
      totalAmount: 100000,
      reservation: {
        id: 'res-1',
        ticketProductId: 'tkt-1',
        quantity: 2,
        status: 'HELD',
        ticketProduct: { attraction: { requiresManualApproval } },
      },
    },
  };
}

// tx mock: current booking trả về theo cấu hình
function setupTx({
  payments = [{ status: 'PENDING' }],
  reservationStatus = 'HELD',
  bookingStatus = 'PENDING_PAYMENT',
} = {}) {
  const tx = {
    booking: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'booking-1',
        status: bookingStatus,
        payments,
        reservation: { id: 'res-1', ticketProductId: 'tkt-1', quantity: 2, status: reservationStatus },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    payment: { update: jest.fn().mockResolvedValue({}) },
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
  });

  test('thành công + KHÔNG cần duyệt -> CONFIRMED + tạo vé', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture({ requiresManualApproval: false }));
    const tx = setupTx();
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
    );
    expect(confirmReservationAndStock).toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CONFIRMED' } }),
    );
    expect(createTicketInstances).toHaveBeenCalledWith(tx, 'booking-1', 'tkt-1', 2);
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('thành công + CẦN duyệt -> PENDING_PARTNER, KHÔNG tạo vé', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture({ requiresManualApproval: true }));
    const tx = setupTx();
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(confirmReservationAndStock).toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING_PARTNER' } }),
    );
    expect(createTicketInstances).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
  });

  test('thành công nhưng reservation đã EXPIRED -> CANCELLED + refundRequired', async () => {
    verifyVnpaySignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue(paymentFixture());
    const tx = setupTx({ reservationStatus: 'EXPIRED' });
    const res = makeRes();
    await vnpayIpn({ query: baseQuery() }, res);

    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED', refundRequired: true } }),
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
      expect.objectContaining({ data: { status: 'CANCELLED', refundRequired: true } }),
    );
    expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm success' });
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

  function bookingFixture(over = {}) {
    return {
      id: 'booking-1',
      userId: 'user-1',
      paymentMethod: 'vnpay',
      status: 'PENDING_PAYMENT',
      reservationId: 'res-1',
      totalAmount: 100000,
      payments: [{ id: 'pay-1' }],
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

  test('500 khi thiếu cấu hình VNPay', async () => {
    delete process.env.VNP_HASHSECRET;
    prisma.booking.findUnique.mockResolvedValue(bookingFixture());
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('thành công -> reset expiresAt, tạo Payment attempt mới, trả paymentUrl', async () => {
    prisma.booking.findUnique.mockResolvedValue(bookingFixture());
    const tx = {
      reservation: { update: jest.fn().mockResolvedValue({}) },
      payment: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));
    const res = makeRes();
    await createVNPayUrl(makeReq(), res, jest.fn());

    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-1' },
        data: expect.objectContaining({ expiresAt: expect.any(Date) }),
      }),
    );
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transactionId: expect.any(String), status: 'PENDING' }),
      }),
    );
    expect(buildVnpayUrl).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { paymentUrl: 'https://sandbox/pay?signed=1' },
    });
  });
});
