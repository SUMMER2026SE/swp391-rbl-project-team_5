'use strict';

/**
 * Safe, idempotent local demo data for Live–AutoPilot.
 * It creates only policy + operational observations; it never creates money,
 * bookings, tickets or customer PII and refuses production environments.
 */
require('dotenv').config({ quiet: true });

const prisma = require('../src/config/prisma');

const LIVE_AUTOPILOT_DEMO_MARKER = 'LIVE_AUTOPILOT_DEMO_V2';

function requireLocalConfirmation() {
  const confirmed = ['--confirm-local-demo', '--confirm'].some((flag) => process.argv.includes(flag));
  if (process.env.NODE_ENV === 'production' || !confirmed) {
    throw new Error('Chỉ chạy demo local với --confirm-local-demo và NODE_ENV khác production.');
  }
  let databaseUrl;
  try {
    databaseUrl = new URL(String(process.env.DATABASE_URL || ''));
  } catch {
    throw new Error('DATABASE_URL không hợp lệ; từ chối ghi dữ liệu demo.');
  }
  if (!new Set(['localhost', '127.0.0.1', '::1']).has(databaseUrl.hostname)) {
    throw new Error('Live-AutoPilot demo chỉ được phép ghi database chạy trên localhost.');
  }
}

const BUCKET_MS = 15 * 60 * 1000;
const VN_OFFSET_HOURS = 7;

// Lượng khách đến trong một khung 15 phút, theo giờ Việt Nam.
//
// Trước đây hàm này trả về wave + (index % 5) - 2. Vì các bucket cách nhau đúng
// 900.000 ms mà 900000 % 5 === 0 nên (index % 5) là HẰNG SỐ -> cả chuỗi chỉ có
// 2 giá trị (bậc thang). Mô hình không học được gì từ dữ liệu 2 mức, khiến sai
// số chuẩn hoá luôn ~0.72 và độ tin cậy luôn LOW.
//
// Thay bằng đường cong lưu lượng thật của điểm tham quan: đêm vắng, sáng tăng
// dần, hai đỉnh (giữa buổi sáng và giữa buổi chiều), tối giảm; kèm dao động nhỏ
// tất định theo chỉ số bucket (đổi theo từng khung, không còn là hằng số).
function deterministicArrivals(index) {
  const date = new Date(index);
  const hourOfDay =
    ((date.getUTCHours() + VN_OFFSET_HOURS) % 24)
    + date.getUTCMinutes() / 60;

  // Hai đỉnh khách: ~10h00 và ~15h30.
  const morningPeak = 9 * Math.exp(-((hourOfDay - 10) ** 2) / 6);
  const afternoonPeak = 11 * Math.exp(-((hourOfDay - 15.5) ** 2) / 7);
  const baseline = 1.5;

  // Dao động nhỏ theo chỉ số bucket (tăng 1 mỗi 15 phút) nên thực sự biến thiên.
  const bucketIndex = Math.floor(index / BUCKET_MS);
  const jitter = ((bucketIndex % 7) - 3) * 0.25;

  return Math.max(0, Math.round(baseline + morningPeak + afternoonPeak + jitter));
}

async function seedLiveAutopilotSignals({
  attractionIds = null,
  now = new Date(),
  prismaClient = prisma,
} = {}) {
  const normalizedIds = Array.isArray(attractionIds)
    ? [...new Set(attractionIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  const attractions = await prismaClient.attraction.findMany({
    where: {
      status: 'APPROVED',
      archivedAt: null,
      ...(normalizedIds.length > 0 ? { id: { in: normalizedIds } } : {}),
    },
    select: { id: true, title: true, defaultCapacity: true },
    orderBy: { createdAt: 'asc' },
    ...(normalizedIds.length > 0 ? {} : { take: 3 }),
  });
  if (attractions.length === 0) {
    throw new Error('Local DB chưa có attraction APPROVED để tạo demo.');
  }
  if (normalizedIds.length > 0 && attractions.length !== normalizedIds.length) {
    const foundIds = new Set(attractions.map(({ id }) => id));
    const missing = normalizedIds.filter((id) => !foundIds.has(id));
    throw new Error(`Thiếu attraction APPROVED cho Live-AutoPilot demo: ${missing.join(', ')}`);
  }

  let observations = 0;
  for (const attraction of attractions) {
    await prismaClient.smartQueuePolicy.upsert({
      where: { attractionId: attraction.id },
      create: {
        attractionId: attraction.id,
        enabled: true,
        operationalReadinessConfirmedAt: now,
        mode: 'AUTO',
        openBeforeMinutes: 120,
        readyGraceMinutes: 10,
        maxReadyParties: 3,
        maxReadyGuests: 20,
        maxActiveParties: 100,
      },
      update: { enabled: true, operationalReadinessConfirmedAt: now, mode: 'AUTO' },
    });
    for (let step = 1; step <= 96; step += 1) {
      const bucketStart = new Date(now.getTime() - step * 15 * 60 * 1000);
      bucketStart.setUTCSeconds(0, 0);
      bucketStart.setUTCMinutes(Math.floor(bucketStart.getUTCMinutes() / 15) * 15);
      const observationKey = `${LIVE_AUTOPILOT_DEMO_MARKER}:${attraction.id}:${bucketStart.toISOString()}`;
      const capacity = Math.max(1, Number(attraction.defaultCapacity || 100));
      await prismaClient.arrivalObservation.upsert({
        where: { observationKey },
        create: {
          observationKey,
          attractionId: attraction.id,
          bucketStart,
          capacity,
          bookedGuests: Math.round(capacity * 0.55),
          heldGuests: Math.round(capacity * 0.05),
          queueGuests: Math.round(capacity * 0.1),
          // Khách đã vào trong 15 phút TRƯỚC khung này (không phải cùng khung),
          // để mô hình có tín hiệu dự báo thật thay vì chép lại nhãn.
          checkinsLast15Minutes: deterministicArrivals(bucketStart.getTime() - BUCKET_MS),
          showRate: 0.9,
          pressureScore: 68 + (step % 18),
          actualArrivalsNext15m: deterministicArrivals(bucketStart.getTime()),
          dataSource: 'DEMO_OPERATIONAL',
          calendarFeatures: { demoMarker: LIVE_AUTOPILOT_DEMO_MARKER },
        },
        update: {},
      });
      observations += 1;
    }
  }
  return {
    success: true,
    attractions: attractions.map((row) => row.id),
    observations,
    marker: LIVE_AUTOPILOT_DEMO_MARKER,
  };
}

async function main() {
  requireLocalConfirmation();
  const result = await seedLiveAutopilotSignals();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[live-autopilot-demo] ${error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    await prisma.$disconnect();
  });
}

module.exports = {
  LIVE_AUTOPILOT_DEMO_MARKER,
  deterministicArrivals,
  seedLiveAutopilotSignals,
};
