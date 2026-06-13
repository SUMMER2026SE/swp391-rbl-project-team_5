'use strict';

jest.mock('../config/prisma', () => ({
  refundTransaction: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  booking: {
    update: jest.fn(),
  },
  $transaction: jest.fn(),
}));

jest.mock('../controllers/paymentController', () => ({
  refundViaVnpay: jest.fn(),
}));

jest.mock('../utils/jobLease', () => ({
  runWithJobLease: jest.fn((name, ttl, task) => task()),
}));

const prisma = require('../config/prisma');
const { refundViaVnpay } = require('../controllers/paymentController');
const { sweepPendingRefundTransactions } = require('../utils/refundWorker');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  prisma.refundTransaction.update.mockResolvedValue({});
});

describe('sweepPendingRefundTransactions', () => {
  test('không có refund transaction PENDING -> không làm gì', async () => {
    prisma.refundTransaction.findMany.mockResolvedValue([]);
    const processed = await sweepPendingRefundTransactions();
    expect(processed).toBe(0);
    expect(refundViaVnpay).not.toHaveBeenCalled();
  });

  test('có refund transaction PENDING -> xử lý thành công qua VNPay', async () => {
    const mockTxn = {
      id: 'txn-1',
      bookingId: 'bk-1',
      amount: 50000,
      transactionType: '03',
      gatewayRequestId: 'req-1',
      payment: { id: 'pay-1', transactionId: 'txn-ref-1' },
    };
    prisma.refundTransaction.findMany.mockResolvedValue([mockTxn]);
    prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
    refundViaVnpay.mockResolvedValue({ success: true, raw: { vnp_ResponseCode: '00' } });

    const tx = {
      refundTransaction: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      booking: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const processed = await sweepPendingRefundTransactions();
    expect(processed).toBe(1);
    expect(refundViaVnpay).toHaveBeenCalledWith({
      payment: mockTxn.payment,
      amount: 50000,
      transactionType: '03',
      createBy: 'refund-worker',
      ipAddr: '127.0.0.1',
      orderInfo: 'Hoan tien trung booking bk-1',
      requestId: 'req-1',
    });
    expect(tx.refundTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-1' },
        data: expect.objectContaining({ status: 'SUCCESS' }),
      }),
    );
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'bk-1' },
      data: { refundRequired: false },
    });
  });

  test('gọi cổng VNPay thất bại -> đánh dấu FAILED', async () => {
    const mockTxn = {
      id: 'txn-2',
      bookingId: 'bk-2',
      amount: 100000,
      transactionType: '02',
      gatewayRequestId: 'req-2',
      payment: { id: 'pay-2', transactionId: 'txn-ref-2' },
    };
    prisma.refundTransaction.findMany.mockResolvedValue([mockTxn]);
    prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
    refundViaVnpay.mockResolvedValue({ success: false, raw: { vnp_ResponseCode: '99' } });

    const tx = {
      refundTransaction: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
      booking: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const processed = await sweepPendingRefundTransactions();
    expect(processed).toBe(1);
    expect(tx.refundTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-2' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  test('lỗi exception trong quá trình xử lý -> đánh dấu NEEDS_RECONCILIATION', async () => {
    const mockTxn = {
      id: 'txn-3',
      bookingId: 'bk-3',
      amount: 100000,
      payment: { id: 'pay-3' },
    };
    prisma.refundTransaction.findMany.mockResolvedValue([mockTxn]);
    prisma.refundTransaction.updateMany.mockResolvedValue({ count: 1 });
    refundViaVnpay.mockRejectedValue(new Error('Network Error'));

    const processed = await sweepPendingRefundTransactions();
    expect(processed).toBe(0);
    expect(prisma.refundTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-3' },
        data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION' }),
      }),
    );
  });
});
