'use strict';

// ============================================================
// export_booking_history.js
// ------------------------------------------------------------
// Xuất doanh thu thực tế theo (attractionId, ngày) ra CSV để train.py train
// lại model bằng dữ liệu THẬT thay vì synthetic. Chạy từ root project:
//
//   node backend/scripts/export_booking_history.js
//
// Output: ml-service/data/booking_history.csv (cùng schema cột với
// data_gen.py để train.py dùng chung 1 pipeline feature engineering)
//
// LƯU Ý: chỉ nên chạy khi đã có đủ lịch sử thật (khuyến nghị > 90 ngày/
// attraction, càng nhiều attraction có dữ liệu càng tốt). Nếu dữ liệu còn
// quá ít, tiếp tục dùng model train từ synthetic data cho tới khi đủ.
// ============================================================

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const CONFIRMED_STATUSES = ['CONFIRMED', 'COMPLETED'];
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'ml-service', 'data', 'booking_history.csv');

function isHoliday(date) {
  const mmdd = date.toISOString().slice(5, 10);
  return ['01-01', '04-30', '05-01', '09-02'].includes(mmdd);
}

async function main() {
  const attractions = await prisma.attraction.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      city: true,
      tier: true,
      defaultCapacity: true,
      minTicketPrice: true,
      averageRating: true,
      totalReviews: true,
    },
  });

  if (attractions.length === 0) {
    console.log('Chưa có attraction nào — dừng export.');
    return;
  }

  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: CONFIRMED_STATUSES },
      snapshotAttractionId: { not: null },
      snapshotVisitDate: { not: null },
    },
    select: { snapshotAttractionId: true, snapshotVisitDate: true, totalAmount: true },
  });

  // Gom theo (attractionId, ngày)
  const byKey = new Map(); // key = attractionId|YYYY-MM-DD -> { revenue, bookings }
  for (const b of bookings) {
    const dateStr = b.snapshotVisitDate.toISOString().slice(0, 10);
    const key = `${b.snapshotAttractionId}|${dateStr}`;
    const prev = byKey.get(key) || { revenue: 0, bookings: 0 };
    prev.revenue += Number(b.totalAmount);
    prev.bookings += 1;
    byKey.set(key, prev);
  }

  const attractionById = new Map(attractions.map((a) => [a.id, a]));

  const header = [
    'attractionId', 'date', 'city', 'tier', 'default_capacity', 'min_ticket_price',
    'avg_rating', 'review_count', 'day_of_week', 'is_weekend', 'is_holiday',
    'day_of_year', 'month', 'bookings', 'revenue',
  ];
  const lines = [header.join(',')];

  for (const [key, agg] of byKey.entries()) {
    const [attractionId, dateStr] = key.split('|');
    const attraction = attractionById.get(attractionId);
    if (!attraction) continue; // attraction đã bị archive/xóa

    const date = new Date(dateStr);
    const row = [
      attractionId,
      dateStr,
      attraction.city || 'other',
      attraction.tier || 'STANDARD',
      attraction.defaultCapacity,
      attraction.minTicketPrice ? Number(attraction.minTicketPrice) : 0,
      attraction.averageRating || 0,
      attraction.totalReviews || 0,
      date.getUTCDay(),
      date.getUTCDay() >= 5 ? 1 : 0,
      isHoliday(date) ? 1 : 0,
      Math.ceil((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 0))) / 86400000),
      date.getUTCMonth() + 1,
      agg.bookings,
      Math.round(agg.revenue),
    ];
    lines.push(row.join(','));
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf-8');

  console.log(`Đã xuất ${lines.length - 1} dòng (attraction x ngày có booking) -> ${OUTPUT_PATH}`);
  if (lines.length - 1 < 500) {
    console.log('[LƯU Ý] Dữ liệu còn khá ít (< 500 dòng). Cân nhắc trộn thêm với '
      + 'synthetic data (data_gen.py) hoặc đợi thêm booking thật trước khi retrain '
      + 'để tránh model overfit vào một số ít attraction có nhiều đơn.');
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
