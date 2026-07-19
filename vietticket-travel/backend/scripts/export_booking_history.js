'use strict';

/**
 * Export dataset thực cho ml-service:
 *   node backend/scripts/export_booking_history.js
 *
 * Output: ml-service/data/booking_history.csv
 *
 * Dữ liệu dùng cùng định nghĩa với forecastService:
 * - doanh thu vé thuần theo ngày sử dụng dịch vụ;
 * - COMPLETED/NO_SHOW + payment SUCCESS không trùng;
 * - trừ refund SUCCESS không thuộc hoàn payment trùng;
 * - zero-fill ngày không có doanh thu, bỏ ngày hiện tại chưa chốt.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 365;
const MIN_OBSERVED_DAYS = 14;
const MIN_COMPLETED_BOOKINGS = 30;
const OUTPUT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'ml-service',
  'data',
  'booking_history.csv',
);

function vietnamDateKey(date = new Date()) {
  return new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  return new Date(
    new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS,
  ).toISOString().slice(0, 10);
}

function dateOnly(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function amountOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function derivePriceTier(avgTicketPrice) {
  if (avgTicketPrice < 150000) return 'BUDGET';
  if (avgTicketPrice < 350000) return 'STANDARD';
  if (avgTicketPrice < 700000) return 'PREMIUM';
  return 'LUXURY';
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function recognizedRevenue(booking) {
  const captured = booking.payments.reduce(
    (sum, payment) => sum + amountOf(payment.amount),
    0,
  );
  const refunded = booking.refundTransactions.reduce(
    (sum, transaction) => (
      transaction.refundRequest?.type === 'DUPLICATE_PAYMENT'
        ? sum
        : sum + amountOf(transaction.amount)
    ),
    0,
  );
  return Math.max(0, Math.round(captured - refunded));
}

async function main() {
  const endKey = addDays(vietnamDateKey(), -1);
  const startKey = addDays(endKey, -(LOOKBACK_DAYS - 1));
  const dateRange = {
    gte: dateOnly(startKey),
    lte: dateOnly(endKey),
  };

  const attractions = await prisma.attraction.findMany({
    where: {
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      operationalStatus: 'ACTIVE',
      archivedAt: null,
      partner: { status: 'APPROVED' },
      ticketProducts: { some: { status: 'ACTIVE', archivedAt: null } },
    },
    select: {
      id: true,
      city: true,
      defaultCapacity: true,
      minTicketPrice: true,
      averageRating: true,
      totalReviews: true,
      publishedAt: true,
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        select: { sellingPrice: true },
      },
    },
  });

  if (attractions.length === 0) {
    console.log('Chưa có điểm tham quan đang mở bán để export.');
    return;
  }

  const attractionIds = attractions.map((attraction) => attraction.id);
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ['COMPLETED', 'NO_SHOW'] },
      payments: { some: { status: 'SUCCESS', isDuplicate: false } },
      OR: [
        {
          snapshotAttractionId: { in: attractionIds },
          snapshotVisitDate: dateRange,
        },
        {
          snapshotAttractionId: { in: attractionIds },
          snapshotVisitDate: null,
          reservation: { date: dateRange },
        },
        {
          snapshotAttractionId: null,
          reservation: {
            date: dateRange,
            ticketProduct: { attractionId: { in: attractionIds } },
          },
        },
      ],
    },
    select: {
      snapshotAttractionId: true,
      snapshotVisitDate: true,
      payments: {
        where: { status: 'SUCCESS', isDuplicate: false },
        select: { amount: true },
      },
      refundTransactions: {
        where: { status: 'SUCCESS' },
        select: {
          amount: true,
          refundRequest: { select: { type: true } },
        },
      },
      reservation: {
        select: {
          date: true,
          quantity: true,
          ticketProduct: { select: { attractionId: true } },
        },
      },
    },
  });

  const byAttractionDate = new Map();
  const sampleQuality = new Map();
  for (const booking of bookings) {
    const attractionId = booking.snapshotAttractionId
      || booking.reservation?.ticketProduct?.attractionId;
    const visitDate = booking.snapshotVisitDate || booking.reservation?.date;
    if (!attractionId || !visitDate) continue;

    const date = visitDate.toISOString().slice(0, 10);
    const revenue = recognizedRevenue(booking);
    if (revenue <= 0) continue;

    const key = `${attractionId}|${date}`;
    const current = byAttractionDate.get(key) || {
      revenue: 0,
      tickets: 0,
      bookings: 0,
    };
    current.revenue += revenue;
    current.tickets += Math.max(0, Number(booking.reservation?.quantity || 0));
    current.bookings += 1;
    byAttractionDate.set(key, current);

    const quality = sampleQuality.get(attractionId) || {
      observedDates: new Set(),
      bookings: 0,
    };
    quality.observedDates.add(date);
    quality.bookings += 1;
    sampleQuality.set(attractionId, quality);
  }

  const eligibleAttractions = attractions.filter((attraction) => {
    const quality = sampleQuality.get(attraction.id);
    return quality
      && quality.observedDates.size >= MIN_OBSERVED_DAYS
      && quality.bookings >= MIN_COMPLETED_BOOKINGS;
  });

  const header = [
    'attraction_id',
    'date',
    'tier',
    'city',
    'capacity',
    'avg_ticket_price',
    'rating',
    'num_reviews',
    'published_days_ago',
    'revenue',
    'tickets',
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const attraction of eligibleAttractions) {
    const catalogPrice = median(
      attraction.ticketProducts.map((product) => product.sellingPrice),
    ) || amountOf(attraction.minTicketPrice);
    if (catalogPrice <= 0) continue;

    const publishedAtStart = attraction.publishedAt
      ? Math.max(0, Math.floor(
        (
          dateOnly(startKey).getTime()
          - new Date(attraction.publishedAt).getTime()
        ) / DAY_MS,
      ))
      : 0;

    for (let index = 0; index < LOOKBACK_DAYS; index += 1) {
      const date = addDays(startKey, index);
      const sample = byAttractionDate.get(`${attraction.id}|${date}`)
        || { revenue: 0, tickets: 0 };
      const row = [
        attraction.id,
        date,
        derivePriceTier(catalogPrice),
        attraction.city || 'Khác',
        Math.max(1, Number(attraction.defaultCapacity || 1)),
        Math.round(catalogPrice),
        Number(attraction.averageRating || 0),
        Number(attraction.totalReviews || 0),
        publishedAtStart,
        Math.round(sample.revenue),
        Number(sample.tickets || 0),
      ];
      lines.push(row.map(csvCell).join(','));
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');

  console.log(
    `Đã export ${lines.length - 1} dòng từ ${eligibleAttractions.length} điểm -> ${OUTPUT_PATH}`,
  );
  if (eligibleAttractions.length < 3) {
    console.warn(
      'Chưa đủ 3 điểm đạt ngưỡng dữ liệu; CLI training sẽ từ chối để tránh model overfit.',
    );
  }
}

main()
  .catch((error) => {
    console.error('Export thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
