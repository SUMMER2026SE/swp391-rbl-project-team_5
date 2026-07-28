'use strict';

jest.mock('../config/prisma', () => ({
  refundTransaction: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  refundRequest: { updateMany: jest.fn() },
  booking: { update: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock('../controllers/paymentController', () => ({
  queryVnpayTransaction: jest.fn(),
  refundViaVnpay: jest.fn(),
}));

jest.mock('../utils/jobLease', () => ({
  runWithJobLease: jest.fn((name, ttl, task) => task()),
}));

const prisma = require('../config/prisma');
const {
  queryVnpayTransaction,
  refundViaVnpay,
} = require('../controllers/paymentController');
const {
  sweepPendingRefundTransactions,
  sweepRefundReconciliations,
} = require('../utils/refundWorker');

function payment(overrides = {}) {
  return {
    id: 'pay-1',
    amount: 100000,
    transactionId: 'vnp-txn-ref',
    paymentGateway: 'VNPAY',
    isDuplicate: false,
    rawResponse: {
      vnp_TransactionNo: '123456',
      vnp_PayDate: '20260710120000',
    },
    ...overrides,
  };
}

function pendingTransaction(overrides = {}) {
  return {
    id: 'refund-txn-1',
    bookingId: 'booking-1',
    paymentId: 'pay-1',
    refundRequestId: 'refund-1',
    amount: 100000,
    status: 'PENDING',
    transactionType: '02',
    gatewayRequestId: 'request-1',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
    payment: payment(),
    refundRequest: { id: 'refund-1', type: 'CUSTOMER_CANCELLATION' },
    ...overrides,
  };
}

function successfulGatewayResult(overrides = {}) {
  return {
    success: true,
    responseCode: '00',
    transactionStatus: '00',
    raw: {
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: 'refund-vnp-1',
    },
    ...overrides,
  };
}

function finalizationTx(requestOverrides = {}) {
  const refundRequest = {
    id: 'refund-1',
    type: 'CUSTOMER_CANCELLATION',
    status: 'PROCESSING',
    booking: {
      id: 'booking-1',
      reservation: {
        id: 'reservation-1',
        status: 'CONFIRMED',
        ticketProductId: 'ticket-product-1',
        timeSlotId: null,
        date: new Date('2026-07-20T00:00:00.000Z'),
        quantity: 1,
        ticketProduct: { attractionId: 'attraction-1' },
      },
      ticketInstances: [{ id: 'ticket-1', status: 'VALID' }],
    },
    ...requestOverrides,
  };

  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'pay-1' }]),
    refundTransaction: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    refundRequest: {
      findUnique: jest.fn().mockResolvedValue(refundRequest),
      update: jest.fn().mockResolvedValue({ ...refundRequest, status: 'APPROVED' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    reservation: { update: jest.fn().mockResolvedValue({}) },
    ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    booking: { update: jest.fn().mockResolvedValue({}) },
    loyaltyTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'lt-rev' }),
    },
    user: { update: jest.fn().mockResolvedValue({ loyaltyPoints: 0 }) },
  };
}

function attachWorkerLedger(tx, transactions) {
  const ledger = transactions.map((transaction) => ({
    id: transaction.id,
    paymentId: transaction.paymentId,
    refundRequestId: transaction.refundRequestId,
    amount: transaction.amount,
    status: transaction.status,
    createdAt: transaction.createdAt,
  }));
  const activeStatuses = new Set([
    'PENDING',
    'PROCESSING',
    'NEEDS_RECONCILIATION',
    'SUCCESS',
  ]);

  tx.refundTransaction.findMany.mockImplementation(async () => ledger
    .filter((transaction) => activeStatuses.has(transaction.status))
    .sort((left, right) => (
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    )));
  tx.refundTransaction.updateMany.mockImplementation(async ({ where, data }) => {
    const row = ledger.find((transaction) => transaction.id === where.id);
    const statusMatches = !where.status
      || (typeof where.status === 'string'
        ? row?.status === where.status
        : where.status.in?.includes(row?.status));
    if (!row || !statusMatches) {
      return { count: 0 };
    }
    Object.assign(row, data);
    return { count: 1 };
  });
  tx.refundTransaction.update.mockImplementation(async ({ where, data }) => {
    const row = ledger.find((transaction) => transaction.id === where.id);
    if (row) Object.assign(row, data);
    return row || {};
  });
  return ledger;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  prisma.refundTransaction.findMany.mockResolvedValue([]);
  prisma.refundTransaction.update.mockResolvedValue({});
  prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => jest.restoreAllMocks());

test('không có giao dịch chờ thì worker không gọi VNPay', async () => {
  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);
  expect(refundViaVnpay).not.toHaveBeenCalled();
});

test('chỉ hoàn tất booking và vé sau khi VNPay xác nhận 00/00', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  refundViaVnpay.mockResolvedValue(successfulGatewayResult());

  await expect(sweepPendingRefundTransactions()).resolves.toBe(1);

  expect(refundViaVnpay).toHaveBeenCalledWith(expect.objectContaining({
    payment: transaction.payment,
    amount: 100000,
    transactionType: '02',
    requestId: 'request-1',
  }));
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
  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'SUCCESS' }),
  }));
});

test('fixture bảo vệ dùng adapter local và không gọi VNPay thật', async () => {
  const transaction = pendingTransaction({
    payment: payment({
      rawResponse: {
        source: 'operational_fixture_v2',
        vnp_TransactionNo: '123456',
        vnp_CreateDate: '20260710120000',
      },
    }),
  });
  const tx = finalizationTx();
  attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepPendingRefundTransactions()).resolves.toBe(1);

  expect(refundViaVnpay).not.toHaveBeenCalled();
  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      status: 'SUCCESS',
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
    }),
  }));
});

test('VNPay từ chối dứt khoát thì đánh dấu FAILED và trả request về hàng chờ', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  refundViaVnpay.mockResolvedValue({
    success: false,
    responseCode: '95',
    transactionStatus: '09',
    message: 'Rejected',
    raw: { vnp_ResponseCode: '95', vnp_TransactionStatus: '09' },
  });

  await expect(sweepPendingRefundTransactions()).resolves.toBe(1);

  expect(tx.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: transaction.id, status: 'PROCESSING' }),
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(tx.refundRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      id: transaction.refundRequestId,
      status: { in: ['PENDING', 'PROCESSING'] },
    }),
    data: expect.objectContaining({ status: 'PENDING', processingStartedAt: null }),
  }));
  expect(tx.booking.update).not.toHaveBeenCalled();
});

test('mã 94 không bị gửi lặp mà chuyển sang NEEDS_RECONCILIATION', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  refundViaVnpay.mockResolvedValue({
    success: false,
    responseCode: '94',
    transactionStatus: '05',
    raw: { vnp_ResponseCode: '94', vnp_TransactionStatus: '05' },
  });

  await expect(sweepPendingRefundTransactions()).resolves.toBe(1);
  expect(tx.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: transaction.id, status: 'PROCESSING' }),
    data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION' }),
  }));
  expect(refundViaVnpay).toHaveBeenCalledTimes(1);
});

test('lỗi mạng sau lúc bắt đầu gửi được giữ để đối soát, không tự retry', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  const networkError = new Error('Network timeout');
  networkError.gatewayAttempted = true;
  refundViaVnpay.mockRejectedValue(networkError);

  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);
  expect(tx.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: transaction.id, status: 'PROCESSING' }),
    data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION' }),
  }));
});

test('lỗi dữ liệu trước khi gọi gateway là FAILED, không gắn nhầm cần đối soát', async () => {
  const transaction = pendingTransaction({ payment: payment({ amount: null }) });
  const tx = finalizationTx();
  attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);
  expect(refundViaVnpay).not.toHaveBeenCalled();
  expect(tx.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: transaction.id, status: 'PROCESSING' }),
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(tx.refundRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      id: transaction.refundRequestId,
      status: { in: ['PENDING', 'PROCESSING'] },
    }),
    data: expect.objectContaining({ status: 'PENDING' }),
  }));
});

test('gateway đã báo thành công nhưng finalize DB lỗi thì chỉ chuyển sang đối soát', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  const ledger = attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  refundViaVnpay.mockResolvedValue(successfulGatewayResult());
  tx.booking.update.mockRejectedValueOnce(new Error('DB finalize failed'));

  await expect(sweepPendingRefundTransactions()).resolves.toBe(1);
  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);

  expect(refundViaVnpay).toHaveBeenCalledTimes(1);
  expect(ledger.find((item) => item.id === transaction.id).status)
    .toBe('NEEDS_RECONCILIATION');
  expect(tx.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: transaction.id, status: 'PROCESSING' }),
    data: expect.objectContaining({
      status: 'NEEDS_RECONCILIATION',
      gatewayResponseCode: '00',
      gatewayTransactionStatus: '00',
      rawResponse: expect.objectContaining({
        workerError: 'DB finalize failed',
      }),
    }),
  }));
  expect(tx.refundTransaction.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(tx.refundRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PENDING' }),
  }));
});

test('không gửi khi các khoản SUCCESS trước đó làm vượt số dư payment', async () => {
  const transaction = pendingTransaction({
    amount: 40000,
    transactionType: '03',
    createdAt: new Date('2026-07-13T00:01:00.000Z'),
  });
  const priorSuccess = {
    id: 'refund-txn-success',
    paymentId: 'pay-1',
    refundRequestId: 'refund-old',
    amount: 70000,
    status: 'SUCCESS',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
  };
  const tx = finalizationTx();
  const ledger = attachWorkerLedger(tx, [priorSuccess, transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);

  expect(refundViaVnpay).not.toHaveBeenCalled();
  expect(ledger.find((item) => item.id === transaction.id).status).toBe('FAILED');
  expect(tx.refundRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      id: transaction.refundRequestId,
      status: { in: ['PENDING', 'PROCESSING'] },
    }),
    data: expect.objectContaining({
      status: 'PENDING',
      processingStartedAt: null,
      staffNotes: expect.stringMatching(/số dư có thể hoàn/i),
    }),
  }));
});

test.each(['PROCESSING', 'NEEDS_RECONCILIATION'])(
  'không claim khoản PENDING khi payment còn khoản %s chưa rõ kết quả',
  async (blockingStatus) => {
    const transaction = pendingTransaction({
      amount: 40000,
      transactionType: '03',
      createdAt: new Date('2026-07-13T00:01:00.000Z'),
    });
    const ambiguous = {
      id: 'refund-txn-ambiguous',
      paymentId: 'pay-1',
      refundRequestId: 'refund-old',
      amount: 30000,
      status: blockingStatus,
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
    };
    const tx = finalizationTx();
    const ledger = attachWorkerLedger(tx, [ambiguous, transaction]);
    prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await expect(sweepPendingRefundTransactions()).resolves.toBe(0);

    expect(refundViaVnpay).not.toHaveBeenCalled();
    expect(ledger.find((item) => item.id === transaction.id).status).toBe('PENDING');
    expect(tx.refundTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.refundTransaction.update).not.toHaveBeenCalled();
  },
);

test('nhiều khoản PENDING cùng payment được gửi tuần tự theo createdAt', async () => {
  const first = pendingTransaction({
    id: 'refund-txn-1',
    refundRequestId: 'refund-1',
    amount: 30000,
    transactionType: '03',
    gatewayRequestId: 'request-1',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
  });
  const second = pendingTransaction({
    id: 'refund-txn-2',
    refundRequestId: 'refund-2',
    amount: 40000,
    transactionType: '03',
    gatewayRequestId: 'request-2',
    createdAt: new Date('2026-07-13T00:01:00.000Z'),
    refundRequest: { id: 'refund-2', type: 'CUSTOMER_CANCELLATION' },
  });
  const tx = finalizationTx();
  const ledger = attachWorkerLedger(tx, [first, second]);
  prisma.refundTransaction.findMany.mockResolvedValue([first, second]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  refundViaVnpay.mockResolvedValue(successfulGatewayResult());

  await expect(sweepPendingRefundTransactions()).resolves.toBe(2);

  expect(refundViaVnpay).toHaveBeenCalledTimes(2);
  expect(refundViaVnpay.mock.calls.map(([request]) => request.requestId))
    .toEqual(['request-1', 'request-2']);
  expect(ledger.map((transaction) => transaction.status))
    .toEqual(['SUCCESS', 'SUCCESS']);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
  expect(prisma.$transaction).toHaveBeenCalledWith(
    expect.any(Function),
    { isolationLevel: 'Serializable' },
  );
});

test('đối soát xác nhận refund thành công thì mới hoàn tất booking', async () => {
  const transaction = pendingTransaction({
    status: 'NEEDS_RECONCILIATION',
    submittedAt: new Date('2026-07-13T00:00:00.000Z'),
    rawResponse: { vnp_ResponseCode: '94' },
  });
  const tx = finalizationTx();
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  queryVnpayTransaction.mockResolvedValue({
    responseCode: '00',
    transactionStatus: '00',
    transactionType: '02',
    amount: 100000,
    raw: {
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionType: '02',
      vnp_Amount: '10000000',
      vnp_TransactionNo: 'refund-vnp-1',
      vnp_RequestId: 'request-1',
    },
  });

  await expect(sweepRefundReconciliations({
    now: new Date('2026-07-13T01:00:00.000Z'),
  })).resolves.toBe(1);

  expect(queryVnpayTransaction).toHaveBeenCalledWith(expect.objectContaining({
    payment: transaction.payment,
  }));
  expect(tx.booking.update).toHaveBeenCalledWith({
    where: { id: 'booking-1' },
    data: { status: 'REFUNDED', refundRequired: false },
  });
});

test('00/00 da luu chi retry finalize DB, khong hoi lai hay gui lai VNPay', async () => {
  const transaction = pendingTransaction({
    status: 'NEEDS_RECONCILIATION',
    submittedAt: new Date('2026-07-13T00:00:00.000Z'),
    gatewayResponseCode: '00',
    gatewayTransactionStatus: '00',
    gatewayTransactionId: 'refund-vnp-1',
    rawResponse: {
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: 'refund-vnp-1',
      workerError: 'DB finalize failed',
    },
  });
  const tx = finalizationTx();
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepRefundReconciliations({
    now: new Date('2026-07-13T01:00:00.000Z'),
  })).resolves.toBe(1);

  expect(queryVnpayTransaction).not.toHaveBeenCalled();
  expect(refundViaVnpay).not.toHaveBeenCalled();
  expect(tx.refundRequest.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'refund-1' },
    data: expect.objectContaining({ status: 'APPROVED' }),
  }));
  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: transaction.id }),
    data: expect.objectContaining({
      status: 'SUCCESS',
      processedAt: expect.any(Date),
      reconciledAt: expect.any(Date),
    }),
  }));
});

test('claim cu bi dung truoc submittedAt duoc xep hang lai ma khong goi VNPay', async () => {
  const transaction = pendingTransaction({
    status: 'PROCESSING',
    submittedAt: null,
    updatedAt: new Date('2026-07-13T00:00:00.000Z'),
  });
  const tx = finalizationTx();
  const ledger = attachWorkerLedger(tx, [transaction]);
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepRefundReconciliations({
    now: new Date('2026-07-13T01:00:00.000Z'),
  })).resolves.toBe(1);

  expect(ledger[0].status).toBe('PENDING');
  expect(queryVnpayTransaction).not.toHaveBeenCalled();
  expect(refundViaVnpay).not.toHaveBeenCalled();
  expect(tx.refundRequest.updateMany).toHaveBeenCalledWith({
    where: { id: transaction.refundRequestId, status: 'PROCESSING' },
    data: expect.objectContaining({
      status: 'PENDING',
      processingStartedAt: null,
    }),
  });
});
