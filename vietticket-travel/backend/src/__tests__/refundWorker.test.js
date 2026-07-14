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
    refundRequestId: 'refund-1',
    amount: 100000,
    transactionType: '02',
    gatewayRequestId: 'request-1',
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
    refundTransaction: {
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
  };
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

test('VNPay từ chối dứt khoát thì đánh dấu FAILED và trả request về hàng chờ', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
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

  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(tx.refundRequest.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PENDING', processingStartedAt: null }),
  }));
  expect(tx.booking.update).not.toHaveBeenCalled();
});

test('mã 94 không bị gửi lặp mà chuyển sang NEEDS_RECONCILIATION', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  refundViaVnpay.mockResolvedValue({
    success: false,
    responseCode: '94',
    transactionStatus: '05',
    raw: { vnp_ResponseCode: '94', vnp_TransactionStatus: '05' },
  });

  await expect(sweepPendingRefundTransactions()).resolves.toBe(1);
  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION' }),
  }));
  expect(refundViaVnpay).toHaveBeenCalledTimes(1);
});

test('lỗi mạng sau lúc bắt đầu gửi được giữ để đối soát, không tự retry', async () => {
  const transaction = pendingTransaction();
  const tx = finalizationTx();
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  const networkError = new Error('Network timeout');
  networkError.gatewayAttempted = true;
  refundViaVnpay.mockRejectedValue(networkError);

  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);
  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION' }),
  }));
});

test('lỗi dữ liệu trước khi gọi gateway là FAILED, không gắn nhầm cần đối soát', async () => {
  const transaction = pendingTransaction({ payment: payment({ amount: null }) });
  const tx = finalizationTx();
  prisma.refundTransaction.findMany.mockResolvedValue([transaction]);
  prisma.$transaction.mockImplementation((callback) => callback(tx));

  await expect(sweepPendingRefundTransactions()).resolves.toBe(0);
  expect(refundViaVnpay).not.toHaveBeenCalled();
  expect(tx.refundTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'FAILED' }),
  }));
  expect(tx.refundRequest.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PENDING' }),
  }));
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
