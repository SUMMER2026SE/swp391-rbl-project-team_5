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

function deterministicArrivals(index) {
  const hour = new Date(index).getUTCHours();
  const wave = hour >= 2 && hour <= 10 ? 7 : 3;
  return Math.max(0, wave + (index % 5) - 2);
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
        mode: 'AUTO',
        openBeforeMinutes: 120,
        readyGraceMinutes: 10,
        maxReadyParties: 3,
        maxActiveParties: 100,
      },
      update: { enabled: true, mode: 'AUTO' },
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
          checkinsLast15Minutes: deterministicArrivals(bucketStart.getTime()),
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
