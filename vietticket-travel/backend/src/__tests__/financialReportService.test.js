jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  buildFinancialTimeline,
  getPlatformFinancialReport,
  listPlatformFinancialTransactions,
  recognizedAmountsOf,
  summarizeFinancialRows,
} = require('../services/financialReportService');

function bookingForPartner(partnerId = 'partner-1') {
  return {
    id: 'booking-1',
    fullName: 'Customer One',
    email: 'customer@example.com',
    status: 'COMPLETED',
    reservation: {
      ticketProduct: {
        attraction: {
          title: 'Museum',
          partner: { id: partnerId, businessName: 'Museum Partner' },
        },
      },
    },
  };
}

afterEach(() => jest.clearAllMocks());

describe('financial report calculations', () => {
  test('counts duplicate captures as cash but not as sales', () => {
    const summary = summarizeFinancialRows({
      payments: [
        { amount: 100000, isDuplicate: false },
        { amount: 100000, isDuplicate: true },
      ],
      refunds: [{ amount: 100000 }],
      recognizedBookings: [{
        commissionRateSnapshot: 0.1,
        commissionAmountSnapshot: 10000,
        partnerNetAmountSnapshot: 90000,
        payments: [{ amount: 100000 }],
        refundTransactions: [],
      }],
    });

    expect(summary).toEqual({
      capturedAmount: 200000,
      salesCapturedAmount: 100000,
      duplicateCapturedAmount: 100000,
      refundedAmount: 100000,
      netCashAmount: 100000,
      recognizedGrossAmount: 100000,
      recognizedRefundAmount: 0,
      recognizedNetAmount: 100000,
      commissionRevenueAmount: 10000,
      partnerPayableAmount: 90000,
      successfulPaymentCount: 2,
      successfulRefundCount: 1,
    });
  });

  test('recognizes only the retained amount after a fee-based refund', () => {
    const recognized = recognizedAmountsOf({
      commissionRateSnapshot: 0.1,
      commissionAmountSnapshot: 10000,
      partnerNetAmountSnapshot: 90000,
      payments: [{ amount: 100000 }],
      refundTransactions: [
        { amount: 80000, refundRequest: { type: 'CUSTOMER_CANCELLATION' } },
        { amount: 100000, refundRequest: { type: 'DUPLICATE_PAYMENT' } },
      ],
    });

    expect(recognized).toEqual({
      grossAmount: 100000,
      refundAmount: 80000,
      netAmount: 20000,
      commissionAmount: 2000,
      partnerPayableAmount: 18000,
    });
  });

  test('rounds recomputed post-refund commission to integer VND', () => {
    const recognized = recognizedAmountsOf({
      commissionRateSnapshot: 0.1,
      payments: [{ amount: 99999 }],
      refundTransactions: [
        { amount: 1, refundRequest: { type: 'CUSTOMER_CANCELLATION' } },
      ],
    });

    expect(recognized).toEqual({
      grossAmount: 99999,
      refundAmount: 1,
      netAmount: 99998,
      commissionAmount: 10000,
      partnerPayableAmount: 89998,
    });
  });

  test('uses paidAt and processedAt for financial timeline buckets', () => {
    const now = new Date('2026-06-12T12:00:00.000Z');
    const timeline = buildFinancialTimeline(
      [{
        amount: 120000,
        createdAt: new Date('2026-06-10T03:00:00.000Z'),
        paidAt: new Date('2026-06-12T03:00:00.000Z'),
      }],
      [{
        amount: 20000,
        createdAt: new Date('2026-06-11T03:00:00.000Z'),
        processedAt: new Date('2026-06-12T04:00:00.000Z'),
      }],
      'week',
      now,
    );

    expect(timeline.at(-1)).toEqual(expect.objectContaining({
      label: '12/6',
      capturedAmount: 120000,
      refundedAmount: 20000,
      netCashAmount: 100000,
      paymentCount: 1,
      refundCount: 1,
    }));
  });

  test('builds a platform report from payment, refund and booking ledgers', async () => {
    const booking = bookingForPartner();
    prisma.payment.findMany.mockResolvedValue([{
      amount: 300000,
      isDuplicate: false,
      paidAt: new Date('2026-07-10T03:00:00.000Z'),
      createdAt: new Date('2026-07-09T03:00:00.000Z'),
      booking,
    }]);
    prisma.refundTransaction.findMany.mockResolvedValue([{
      amount: 50000,
      processedAt: new Date('2026-07-11T03:00:00.000Z'),
      reconciledAt: null,
      createdAt: new Date('2026-07-10T03:00:00.000Z'),
      booking,
    }]);
    prisma.booking.findMany.mockResolvedValue([{
      status: 'COMPLETED',
      commissionRateSnapshot: 0.1,
      commissionAmountSnapshot: 30000,
      partnerNetAmountSnapshot: 270000,
      payments: [{ amount: 300000 }],
      refundTransactions: [],
      reservation: booking.reservation,
    }]);
    prisma.partnerProfile.findMany.mockResolvedValue([{
      id: 'partner-1',
      businessName: 'Museum Partner',
      status: 'APPROVED',
      commissionRate: 0.1,
    }]);
    prisma.refundRequest.aggregate.mockResolvedValueOnce({
      _count: { _all: 2 },
      _sum: { amount: 70000 },
    });
    prisma.refundRequest.aggregate.mockResolvedValueOnce({
      _count: { _all: 1 },
      _sum: { amount: 50000 },
    });

    const report = await getPlatformFinancialReport('month');

    expect(report.summary).toEqual(expect.objectContaining({
      capturedAmount: 300000,
      refundedAmount: 50000,
      netCashAmount: 250000,
      recognizedNetAmount: 300000,
      commissionRevenueAmount: 30000,
      partnerPayableAmount: 270000,
      openRefundCount: 2,
      needsReconciliationCount: 1,
    }));
    expect(report.partners[0]).toEqual(expect.objectContaining({
      id: 'partner-1',
      capturedAmount: 300000,
      refundedAmount: 50000,
      recognizedGrossAmount: 300000,
      recognizedNetAmount: 300000,
      commissionRevenueAmount: 30000,
    }));
    expect(prisma.payment.findMany.mock.calls[0][0].where).not.toHaveProperty('isDuplicate');
    expect(prisma.partnerProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'APPROVED' },
    }));
    expect(prisma.refundRequest.aggregate.mock.calls[1][0].where).toEqual({
      status: { in: ['PENDING', 'PROCESSING'] },
      refundTransactions: {
        some: { status: { in: ['FAILED', 'NEEDS_RECONCILIATION'] } },
        none: { status: 'SUCCESS' },
      },
    });
  });

  test('queries only refund ledger for reconciliation status', async () => {
    const booking = bookingForPartner();
    prisma.refundTransaction.findMany.mockResolvedValue([{
      id: 'refund-tx-1',
      bookingId: booking.id,
      amount: 90000,
      gateway: 'VNPAY',
      gatewayRequestId: 'refund-request-1',
      gatewayTransactionId: null,
      status: 'NEEDS_RECONCILIATION',
      processedAt: null,
      reconciledAt: null,
      createdAt: new Date('2026-07-10T03:00:00.000Z'),
      booking,
    }]);

    const result = await listPlatformFinancialTransactions({
      period: 'month',
      type: 'ALL',
      status: 'NEEDS_RECONCILIATION',
    });

    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(result.transactions).toEqual([
      expect.objectContaining({
        type: 'REFUND',
        status: 'NEEDS_RECONCILIATION',
        amount: 90000,
      }),
    ]);
  });
});
