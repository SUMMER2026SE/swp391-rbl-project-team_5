'use strict';

/**
 * Sinh dataset huấn luyện của bộ demo mà KHÔNG cần kết nối cơ sở dữ liệu:
 *
 *   node backend/scripts/export_demo_training_csv.js
 *
 * Output: ml-service/data/demo_booking_history.csv
 *
 * Vì sao có script này bên cạnh export_booking_history.js:
 *
 * - `export_booking_history.js` là đường xuất dữ liệu THẬT cho production. Nó
 *   cố tình loại các booking `isForecastTrainingSample=true`, nên không bao
 *   giờ xuất được lịch sử của bộ demo — và điều đó là đúng.
 * - Nhưng lịch sử demo lại do một mô hình nhu cầu xác định hoàn toàn
 *   (`lib/demandHistoryModel.js`), cùng hàm mà seed dùng để ghi vào CSDL. Gọi
 *   thẳng hàm đó thì sinh lại được đúng dataset ấy, không cần dựng CSDL, và
 *   quan trọng hơn: không thể lệch khỏi dữ liệu đang chạy.
 *
 * Model huấn luyện từ file này PHẢI được gắn nhãn `demo_booking_history`.
 * Backend chỉ chấp nhận nhãn đó khi ALLOW_DEMO_AI=true và luôn kèm cảnh báo.
 */

const fs = require('fs');
const path = require('path');

const { planDayDemand, seededGenerator } = require('./lib/demandHistoryModel');
const {
  HISTORY_DAYS,
  IDS,
  addDateKeyDays,
  historyDemandProfiles,
  vietnamDateKey,
} = require('./seed_defense_demo');

const OUTPUT_PATH = path.join(
  __dirname, '..', '..', 'ml-service', 'data', 'demo_booking_history.csv',
);

// Phải khớp chính xác với catalog mà seed tạo ra, vì backend gửi đúng các con
// số này cho ml-service lúc suy luận. Lệch ở đây là lệch train-serving.
const CATALOG = [
  {
    attractionId: IDS.attractions.museum,
    city: 'Hồ Chí Minh',
    capacity: 180,
    rating: 5,
    numReviews: 1,
    tickets: [
      { id: IDS.tickets.museumAdult, sellingPrice: 30000, share: 0.6 },
      { id: IDS.tickets.museumStudent, sellingPrice: 15000, share: 0.25 },
      { id: IDS.tickets.museumChild, sellingPrice: 15000, share: 0.15 },
    ],
    slots: [{ id: `${IDS.attractions.museum}-slot-all-day`, capacity: 180 }],
  },
  {
    attractionId: IDS.attractions.cruise,
    city: 'Hồ Chí Minh',
    capacity: 90,
    rating: 4.2,
    numReviews: 5,
    tickets: [
      { id: IDS.tickets.cruiseAdult, sellingPrice: 280000, share: 1 },
      { id: IDS.tickets.cruiseFamily, sellingPrice: 920000, share: 0 },
    ],
    slots: [
      { id: `${IDS.attractions.cruise}-slot-1`, capacity: 45 },
      { id: `${IDS.attractions.cruise}-slot-2`, capacity: 45 },
    ],
  },
  {
    attractionId: IDS.attractions.eco,
    city: 'Hồ Chí Minh',
    capacity: 120,
    rating: 0,
    numReviews: 0,
    tickets: [
      { id: IDS.tickets.ecoAdult, sellingPrice: 520000, share: 0.72 },
      { id: IDS.tickets.ecoChild, sellingPrice: 360000, share: 0.28 },
    ],
    slots: [{ id: `${IDS.attractions.eco}-slot-all-day`, capacity: 120 }],
  },
];

// Cùng công thức với forecastService.derivePriceTier để hai bên không hiểu
// khác nhau về hạng giá của một điểm.
function derivePriceTier(avgTicketPrice) {
  if (avgTicketPrice < 150000) return 'BUDGET';
  if (avgTicketPrice < 350000) return 'STANDARD';
  if (avgTicketPrice < 700000) return 'PREMIUM';
  return 'LUXURY';
}

// Backend gửi trung vị giá của các gói vé ACTIVE làm avg_ticket_price.
function medianPrice(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function main() {
  const profiles = historyDemandProfiles();
  const endKey = addDateKeyDays(vietnamDateKey(), -1);
  const startKey = addDateKeyDays(endKey, -(HISTORY_DAYS - 1));

  const header = [
    'attraction_id', 'date', 'tier', 'city', 'capacity',
    'avg_ticket_price', 'rating', 'num_reviews', 'revenue', 'tickets',
  ];
  const lines = [header.map(csvCell).join(',')];
  let totalRevenue = 0;
  let totalTickets = 0;

  for (const entry of CATALOG) {
    const profile = profiles.get(entry.attractionId);
    if (!profile) throw new Error(`Thiếu hồ sơ nhu cầu cho ${entry.attractionId}`);

    const ticketById = new Map(entry.tickets.map((ticket) => [ticket.id, ticket]));
    const productChoices = profile.products.map((product) => ({
      ...product,
      ticket: ticketById.get(product.id),
    }));
    const slots = profile.slots.map((slot) => ({
      ...slot,
      capacity: entry.slots.find((item) => item.id === slot.id)?.capacity || entry.capacity,
    }));
    const avgTicketPrice = medianPrice(entry.tickets.map((ticket) => ticket.sellingPrice));

    for (let dayIndex = 0; dayIndex < HISTORY_DAYS; dayIndex += 1) {
      const dateKey = addDateKeyDays(startKey, dayIndex);
      const random = seededGenerator(`${entry.attractionId}:${dateKey}`);
      const plan = planDayDemand({
        profile,
        dateKey,
        dayIndex,
        historyDays: HISTORY_DAYS,
        capacity: entry.capacity,
        slots,
        productChoices,
        random,
      });

      let revenue = 0;
      let tickets = 0;
      for (const order of plan.orders) {
        const price = Number(order.product.ticket.sellingPrice);
        revenue += price * order.quantity;
        tickets += order.quantity;
      }
      totalRevenue += revenue;
      totalTickets += tickets;

      lines.push([
        entry.attractionId,
        dateKey,
        derivePriceTier(avgTicketPrice),
        entry.city,
        entry.capacity,
        Math.round(avgTicketPrice),
        entry.rating,
        entry.numReviews,
        Math.round(revenue),
        tickets,
      ].map(csvCell).join(','));
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');

  console.log(`Đã sinh ${lines.length - 1} dòng (${CATALOG.length} điểm × ${HISTORY_DAYS} ngày)`);
  console.log(`  Tổng doanh thu: ${totalRevenue.toLocaleString('vi-VN')} VND`);
  console.log(`  Tổng số vé:     ${totalTickets.toLocaleString('vi-VN')}`);
  console.log(`  -> ${OUTPUT_PATH}`);
  console.log('');
  console.log('Huấn luyện lại:');
  console.log('  cd ml-service');
  console.log('  python -m app.train --data data/demo_booking_history.csv \\');
  console.log('    --training-source demo_booking_history --model-version demo-booking-v2');
}

main();
