'use strict';

const prisma = require('../config/prisma');
const {
  buildTimeline,
  getPeriodStart,
  normalizePeriod,
} = require('./analyticsService');

const PAYMENT_STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED']);
const REFUND_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'NEEDS_RECONCILIATION',
]);
const TRANSACTION_TYPES = new Set(['ALL', 'PAYMENT', 'REFUND']);

const bookingTransactionSelect = {
  id: true,
  fullName: true,
  email: true,
  status: true,
  reservation: {
    select: {
      ticketProduct: {
        select: {
          attraction: {
            select: {
              title: true,
              partner: { select: { id: true, businessName: true } },
            },
          },
        },
      },
    },
  },
};

function amountOf(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function roundMoney(value) {
  return Math.round((amountOf(value) + Number.EPSILON) * 100) / 100;
}

function paymentOccurredAt(payment) {
  return payment.paidAt || payment.createdAt;
}

function refundOccurredAt(transaction) {
  return transaction.processedAt || transaction.reconciledAt || transaction.createdAt;
}

function paymentPeriodWhere(startDate) {
  return {
    status: 'SUCCESS',
    OR: [
      { paidAt: { gte: startDate } },
      { paidAt: null, createdAt: { gte: startDate } },
    ],
  };
}

function refundPeriodWhere(startDate) {
  return {
    status: 'SUCCESS',
    OR: [
      { processedAt: { gte: startDate } },
      { processedAt: null, reconciledAt: { gte: startDate } },
      {
        processedAt: null,
        reconciledAt: null,
        createdAt: { gte: startDate },
      },
    ],
  };
}

function buildRecognizedBookingPeriodWhere(startDate, now = new Date()) {
  return {
    OR: [
      {
        status: { in: ['COMPLETED', 'NO_SHOW'] },
        snapshotVisitDate: { gte: startDate, lte: now },
      },
      {
        status: 'REFUNDED',
        refundTransactions: {
          some: {
            ...refundPeriodWhere(startDate),
            refundRequest: {
              is: { type: { not: 'DUPLICATE_PAYMENT' } },
            },
          },
        },
      },
    ],
    payments: { some: { status: 'SUCCESS', isDuplicate: false } },
  };
}

function buildFinancialTimeline(payments, refunds, period, now = new Date()) {
  const normalizedPeriod = normalizePeriod(period);
  const captured = buildTimeline(
    payments.map((payment) => ({
      ...payment,
      createdAt: paymentOccurredAt(payment),
    })),
    normalizedPeriod,
    (payment) => payment.amount,
    now,
  );
  const returned = buildTimeline(
    refunds.map((transaction) => ({
      ...transaction,
      createdAt: refundOccurredAt(transaction),
    })),
    normalizedPeriod,
    (transaction) => transaction.amount,
    now,
  );

  return captured.map((item, index) => {
    const refundedItem = returned[index];
    const capturedAmount = amountOf(item.revenue);
    const refundedAmount = amountOf(refundedItem?.revenue);

    return {
      label: item.label,
      capturedAmount,
      refundedAmount,
      netCashAmount: capturedAmount - refundedAmount,
      paymentCount: item.bookings,
      refundCount: refundedItem?.bookings || 0,
      // Compatibility for the existing dashboard chart/export.
      revenue: capturedAmount - refundedAmount,
      bookings: item.bookings,
    };
  });
}

function partnerFromBooking(booking) {
  return booking?.reservation?.ticketProduct?.attraction?.partner || null;
}

function createPartnerMetrics(partner) {
  return {
    id: partner.id,
    businessName: partner.businessName,
    status: partner.status,
    commissionRate: amountOf(partner.commissionRate),
    commissionRatePercent: amountOf(partner.commissionRate) * 100,
    capturedAmount: 0,
    duplicateCapturedAmount: 0,
    refundedAmount: 0,
    netCashAmount: 0,
    recognizedGrossAmount: 0,
    recognizedRefundAmount: 0,
    recognizedNetAmount: 0,
    commissionRevenueAmount: 0,
    partnerPayableAmount: 0,
  };
}

function recognizedAmountsOf(booking) {
  const grossAmount = (booking.payments || []).reduce(
    (sum, payment) => sum + amountOf(payment.amount),
    0,
  );
  const refundAmount = (booking.refundTransactions || []).reduce(
    (sum, transaction) => (
      transaction.refundRequest?.type === 'DUPLICATE_PAYMENT'
        ? sum
        : sum + amountOf(transaction.amount)
    ),
    0,
  );
  const netAmount = Math.max(0, grossAmount - refundAmount);

  if (refundAmount === 0) {
    return {
      grossAmount,
      refundAmount: 0,
      netAmount: grossAmount,
      commissionAmount: amountOf(booking.commissionAmountSnapshot),
      partnerPayableAmount: amountOf(booking.partnerNetAmountSnapshot),
    };
  }

  const commissionRate = Math.min(
    Math.max(amountOf(booking.commissionRateSnapshot), 0),
    1,
  );
  const commissionAmount = roundMoney(netAmount * commissionRate);
  return {
    grossAmount,
    refundAmount: Math.min(refundAmount, grossAmount),
    netAmount,
    commissionAmount,
    partnerPayableAmount: roundMoney(netAmount - commissionAmount),
  };
}

function recognizedAtOf(booking) {
  if (booking.status === 'REFUNDED') {
    const refund = (booking.refundTransactions || [])
      .filter((transaction) => transaction.refundRequest?.type !== 'DUPLICATE_PAYMENT')
      .sort((left, right) => (
        new Date(refundOccurredAt(right)).getTime()
        - new Date(refundOccurredAt(left)).getTime()
      ))[0];
    if (refund) return refundOccurredAt(refund);
  }

  return booking.snapshotVisitDate || booking.reservation?.date || booking.createdAt;
}

function summarizeFinancialRows({ payments, refunds, recognizedBookings }) {
  const capturedAmount = payments.reduce(
    (sum, payment) => sum + amountOf(payment.amount),
    0,
  );
  const salesCapturedAmount = payments.reduce(
    (sum, payment) => sum + (payment.isDuplicate ? 0 : amountOf(payment.amount)),
    0,
  );
  const duplicateCapturedAmount = capturedAmount - salesCapturedAmount;
  const refundedAmount = refunds.reduce(
    (sum, transaction) => sum + amountOf(transaction.amount),
    0,
  );

  let recognizedGrossAmount = 0;
  let recognizedRefundAmount = 0;
  let recognizedNetAmount = 0;
  let commissionRevenueAmount = 0;
  let partnerPayableAmount = 0;
  for (const booking of recognizedBookings) {
    const recognized = recognizedAmountsOf(booking);
    recognizedGrossAmount += recognized.grossAmount;
    recognizedRefundAmount += recognized.refundAmount;
    recognizedNetAmount += recognized.netAmount;
    commissionRevenueAmount += recognized.commissionAmount;
    partnerPayableAmount += recognized.partnerPayableAmount;
  }

  return {
    capturedAmount,
    salesCapturedAmount,
    duplicateCapturedAmount,
    refundedAmount,
    netCashAmount: capturedAmount - refundedAmount,
    recognizedGrossAmount,
    recognizedRefundAmount,
    recognizedNetAmount,
    commissionRevenueAmount,
    partnerPayableAmount,
    successfulPaymentCount: payments.length,
    successfulRefundCount: refunds.length,
  };
}

function buildPartnerBreakdown(partners, payments, refunds, recognizedBookings) {
  const byPartner = new Map(
    partners.map((partner) => [partner.id, createPartnerMetrics(partner)]),
  );

  for (const payment of payments) {
    const partner = partnerFromBooking(payment.booking);
    if (!partner || !byPartner.has(partner.id)) continue;
    const metrics = byPartner.get(partner.id);
    const amount = amountOf(payment.amount);
    if (payment.isDuplicate) metrics.duplicateCapturedAmount += amount;
    else metrics.capturedAmount += amount;
  }

  for (const refund of refunds) {
    const partner = partnerFromBooking(refund.booking);
    if (!partner || !byPartner.has(partner.id)) continue;
    byPartner.get(partner.id).refundedAmount += amountOf(refund.amount);
  }

  for (const booking of recognizedBookings) {
    const partner = partnerFromBooking(booking);
    if (!partner || !byPartner.has(partner.id)) continue;
    const metrics = byPartner.get(partner.id);
    const recognized = recognizedAmountsOf(booking);
    metrics.recognizedGrossAmount += recognized.grossAmount;
    metrics.recognizedRefundAmount += recognized.refundAmount;
    metrics.recognizedNetAmount += recognized.netAmount;
    metrics.commissionRevenueAmount += recognized.commissionAmount;
    metrics.partnerPayableAmount += recognized.partnerPayableAmount;
  }

  return [...byPartner.values()]
    .map((metrics) => ({
      ...metrics,
      netCashAmount:
        metrics.capturedAmount
        + metrics.duplicateCapturedAmount
        - metrics.refundedAmount,
    }))
    .sort((left, right) => (
      right.recognizedNetAmount - left.recognizedNetAmount
      || left.businessName.localeCompare(right.businessName, 'vi')
    ));
}

async function getPlatformFinancialReport(period) {
  const normalizedPeriod = normalizePeriod(period);
  const startDate = getPeriodStart(normalizedPeriod);
  const [
    payments,
    refunds,
    recognizedBookings,
    partners,
    openRefunds,
    reconciliation,
  ] = await Promise.all([
    prisma.payment.findMany({
      where: paymentPeriodWhere(startDate),
      select: {
        amount: true,
        isDuplicate: true,
        paidAt: true,
        createdAt: true,
        booking: { select: bookingTransactionSelect },
      },
    }),
    prisma.refundTransaction.findMany({
      where: refundPeriodWhere(startDate),
      select: {
        amount: true,
        processedAt: true,
        reconciledAt: true,
        createdAt: true,
        booking: { select: bookingTransactionSelect },
      },
    }),
    prisma.booking.findMany({
      where: buildRecognizedBookingPeriodWhere(startDate),
      select: {
        status: true,
        commissionRateSnapshot: true,
        commissionAmountSnapshot: true,
        partnerNetAmountSnapshot: true,
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: { amount: true },
        },
        refundTransactions: {
          where: { status: 'SUCCESS' },
          select: {
            amount: true,
            processedAt: true,
            reconciledAt: true,
            createdAt: true,
            refundRequest: { select: { type: true } },
          },
        },
        reservation: {
          select: {
            ticketProduct: {
              select: {
                attraction: {
                  select: {
                    partner: { select: { id: true, businessName: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.partnerProfile.findMany({
      orderBy: { businessName: 'asc' },
      select: {
        id: true,
        businessName: true,
        status: true,
        commissionRate: true,
      },
    }),
    prisma.refundRequest.aggregate({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'APPROVED'] },
        refundTransactions: { none: { status: 'SUCCESS' } },
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.refundTransaction.aggregate({
      where: { status: 'NEEDS_RECONCILIATION' },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const summary = summarizeFinancialRows({
    payments,
    refunds,
    recognizedBookings,
  });

  return {
    period: normalizedPeriod,
    startDate,
    summary: {
      ...summary,
      openRefundCount: openRefunds._count._all,
      openRefundAmount: amountOf(openRefunds._sum.amount),
      needsReconciliationCount: reconciliation._count._all,
      needsReconciliationAmount: amountOf(reconciliation._sum.amount),
    },
    timeline: buildFinancialTimeline(payments, refunds, normalizedPeriod),
    partners: buildPartnerBreakdown(
      partners,
      payments,
      refunds,
      recognizedBookings,
    ),
  };
}

function transactionPeriodFilter(type, startDate) {
  if (type === 'PAYMENT') {
    return {
      OR: [
        { createdAt: { gte: startDate } },
        { paidAt: { gte: startDate } },
      ],
    };
  }

  return {
    OR: [
      { createdAt: { gte: startDate } },
      { processedAt: { gte: startDate } },
      { reconciledAt: { gte: startDate } },
    ],
  };
}

function transactionSearchFilter(type, search) {
  if (!search) return null;
  const contains = { contains: search, mode: 'insensitive' };
  const common = [
    { bookingId: contains },
    { booking: { fullName: contains } },
    { booking: { email: contains } },
    {
      booking: {
        reservation: {
          ticketProduct: { attraction: { title: contains } },
        },
      },
    },
  ];

  return {
    OR: type === 'PAYMENT'
      ? [{ transactionId: contains }, ...common]
      : [
          { gatewayRequestId: contains },
          { gatewayTransactionId: contains },
          ...common,
        ],
  };
}

function mapPaymentTransaction(payment) {
  const attraction = payment.booking?.reservation?.ticketProduct?.attraction;
  return {
    id: payment.id,
    type: 'PAYMENT',
    bookingId: payment.bookingId,
    reference: payment.transactionId || payment.id,
    gateway: payment.paymentGateway,
    amount: amountOf(payment.amount),
    status: payment.status,
    occurredAt: paymentOccurredAt(payment),
    isDuplicate: payment.isDuplicate,
    customer: payment.booking?.fullName || '',
    customerEmail: payment.booking?.email || '',
    bookingStatus: payment.booking?.status || null,
    attraction: attraction?.title || '',
    partner: attraction?.partner?.businessName || '',
  };
}

function mapRefundTransaction(transaction) {
  const attraction = transaction.booking?.reservation?.ticketProduct?.attraction;
  return {
    id: transaction.id,
    type: 'REFUND',
    bookingId: transaction.bookingId,
    reference:
      transaction.gatewayTransactionId
      || transaction.gatewayRequestId
      || transaction.id,
    gateway: transaction.gateway,
    amount: amountOf(transaction.amount),
    status: transaction.status,
    occurredAt: refundOccurredAt(transaction),
    isDuplicate: false,
    customer: transaction.booking?.fullName || '',
    customerEmail: transaction.booking?.email || '',
    bookingStatus: transaction.booking?.status || null,
    attraction: attraction?.title || '',
    partner: attraction?.partner?.businessName || '',
  };
}

async function listPlatformFinancialTransactions({
  period,
  type = 'ALL',
  status = '',
  search = '',
  limit = 50,
}) {
  const normalizedPeriod = normalizePeriod(period);
  const normalizedType = TRANSACTION_TYPES.has(type) ? type : 'ALL';
  const normalizedSearch = String(search || '').trim();
  const startDate = getPeriodStart(normalizedPeriod);
  const take = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const includePayments = normalizedType !== 'REFUND'
    && (!status || PAYMENT_STATUSES.has(status));
  const includeRefunds = normalizedType !== 'PAYMENT'
    && (!status || REFUND_STATUSES.has(status));

  const paymentFilters = [transactionPeriodFilter('PAYMENT', startDate)];
  const paymentSearch = transactionSearchFilter('PAYMENT', normalizedSearch);
  if (paymentSearch) paymentFilters.push(paymentSearch);

  const refundFilters = [transactionPeriodFilter('REFUND', startDate)];
  const refundSearch = transactionSearchFilter('REFUND', normalizedSearch);
  if (refundSearch) refundFilters.push(refundSearch);

  const [payments, refunds] = await Promise.all([
    includePayments
      ? prisma.payment.findMany({
          where: {
            AND: paymentFilters,
            ...(status ? { status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            bookingId: true,
            amount: true,
            paymentGateway: true,
            transactionId: true,
            status: true,
            paidAt: true,
            isDuplicate: true,
            createdAt: true,
            booking: { select: bookingTransactionSelect },
          },
        })
      : Promise.resolve([]),
    includeRefunds
      ? prisma.refundTransaction.findMany({
          where: {
            AND: refundFilters,
            ...(status ? { status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            bookingId: true,
            amount: true,
            gateway: true,
            gatewayRequestId: true,
            gatewayTransactionId: true,
            status: true,
            processedAt: true,
            reconciledAt: true,
            createdAt: true,
            booking: { select: bookingTransactionSelect },
          },
        })
      : Promise.resolve([]),
  ]);

  const transactions = [
    ...payments.map(mapPaymentTransaction),
    ...refunds.map(mapRefundTransaction),
  ]
    .sort((left, right) => (
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
    ))
    .slice(0, take);

  return {
    period: normalizedPeriod,
    type: normalizedType,
    status: status || '',
    search: normalizedSearch,
    limit: take,
    hasMore: payments.length === take || refunds.length === take,
    transactions,
  };
}

module.exports = {
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  TRANSACTION_TYPES,
  buildRecognizedBookingPeriodWhere,
  buildFinancialTimeline,
  buildPartnerBreakdown,
  getPlatformFinancialReport,
  listPlatformFinancialTransactions,
  summarizeFinancialRows,
  recognizedAmountsOf,
  recognizedAtOf,
};
