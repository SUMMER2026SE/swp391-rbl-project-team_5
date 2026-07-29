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
const RECOVERY_CREDIT_GATEWAY = 'RECOVERY_CREDIT';

const bookingTransactionSelect = {
  id: true,
  snapshotPartnerId: true,
  snapshotPartnerName: true,
  snapshotAttractionId: true,
  snapshotAttractionTitle: true,
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
  // VND is accounted as an integer throughout checkout/refund. Recomputed
  // commission after a partial refund must follow the same half-up rule and
  // never reintroduce fractional đồng in financial reports.
  return Math.round(amountOf(value));
}

function paymentOccurredAt(payment) {
  return payment.paidAt || payment.createdAt;
}

function refundOccurredAt(transaction) {
  return transaction.processedAt || transaction.reconciledAt || transaction.createdAt;
}

function isCashPayment(payment) {
  return String(payment?.paymentGateway || '').trim().toUpperCase()
    !== RECOVERY_CREDIT_GATEWAY;
}

function paymentPeriodWhere(startDate) {
  return {
    status: 'SUCCESS',
    paymentGateway: { not: RECOVERY_CREDIT_GATEWAY },
    booking: { isForecastTrainingSample: false },
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
    isForecastTrainingSample: false,
    // A provider/system-cancelled booking that has entered Rescue no longer
    // represents a delivered service. Its captured gateway payment remains in
    // the cash ledger, but its value is recognized only by the eventual
    // replacement booking (if any).
    recoveryCaseAsOriginal: { is: null },
    OR: [
      {
        status: { in: ['COMPLETED', 'NO_SHOW'] },
        snapshotVisitDate: { gte: startDate, lte: now },
      },
      {
        status: 'REFUNDED',
        OR: [
          {
            refundTransactions: {
              some: {
                ...refundPeriodWhere(startDate),
                refundRequest: {
                  is: { type: { not: 'DUPLICATE_PAYMENT' } },
                },
              },
            },
          },
          {
            // A Rescue-funded cancellation refunds the original gateway
            // payment. The transaction therefore belongs to the funding
            // booking, while targetBookingId identifies the booking whose
            // recognized revenue must be reduced.
            refundRequestsTargeting: {
              some: {
                type: { not: 'DUPLICATE_PAYMENT' },
                refundTransactions: {
                  some: refundPeriodWhere(startDate),
                },
              },
            },
          },
        ],
      },
    ],
    payments: { some: { status: 'SUCCESS', isDuplicate: false } },
  };
}

function buildFinancialTimeline(payments, refunds, period, now = new Date()) {
  const normalizedPeriod = normalizePeriod(period);
  const cashPayments = payments.filter(isCashPayment);
  const captured = buildTimeline(
    cashPayments.map((payment) => ({
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
  const relation = booking?.reservation?.ticketProduct?.attraction?.partner || null;
  if (booking?.snapshotPartnerId) {
    return {
      id: booking.snapshotPartnerId,
      businessName: booking.snapshotPartnerName || relation?.businessName || 'Đối tác lịch sử',
      status: relation?.status || 'HISTORICAL',
      commissionRate: relation?.commissionRate || 0,
    };
  }
  return relation;
}

// Mọi cột tiền của một dòng đối tác. Liệt kê tường minh thay vì quét động để
// một cột tiền mới được thêm sau này không lặng lẽ lọt khỏi phép kiểm tra.
const PARTNER_ACTIVITY_FIELDS = Object.freeze([
  'capturedAmount',
  'duplicateCapturedAmount',
  'refundedAmount',
  'recognizedGrossAmount',
  'recognizedRefundAmount',
  'recognizedNetAmount',
  'commissionRevenueAmount',
  'platformPromotionCostAmount',
  'platformNetRevenueAmount',
  'partnerPayableAmount',
]);

function hasPartnerActivity(metrics) {
  return PARTNER_ACTIVITY_FIELDS.some((field) => Number(metrics?.[field] || 0) !== 0);
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
    platformPromotionCostAmount: 0,
    platformNetRevenueAmount: 0,
    partnerPayableAmount: 0,
  };
}

function recognizedRefundTransactionsOf(booking) {
  const transactions = [];
  const seenIds = new Set();
  const seenObjects = new Set();

  const addTransaction = (transaction, requestType = null) => {
    if (!transaction) return;
    if (transaction.status && transaction.status !== 'SUCCESS') return;

    if (transaction.id) {
      if (seenIds.has(transaction.id)) return;
      seenIds.add(transaction.id);
    } else {
      // Prisma rows always have an id. Object identity keeps this helper safe
      // for lightweight callers/tests that omit it.
      if (seenObjects.has(transaction)) return;
      seenObjects.add(transaction);
    }

    const type = transaction.refundRequest?.type || requestType;
    if (type === 'DUPLICATE_PAYMENT') return;
    transactions.push({
      ...transaction,
      refundRequest: type ? { type } : transaction.refundRequest,
    });
  };

  for (const transaction of booking?.refundTransactions || []) {
    addTransaction(transaction);
  }
  for (const refundRequest of booking?.refundRequestsTargeting || []) {
    for (const transaction of refundRequest.refundTransactions || []) {
      addTransaction(transaction, refundRequest.type);
    }
  }

  return transactions;
}

function recognizedAmountsOf(booking) {
  if (booking?.recoveryCaseAsOriginal) {
    return {
      grossAmount: 0,
      refundAmount: 0,
      netAmount: 0,
      commissionAmount: 0,
      platformPromotionCostAmount: 0,
      platformNetRevenueAmount: 0,
      partnerPayableAmount: 0,
    };
  }

  const grossAmount = (booking.payments || []).reduce(
    (sum, payment) => sum + amountOf(payment.amount),
    0,
  );
  const refundAmount = recognizedRefundTransactionsOf(booking).reduce(
    (sum, transaction) => sum + amountOf(transaction.amount),
    0,
  );
  const netAmount = Math.max(0, grossAmount - refundAmount);
  const commissionRate = Math.min(
    Math.max(amountOf(booking.commissionRateSnapshot), 0),
    1,
  );
  const hasAllocationSnapshot = (
    booking.commissionAmountSnapshot !== null
    && booking.commissionAmountSnapshot !== undefined
    && booking.partnerNetAmountSnapshot !== null
    && booking.partnerNetAmountSnapshot !== undefined
  );
  const bookedCommissionAmount = hasAllocationSnapshot
    ? amountOf(booking.commissionAmountSnapshot)
    : roundMoney(grossAmount * commissionRate);
  const bookedPartnerPayableAmount = hasAllocationSnapshot
    ? amountOf(booking.partnerNetAmountSnapshot)
    : roundMoney(grossAmount - bookedCommissionAmount);
  const hasPlatformPromotionSnapshot = (
    booking.platformDiscountAmountSnapshot !== null
    && booking.platformDiscountAmountSnapshot !== undefined
  );
  const bookedPlatformPromotionCost = amountOf(
    booking.platformDiscountAmountSnapshot,
  );

  // Refunds reduce each immutable booking allocation by the same retained-cash
  // ratio. Partner payable is then derived as the balancing figure so the
  // accounting identity remains exact to the đồng after rounding:
  // customer cash + platform promotion = commission + partner payable.
  const retainedRatio = grossAmount > 0 ? netAmount / grossAmount : 0;
  const commissionAmount = roundMoney(bookedCommissionAmount * retainedRatio);
  const platformPromotionCostAmount = roundMoney(
    bookedPlatformPromotionCost * retainedRatio,
  );
  const partnerPayableAmount = hasPlatformPromotionSnapshot
    ? Math.max(
        0,
        netAmount + platformPromotionCostAmount - commissionAmount,
      )
    : roundMoney(bookedPartnerPayableAmount * retainedRatio);

  return {
    grossAmount,
    refundAmount: Math.min(refundAmount, grossAmount),
    netAmount,
    commissionAmount,
    platformPromotionCostAmount,
    platformNetRevenueAmount:
      commissionAmount - platformPromotionCostAmount,
    partnerPayableAmount,
  };
}

function recognizedAtOf(booking) {
  if (booking.status === 'REFUNDED') {
    const refund = recognizedRefundTransactionsOf(booking)
      .sort((left, right) => (
        new Date(refundOccurredAt(right)).getTime()
        - new Date(refundOccurredAt(left)).getTime()
      ))[0];
    if (refund) return refundOccurredAt(refund);
  }

  return booking.snapshotVisitDate || booking.reservation?.date || booking.createdAt;
}

function summarizeFinancialRows({ payments, refunds, recognizedBookings }) {
  const cashPayments = payments.filter(isCashPayment);
  const capturedAmount = cashPayments.reduce(
    (sum, payment) => sum + amountOf(payment.amount),
    0,
  );
  const salesCapturedAmount = cashPayments.reduce(
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
  let platformPromotionCostAmount = 0;
  let platformNetRevenueAmount = 0;
  let partnerPayableAmount = 0;
  for (const booking of recognizedBookings) {
    const recognized = recognizedAmountsOf(booking);
    recognizedGrossAmount += recognized.grossAmount;
    recognizedRefundAmount += recognized.refundAmount;
    recognizedNetAmount += recognized.netAmount;
    commissionRevenueAmount += recognized.commissionAmount;
    platformPromotionCostAmount += recognized.platformPromotionCostAmount;
    platformNetRevenueAmount += recognized.platformNetRevenueAmount;
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
    platformPromotionCostAmount,
    platformNetRevenueAmount,
    partnerPayableAmount,
    successfulPaymentCount: cashPayments.length,
    successfulRefundCount: refunds.length,
  };
}

function buildPartnerBreakdown(partners, payments, refunds, recognizedBookings) {
  const byPartner = new Map(
    partners.map((partner) => [partner.id, createPartnerMetrics(partner)]),
  );

  for (const payment of payments.filter(isCashPayment)) {
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
    metrics.platformPromotionCostAmount += recognized.platformPromotionCostAmount;
    metrics.platformNetRevenueAmount += recognized.platformNetRevenueAmount;
    metrics.partnerPayableAmount += recognized.partnerPayableAmount;
  }

  return [...byPartner.values()]
    // Mọi hồ sơ đối tác đều được nạp để đơn cũ của đối tác đã bị đình chỉ vẫn
    // quy được về đúng chủ. Nhưng chỉ những đối tác có phát sinh trong kỳ mới
    // được lên bảng — nếu không, báo cáo tài chính sẽ bị độn thêm mọi hồ sơ
    // chờ duyệt / bị từ chối dưới dạng dòng toàn số 0. Dòng 0 không đóng góp
    // gì vào tổng nên bỏ đi không làm lệch đối soát.
    .filter((metrics) => hasPartnerActivity(metrics))
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
        paymentGateway: true,
        paidAt: true,
        createdAt: true,
        booking: { select: bookingTransactionSelect },
      },
    }),
    prisma.refundTransaction.findMany({
      where: {
        ...refundPeriodWhere(startDate),
        booking: { isForecastTrainingSample: false },
      },
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
        snapshotPartnerId: true,
        snapshotPartnerName: true,
        status: true,
        recoveryCaseAsOriginal: { select: { id: true, status: true } },
        commissionRateSnapshot: true,
        commissionAmountSnapshot: true,
        partnerNetAmountSnapshot: true,
        platformDiscountAmountSnapshot: true,
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: { amount: true },
        },
        refundTransactions: {
          where: { status: 'SUCCESS' },
          select: {
            id: true,
            amount: true,
            status: true,
            processedAt: true,
            reconciledAt: true,
            createdAt: true,
            refundRequest: { select: { type: true } },
          },
        },
        refundRequestsTargeting: {
          where: {
            refundTransactions: { some: { status: 'SUCCESS' } },
          },
          select: {
            type: true,
            refundTransactions: {
              where: { status: 'SUCCESS' },
              select: {
                id: true,
                amount: true,
                status: true,
                processedAt: true,
                reconciledAt: true,
                createdAt: true,
              },
            },
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
      // Historical payments/refunds remain financially attributable after a
      // partner is suspended or rejected. Including every profile keeps the
      // partner table reconcilable with the platform-wide cash totals.
      where: {},
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
        booking: { isForecastTrainingSample: false },
        refundTransactions: { none: { status: 'SUCCESS' } },
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    // Count unresolved requests, not raw attempts. A request may have several
    // failed attempts and must disappear from this KPI once any attempt succeeds.
    prisma.refundRequest.aggregate({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        booking: { isForecastTrainingSample: false },
        refundTransactions: {
          some: { status: { in: ['FAILED', 'NEEDS_RECONCILIATION'] } },
          none: { status: 'SUCCESS' },
        },
      },
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
  const booking = payment.booking;
  const attraction = booking?.reservation?.ticketProduct?.attraction;
  const partner = partnerFromBooking(booking);
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
    customer: booking?.fullName || '',
    customerEmail: booking?.email || '',
    bookingStatus: booking?.status || null,
    attraction: booking?.snapshotAttractionTitle || attraction?.title || '',
    partner: partner?.businessName || attraction?.partner?.businessName || '',
  };
}

function mapRefundTransaction(transaction) {
  const sourceBooking = transaction.booking;
  const targetBooking = transaction.refundRequest?.targetBooking || null;
  const attraction = sourceBooking?.reservation?.ticketProduct?.attraction;
  const targetAttraction = targetBooking?.reservation?.ticketProduct?.attraction;
  const sourcePartner = partnerFromBooking(sourceBooking);
  const targetPartner = partnerFromBooking(targetBooking);
  const targetBookingId = targetBooking?.id
    || transaction.refundRequest?.targetBookingId
    || null;
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
    attraction: sourceBooking?.snapshotAttractionTitle || attraction?.title || '',
    partner: sourcePartner?.businessName || attraction?.partner?.businessName || '',
    // Refund cash is charged to the source/funding booking, while the
    // customer-facing booking may be a Rescue target. Expose both identities
    // so staff do not reconcile a chain refund against the wrong partner.
    sourceBookingId: transaction.bookingId,
    targetBookingId,
    targetCustomer: targetBooking?.fullName || '',
    targetCustomerEmail: targetBooking?.email || '',
    targetBookingStatus: targetBooking?.status || null,
    targetAttraction: targetBooking?.snapshotAttractionTitle
      || targetAttraction?.title
      || '',
    targetPartner: targetPartner?.businessName
      || targetAttraction?.partner?.businessName
      || '',
    refundType: transaction.refundRequest?.type || null,
    refundReason: transaction.refundRequest?.reason || transaction.reason || null,
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
            booking: { isForecastTrainingSample: false },
            // RECOVERY_CREDIT is an internal ledger transfer, not a second
            // cash capture. Keep it out of the cash transaction history so
            // operators cannot mistake a Rescue replacement for revenue.
            paymentGateway: { not: RECOVERY_CREDIT_GATEWAY },
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
            booking: { isForecastTrainingSample: false },
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
            reason: true,
            status: true,
            processedAt: true,
            reconciledAt: true,
            createdAt: true,
            booking: { select: bookingTransactionSelect },
            refundRequest: {
              select: {
                type: true,
                reason: true,
                targetBookingId: true,
                targetBooking: { select: bookingTransactionSelect },
              },
            },
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
  recognizedRefundTransactionsOf,
};
