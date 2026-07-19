jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendRefundStatusEmail: jest.fn().mockResolvedValue({ sent: true }),
  sendReissueTicketEmail: jest.fn().mockResolvedValue({ sent: true }),
}));
jest.mock('../controllers/paymentController', () => ({
  queryVnpayTransaction: jest.fn(),
  refundViaVnpay: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
const {
  sendRefundStatusEmail,
  sendReissueTicketEmail,
} = require('../utils/mailer');
const {
  queryVnpayTransaction,
  refundViaVnpay,
} = require('../controllers/paymentController');
const {
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
  reissueTicket,
} = require('../controllers/staffController');

function makeReqRes(overrides = {}) {
  const baseReq = {
    user: { id: 'staff-1', role: 'STAFF', employerPartnerId: null },
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

function paymentFixture(overrides = {}) {
  return {
    id: 'payment-1',
    amount: 100000,
    status: 'SUCCESS',
    isDuplicate: false,
    paymentGateway: 'VNPAY',
    transactionId: 'txn-ref-1',
    rawResponse: { vnp_TransactionNo: '99999', vnp_PayDate: '20260610120000' },
    ...overrides,
  };
}

function refundFixture(overrides = {}) {
  return {
    id: 'refund-1',
    bookingId: 'booking-1',
    type: 'CUSTOMER_CANCELLATION',
    mandatory: false,
    reason: 'Khách thay đổi kế hoạch',
    amount: 90000,
    status: 'PENDING',
    refundTransactions: [],
    booking: {
      id: 'booking-1',
      status: 'REFUND_REQUESTED',
      totalAmount: 100000,
      payments: [paymentFixture()],
      refundTransactions: [],
      ticketInstances: [{ id: 'ticket-instance-1', status: 'VALID' }],
      user: { fullName: 'Nguyen Van A', email: 'a@example.com' },
      reservation: {
        id: 'reservation-1',
        ticketProductId: 'ticket-1',
        timeSlotId: null,
        date: new Date('2026-06-10T00:00:00.000Z'),
        quantity: 1,
        status: 'CONFIRMED',
        ticketProduct: {
          attractionId: 'attraction-1',
          refundPolicy: 'REFUND_WITH_FEE',
          refundFeeRate: 0.1,
        },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
  prisma.refundTransaction.create.mockResolvedValue({
    id: 'refund-txn-1',
    gatewayRequestId: 'gateway-request-1',
  });
  prisma.refundTransaction.update.mockResolvedValue({ id: 'refund-txn-1' });
  prisma.payment.update.mockResolvedValue({});
  refundViaVnpay.mockResolvedValue({
    success: true,
    responseCode: '00',
    transactionStatus: '00',
    raw: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00' },
  });
});

describe('listRefundRequests', () => {
  test('blocks partner staff from the platform-wide refund queue', async () => {
    const { req, res, next } = makeReqRes({
      user: { employerPartnerId: 'partner-1' },
    });

    await listRefundRequests(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(prisma.refundRequest.findMany).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid status filter', async () => {
    const { req, res, next } = makeReqRes({ query: { status: 'UNKNOWN' } });

    await listRefundRequests(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.refundRequest.findMany).not.toHaveBeenCalled();
  });

  test('phân trang: trả về đúng page/limit và thống kê trạng thái toàn cục', async () => {
    prisma.refundRequest.findMany.mockResolvedValue([refundFixture()]);
    prisma.refundRequest.count.mockResolvedValue(45);
    prisma.refundRequest.groupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 10 } },
      { status: 'APPROVED', _count: { _all: 30 } },
      { status: 'REJECTED', _count: { _all: 5 } },
    ]);

    const { req, res, next } = makeReqRes({ query: { page: '2', limit: '20' } });
    await listRefundRequests(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // Bỏ qua đúng 20 bản ghi của trang 1 và lấy tối đa 20.
    expect(prisma.refundRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    // Thống kê tính từ groupBy toàn cục, không phụ thuộc trang hiện tại.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        pagination: { page: 2, limit: 20, total: 45, totalPages: 3 },
        stats: expect.objectContaining({
          total: 45, pending: 10, approved: 30, rejected: 5,
        }),
      }),
    );
  });

  test('giới hạn limit tối đa 100 để tránh tải quá nhiều', async () => {
    prisma.refundRequest.findMany.mockResolvedValue([]);
    prisma.refundRequest.count.mockResolvedValue(0);
    prisma.refundRequest.groupBy.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: { limit: '9999' } });
    await listRefundRequests(req, res, next);

    expect(prisma.refundRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('tìm kiếm: dựng where.OR theo mã booking, tên khách và địa điểm', async () => {
    prisma.refundRequest.findMany.mockResolvedValue([]);
    prisma.refundRequest.count.mockResolvedValue(0);
    prisma.refundRequest.groupBy.mockResolvedValue([]);

    const { req, res, next } = makeReqRes({ query: { search: 'Nguyen' } });
    await listRefundRequests(req, res, next);

    const callArg = prisma.refundRequest.findMany.mock.calls[0][0];
    expect(Array.isArray(callArg.where.OR)).toBe(true);
    expect(callArg.where.OR.length).toBeGreaterThanOrEqual(3);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('processRefundRequest', () => {
  test('blocks partner staff from processing platform refunds', async () => {
    const { req, res, next } = makeReqRes({
      user: { employerPartnerId: 'partner-1' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.refundRequest.findUnique).not.toHaveBeenCalled();
  });

  test('approves a pending request and releases inventory', async () => {
    const request = refundFixture();
    const tx = {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue({ ...request, status: 'PROCESSING' }),
        update: jest.fn().mockResolvedValue({
          ...request,
          status: 'APPROVED',
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn() },
      reservation: { update: jest.fn().mockResolvedValue({}) },
      ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      booking: { update: jest.fn().mockResolvedValue({}) },
    };
    // Đọc trước (ngoài transaction) để quyết định có gọi cổng VNPay không.
    prisma.refundRequest.findUnique.mockResolvedValue(request);
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(tx.dailyStock.updateMany).toHaveBeenCalled();
    expect(tx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking-1',
        status: { in: ['VALID', 'EXPIRED'] },
      },
      data: { status: 'REFUNDED' },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(sendRefundStatusEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects an already processed request', async () => {
    // Đọc trước phát hiện trạng thái != PENDING -> trả 409 trước khi mở transaction.
    prisma.refundRequest.findUnique.mockResolvedValue(
      refundFixture({ status: 'APPROVED' }),
    );
    const { req, res, next } = makeReqRes({
      params: { refundId: 'refund-1' },
      body: { action: 'REJECTED', staffNotes: 'Đơn không đủ điều kiện.' },
    });

    await processRefundRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('only one staff request can claim a pending refund', async () => {
    prisma.refundRequest.findUnique.mockResolvedValue(refundFixture());
    prisma.refundRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const { req, res, next } = makeReqRes({
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(refundViaVnpay).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('calls VNPay refund for an online payment before updating the DB', async () => {
    const request = refundFixture({
      booking: {
        ...refundFixture().booking,
        payments: [paymentFixture()],
      },
    });
    const tx = {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue({ ...request, status: 'PROCESSING' }),
        update: jest.fn().mockResolvedValue({ ...request, status: 'APPROVED' }),
        count: jest.fn().mockResolvedValue(0),
      },
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn() },
      reservation: { update: jest.fn().mockResolvedValue({}) },
      ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      booking: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.refundRequest.findUnique.mockResolvedValue(request);
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    refundViaVnpay.mockResolvedValue({
      success: true,
      responseCode: '00',
      transactionStatus: '00',
      raw: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00' },
    });

    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    // amount (90000) < total (100000) -> hoàn một phần (03).
    expect(refundViaVnpay).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: '03', amount: 90000 }),
    );
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('does not allow staff to reject a mandatory refund', async () => {
    prisma.refundRequest.findUnique.mockResolvedValue(refundFixture({
      type: 'PARTNER_CANCELLATION',
      mandatory: true,
    }));
    const { req, res, next } = makeReqRes({
      params: { refundId: 'refund-1' },
      body: { action: 'REJECTED', staffNotes: 'Không muốn xử lý.' },
    });

    await processRefundRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.refundRequest.updateMany).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('does not resend a duplicate-payment refund that already needs reconciliation', async () => {
    const duplicatePayment = {
      id: 'pay-dup',
      amount: 100000,
      paymentGateway: 'VNPAY',
      status: 'SUCCESS',
      isDuplicate: true,
      transactionId: 'txn-dup',
      rawResponse: { vnp_TransactionNo: '88888', vnp_PayDate: '20260610123000' },
    };
    const originalPayment = {
      id: 'pay-original',
      amount: 100000,
      paymentGateway: 'VNPAY',
      status: 'SUCCESS',
      isDuplicate: false,
      transactionId: 'txn-original',
      rawResponse: { vnp_TransactionNo: '99999', vnp_PayDate: '20260610120000' },
    };
    const request = refundFixture({
      type: 'DUPLICATE_PAYMENT',
      mandatory: true,
      amount: 100000,
      reason: 'Duplicate VNPay payment captured: txn-dup',
      booking: {
        ...refundFixture().booking,
        status: 'CONFIRMED',
        refundRequired: true,
        payments: [duplicatePayment, originalPayment],
      },
      refundTransactions: [
        {
          id: 'dup-refund-txn',
          gatewayRequestId: 'dup-request-1',
          status: 'NEEDS_RECONCILIATION',
          payment: duplicatePayment,
        },
      ],
    });
    const tx = {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue({ ...request, status: 'PROCESSING' }),
        update: jest.fn().mockResolvedValue({ ...request, status: 'APPROVED' }),
        count: jest.fn().mockResolvedValue(0),
      },
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      dailyStock: { updateMany: jest.fn() },
      attractionDailyStock: { updateMany: jest.fn() },
      timeSlotStock: { updateMany: jest.fn() },
      reservation: { update: jest.fn() },
      ticketInstance: { updateMany: jest.fn() },
      booking: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.refundRequest.findUnique.mockResolvedValue(request);
    prisma.refundTransaction.update
      .mockResolvedValueOnce({ id: 'dup-refund-txn', gatewayRequestId: 'dup-request-1' })
      .mockResolvedValue({ id: 'dup-refund-txn' });
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    refundViaVnpay.mockResolvedValue({ success: true, responseCode: '00', raw: { vnp_ResponseCode: '00' } });

    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(refundViaVnpay).not.toHaveBeenCalled();
    expect(prisma.refundTransaction.create).not.toHaveBeenCalled();
    expect(tx.dailyStock.updateMany).not.toHaveBeenCalled();
    expect(tx.ticketInstance.updateMany).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('gateway rejection marks the attempt failed and safely reopens the request', async () => {
    const request = refundFixture({
      booking: {
        ...refundFixture().booking,
        payments: [paymentFixture()],
      },
    });
    prisma.refundRequest.findUnique.mockResolvedValue(request);
    const tx = {
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      refundRequest: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    refundViaVnpay.mockResolvedValue({
      success: false,
      responseCode: '02',
      transactionStatus: '09',
      message: 'fail',
      raw: { vnp_ResponseCode: '02', vnp_TransactionStatus: '09' },
    });

    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.refundRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('reconcileRefundRequest', () => {
  test('finalizes booking only after querydr matches refund type, amount and status', async () => {
    const request = refundFixture({
      status: 'PROCESSING',
      refundTransactions: [{
        id: 'refund-txn-1',
        bookingId: 'booking-1',
        refundRequestId: 'refund-1',
        paymentId: 'payment-1',
        amount: 90000,
        transactionType: '03',
        status: 'NEEDS_RECONCILIATION',
        rawResponse: { vnp_ResponseCode: '94' },
        payment: paymentFixture(),
      }],
    });
    prisma.refundRequest.findUnique.mockResolvedValue(request);
    queryVnpayTransaction.mockResolvedValue({
      responseCode: '00',
      transactionStatus: '00',
      transactionType: '03',
      amount: 90000,
      raw: {
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_TransactionType: '03',
        vnp_Amount: '9000000',
        vnp_TransactionNo: 'refund-vnp-1',
      },
    });
    const tx = {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue({ ...request, status: 'APPROVED' }),
        count: jest.fn().mockResolvedValue(0),
      },
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      reservation: { update: jest.fn().mockResolvedValue({}) },
      ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      booking: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
    });

    await reconcileRefundRequest(req, res, next);

    expect(queryVnpayTransaction).toHaveBeenCalledWith(expect.objectContaining({
      payment: request.refundTransactions[0].payment,
    }));
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(next).not.toHaveBeenCalled();
  });

  test('preflight gateway error is FAILED and reopens the request without reconciliation', async () => {
    const request = refundFixture();
    prisma.refundRequest.findUnique.mockResolvedValue(request);
    const tx = {
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      refundRequest: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const preflightError = new Error('Thiếu dữ liệu giao dịch gốc.');
    preflightError.statusCode = 422;
    refundViaVnpay.mockRejectedValue(preflightError);
    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.refundRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(res.status).toHaveBeenCalledWith(422);
    expect(next).not.toHaveBeenCalled();
  });

  test('network error after gateway submission is kept for reconciliation', async () => {
    prisma.refundRequest.findUnique.mockResolvedValue(refundFixture());
    const networkError = new Error('Network timeout');
    networkError.gatewayAttempted = true;
    refundViaVnpay.mockRejectedValue(networkError);
    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', email: 'staff@example.com' },
      params: { refundId: 'refund-1' },
      body: { action: 'APPROVED' },
    });

    await processRefundRequest(req, res, next);

    expect(prisma.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION' }),
    }));
    expect(res.status).toHaveBeenCalledWith(202);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('reissueTicket', () => {
  test('requires a controlled reason code and a meaningful description', async () => {
    const { req, res, next } = makeReqRes({
      params: { bookingId: 'booking-1' },
      body: { reasonCode: 'UNKNOWN', reason: 'mất vé' },
    });

    await reissueTicket(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('expires valid tickets and creates replacement tokens', async () => {
    const oldTicket = {
      id: 'ticket-instance-1',
      ticketProductId: 'ticket-product-1',
      status: 'VALID',
    };
    const tx = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: 'CONFIRMED',
          snapshotAttractionId: 'attr-1',
          user: { fullName: 'Nguyen Van A', email: 'a@example.com' },
          ticketInstances: [oldTicket],
        }),
      },
      // Nhân viên được phân công địa điểm của đơn -> qua kiểm tra phạm vi.
      staffAttractionAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'assign-1' }),
      },
      ticketInstance: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: 'ticket-instance-2',
          ticketProductId: 'ticket-product-1',
          status: 'VALID',
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      params: { bookingId: 'booking-1' },
      body: {
        reasonCode: 'LOST_BY_CUSTOMER',
        reason: 'Khách làm mất điện thoại tại cổng.',
      },
    });

    await reissueTicket(req, res, next);

    expect(tx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking-1', status: 'VALID' },
      data: { status: 'EXPIRED' },
    });
    expect(tx.ticketInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-1',
        ticketProductId: 'ticket-product-1',
        qrCodeToken: expect.any(String),
        status: 'VALID',
      }),
    });
    expect(sendReissueTicketEmail).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TICKET_REISSUED',
        entityId: 'booking-1',
        metadata: expect.objectContaining({
          reasonCode: 'LOST_BY_CUSTOMER',
          ticketCount: 1,
        }),
      }),
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          bookingId: 'booking-1',
          reissuedCount: 1,
          emailDelivered: true,
        },
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('does not reissue tickets from a completed booking', async () => {
    const tx = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: 'COMPLETED',
          snapshotAttractionId: 'attr-1',
          user: { fullName: 'Nguyen Van A', email: 'a@example.com' },
          ticketInstances: [{ id: 'ticket-1', ticketProductId: 'product-1' }],
        }),
      },
      staffAttractionAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'assign-1' }),
      },
      ticketInstance: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    const { req, res, next } = makeReqRes({
      params: { bookingId: 'booking-1' },
      body: {
        reasonCode: 'LOST_BY_CUSTOMER',
        reason: 'Khách báo mất vé sau khi đã sử dụng.',
      },
    });

    await reissueTicket(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.ticketInstance.updateMany).not.toHaveBeenCalled();
  });
});
