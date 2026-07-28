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

  test('does not count Rescue credit as a second cash capture', () => {
    const now = new Date('2026-07-28T10:00:00.000Z');
    const payments = [
      {
        amount: 100000,
        isDuplicate: false,
        paymentGateway: 'VNPAY',
        paidAt: new Date('2026-07-28T03:00:00.000Z'),
      },
      {
        amount: 80000,
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
        paidAt: new Date('2026-07-28T04:00:00.000Z'),
      },
    ];
    const refunds = [
      {
        amount: 20000,
        processedAt: new Date('2026-07-28T05:00:00.000Z'),
      },
    ];

    const summary = summarizeFinancialRows({
      payments,
      refunds,
      recognizedBookings: [],
    });
    const timeline = buildFinancialTimeline(
      payments,
      refunds,
      'week',
      now,
    );

    expect(summary).toEqual(expect.objectContaining({
      capturedAmount: 100000,
      salesCapturedAmount: 100000,
      refundedAmount: 20000,
      netCashAmount: 80000,
      successfulPaymentCount: 1,
    }));
    expect(timeline.at(-1)).toEqual(expect.objectContaining({
      capturedAmount: 100000,
      refundedAmount: 20000,
      netCashAmount: 80000,
      paymentCount: 1,
      refundCount: 1,
    }));
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

  test('attributes a successful funding-ledger refund to its Rescue target', () => {
    const recognized = recognizedAmountsOf({
      commissionRateSnapshot: 0.1,
      commissionAmountSnapshot: 8000,
      partnerNetAmountSnapshot: 72000,
      payments: [{
        amount: 80000,
        paymentGateway: 'RECOVERY_CREDIT',
      }],
      refundTransactions: [],
      refundRequestsTargeting: [{
        type: 'CUSTOMER_CANCELLATION',
        refundTransactions: [{
          id: 'refund-target-40',
          status: 'SUCCESS',
          amount: 40000,
        }],
      }],
    });

    expect(recognized).toEqual({
      grossAmount: 80000,
      refundAmount: 40000,
      netAmount: 40000,
      commissionAmount: 4000,
      partnerPayableAmount: 36000,
    });
  });

  test('deduplicates a refund when source and target are the same booking', () => {
    const directRefund = {
      id: 'refund-difference-20',
      status: 'SUCCESS',
      amount: 20000,
      refundRequest: { type: 'PARTNER_CANCELLATION' },
    };
    const recognized = recognizedAmountsOf({
      commissionRateSnapshot: 0.1,
      payments: [{ amount: 100000 }],
      refundTransactions: [directRefund],
      refundRequestsTargeting: [{
        type: 'PARTNER_CANCELLATION',
        refundTransactions: [{ ...directRefund, refundRequest: undefined }],
      }],
    });

    expect(recognized).toEqual({
      grossAmount: 100000,
      refundAmount: 20000,
      netAmount: 80000,
      commissionAmount: 8000,
      partnerPayableAmount: 72000,
    });
  });

  test('recognizes no residual value for free-cancelled or Rescue-displaced bookings', () => {
    const freeCancelledReplacement = recognizedAmountsOf({
      commissionRateSnapshot: 0.1,
      payments: [{ amount: 80000, paymentGateway: 'RECOVERY_CREDIT' }],
      refundTransactions: [],
      refundRequestsTargeting: [{
        type: 'CUSTOMER_CANCELLATION',
        refundTransactions: [{
          id: 'refund-free-cancel',
          status: 'SUCCESS',
          amount: 80000,
        }],
      }],
    });
    const providerCancelledSource = recognizedAmountsOf({
      recoveryCaseAsOriginal: { id: 'rescue-case-1', status: 'REPLACED' },
      commissionRateSnapshot: 0.1,
      payments: [{ amount: 100000, paymentGateway: 'VNPAY' }],
      refundTransactions: [{
        id: 'refund-difference-20',
        status: 'SUCCESS',
        amount: 20000,
        refundRequest: { type: 'PARTNER_CANCELLATION' },
      }],
    });

    expect(freeCancelledReplacement).toEqual({
      grossAmount: 80000,
      refundAmount: 80000,
      netAmount: 0,
      commissionAmount: 0,
      partnerPayableAmount: 0,
    });
    expect(providerCancelledSource).toEqual({
      grossAmount: 0,
      refundAmount: 0,
      netAmount: 0,
      commissionAmount: 0,
      partnerPayableAmount: 0,
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
      refundRequest: {
        type: 'PARTNER_CANCELLATION',
        reason: 'Rescue fallback',
        targetBookingId: 'booking-target',
        targetBooking: {
          ...bookingForPartner('partner-target'),
          id: 'booking-target',
          fullName: 'Target Customer',
        },
      },
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
    expect(prisma.payment.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({
      paymentGateway: { not: 'RECOVERY_CREDIT' },
    }));
    expect(prisma.partnerProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
    }));
    expect(prisma.refundRequest.aggregate.mock.calls[1][0].where).toEqual({
      status: { in: ['PENDING', 'PROCESSING'] },
      booking: { isForecastTrainingSample: false },
      refundTransactions: {
        some: { status: { in: ['FAILED', 'NEEDS_RECONCILIATION'] } },
        none: { status: 'SUCCESS' },
      },
    });
  });

  test('keeps one cash ledger across a Rescue chain while recognizing only the target', async () => {
    const eventAt = new Date();
    const rootBooking = bookingForPartner('partner-root');
    rootBooking.id = 'booking-root-100';
    rootBooking.reservation.ticketProduct.attraction.partner.businessName = 'Root Partner';
    const replacementBooking = bookingForPartner('partner-replacement');
    replacementBooking.id = 'booking-replacement-80';
    replacementBooking.status = 'REFUNDED';
    replacementBooking.reservation.ticketProduct.attraction.partner.businessName = 'Replacement Partner';

    prisma.payment.findMany.mockResolvedValue([
      {
        amount: 100000,
        isDuplicate: false,
        paymentGateway: 'VNPAY',
        paidAt: eventAt,
        createdAt: eventAt,
        booking: rootBooking,
      },
      // Mocks do not apply Prisma where clauses. Keeping this row in the
      // result verifies the calculator also rejects internal Rescue credit.
      {
        amount: 80000,
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
        paidAt: eventAt,
        createdAt: eventAt,
        booking: replacementBooking,
      },
    ]);
    prisma.refundTransaction.findMany.mockResolvedValue([
      {
        amount: 20000,
        processedAt: eventAt,
        reconciledAt: null,
        createdAt: eventAt,
        booking: rootBooking,
      },
      {
        amount: 40000,
        processedAt: eventAt,
        reconciledAt: null,
        createdAt: eventAt,
        booking: rootBooking,
      },
    ]);
    prisma.booking.findMany.mockResolvedValue([
      {
        status: 'REFUNDED',
        recoveryCaseAsOriginal: { id: 'rescue-case-root', status: 'REPLACED' },
        commissionRateSnapshot: 0.1,
        commissionAmountSnapshot: 10000,
        partnerNetAmountSnapshot: 90000,
        payments: [{ amount: 100000 }],
        refundTransactions: [{
          id: 'refund-difference-20',
          status: 'SUCCESS',
          amount: 20000,
          refundRequest: { type: 'PARTNER_CANCELLATION' },
        }],
        refundRequestsTargeting: [{
          type: 'PARTNER_CANCELLATION',
          refundTransactions: [{
            id: 'refund-difference-20',
            status: 'SUCCESS',
            amount: 20000,
          }],
        }],
        reservation: rootBooking.reservation,
      },
      {
        status: 'REFUNDED',
        recoveryCaseAsOriginal: null,
        commissionRateSnapshot: 0.1,
        commissionAmountSnapshot: 8000,
        partnerNetAmountSnapshot: 72000,
        payments: [{ amount: 80000 }],
        refundTransactions: [],
        refundRequestsTargeting: [{
          type: 'CUSTOMER_CANCELLATION',
          refundTransactions: [{
            id: 'refund-target-40',
            status: 'SUCCESS',
            amount: 40000,
          }],
        }],
        reservation: replacementBooking.reservation,
      },
    ]);
    prisma.partnerProfile.findMany.mockResolvedValue([
      {
        id: 'partner-root',
        businessName: 'Root Partner',
        status: 'APPROVED',
        commissionRate: 0.1,
      },
      {
        id: 'partner-replacement',
        businessName: 'Replacement Partner',
        status: 'APPROVED',
        commissionRate: 0.1,
      },
    ]);
    prisma.refundRequest.aggregate
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } })
      .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } });

    const report = await getPlatformFinancialReport('month');
    const rootPartner = report.partners.find((item) => item.id === 'partner-root');
    const replacementPartner = report.partners.find(
      (item) => item.id === 'partner-replacement',
    );

    expect(report.summary).toEqual(expect.objectContaining({
      capturedAmount: 100000,
      refundedAmount: 60000,
      netCashAmount: 40000,
      successfulPaymentCount: 1,
      successfulRefundCount: 2,
      recognizedGrossAmount: 80000,
      recognizedRefundAmount: 40000,
      recognizedNetAmount: 40000,
      commissionRevenueAmount: 4000,
      partnerPayableAmount: 36000,
    }));
    expect(report.timeline.reduce((sum, item) => ({
      captured: sum.captured + item.capturedAmount,
      refunded: sum.refunded + item.refundedAmount,
      payments: sum.payments + item.paymentCount,
      refunds: sum.refunds + item.refundCount,
    }), {
      captured: 0,
      refunded: 0,
      payments: 0,
      refunds: 0,
    })).toEqual({
      captured: 100000,
      refunded: 60000,
      payments: 1,
      refunds: 2,
    });
    expect(rootPartner).toEqual(expect.objectContaining({
      capturedAmount: 100000,
      refundedAmount: 60000,
      netCashAmount: 40000,
      recognizedNetAmount: 0,
      partnerPayableAmount: 0,
    }));
    expect(replacementPartner).toEqual(expect.objectContaining({
      capturedAmount: 0,
      refundedAmount: 0,
      recognizedGrossAmount: 80000,
      recognizedRefundAmount: 40000,
      recognizedNetAmount: 40000,
      partnerPayableAmount: 36000,
    }));
    expect(prisma.payment.findMany.mock.calls[0][0].where.paymentGateway).toEqual({
      not: 'RECOVERY_CREDIT',
    });
    expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        recoveryCaseAsOriginal: { is: null },
      }),
    );
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
      refundRequest: {
        type: 'PARTNER_CANCELLATION',
        reason: 'Rescue fallback',
        targetBookingId: 'booking-target',
        targetBooking: {
          ...bookingForPartner('partner-target'),
          id: 'booking-target',
          fullName: 'Target Customer',
        },
      },
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
        sourceBookingId: booking.id,
        targetBookingId: 'booking-target',
        targetPartner: 'Museum Partner',
        refundType: 'PARTNER_CANCELLATION',
      }),
    ]);
  });
});
