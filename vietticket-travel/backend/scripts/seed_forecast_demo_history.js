'use strict';

/**
 * Tạo lịch sử booking phục vụ trình diễn pipeline forecast ở local/dev.
 *
 * Dữ liệu được đánh dấu rõ bằng paymentMethod/note và tuyệt đối không chạy ở
 * production. Script không sửa booking thật; chạy lại sẽ bỏ qua nếu bộ demo đã
 * tồn tại đầy đủ. Dùng --reset để chỉ xóa và tạo lại dữ liệu do script này sở hữu.
 */

const prisma = require('../src/config/prisma');

const DEMO_MARKER = 'forecast_demo_v1';
const DEMO_NOTE = '[FORECAST_DEMO_V1] Dữ liệu mô phỏng để kiểm thử AI; không phải giao dịch thực.';
const HISTORY_DAYS = 240;
const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

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

function deterministicNoise(attractionIndex, dayIndex, bookingIndex) {
  const value = Math.sin(
    (attractionIndex + 1) * 97
    + (dayIndex + 1) * 31
    + (bookingIndex + 1) * 17,
  ) * 10000;
  return (value - Math.floor(value)) * 0.3 + 0.85;
}

function chooseThreePriceBands(attractions) {
  const withPrice = attractions
    .map((attraction) => ({
      ...attraction,
      ticketProduct: attraction.ticketProducts[0],
      price: Number(attraction.ticketProducts[0]?.sellingPrice || 0),
    }))
    .filter((attraction) => attraction.price > 0)
    .sort((left, right) => left.price - right.price);

  if (withPrice.length < 3) return [];
  const bands = [
    { minimum: 0, maximum: 150000, target: 100000 },
    { minimum: 150000, maximum: 350000, target: 250000 },
    { minimum: 350000, maximum: Number.POSITIVE_INFINITY, target: 550000 },
  ];
  const selected = bands.map((band) => (
    withPrice
      .filter((attraction) => (
        attraction.price >= band.minimum
        && attraction.price < band.maximum
      ))
      .sort(
        (left, right) => (
          Math.abs(left.price - band.target) - Math.abs(right.price - band.target)
        ),
      )[0]
  ));
  if (selected.every(Boolean)) return selected;

  return [
    withPrice[0],
    withPrice[Math.floor((withPrice.length - 1) / 2)],
    withPrice[withPrice.length - 1],
  ];
}

async function findDemoAttractions() {
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
      partnerId: true,
      title: true,
      address: true,
      city: true,
      district: true,
      defaultCapacity: true,
      partner: { select: { commissionRate: true } },
      images: {
        where: { isPrimary: true },
        select: { imageUrl: true },
        take: 1,
      },
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        orderBy: { sellingPrice: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          description: true,
          sellingPrice: true,
          refundPolicy: true,
          refundFeeRate: true,
          refundCutoffHours: true,
        },
      },
    },
    orderBy: { title: 'asc' },
  });

  const byPartner = new Map();
  for (const attraction of attractions) {
    const group = byPartner.get(attraction.partnerId) || [];
    group.push(attraction);
    byPartner.set(attraction.partnerId, group);
  }

  const largestPartnerGroup = [...byPartner.values()]
    .sort((left, right) => right.length - left.length)[0] || [];
  return chooseThreePriceBands(largestPartnerGroup);
}

async function ensureDemoCustomer() {
  return prisma.user.upsert({
    where: { email: 'forecast-demo@vietticket.local' },
    create: {
      email: 'forecast-demo@vietticket.local',
      fullName: 'Khách hàng mô phỏng dự báo',
      role: 'CUSTOMER',
      provider: 'LOCAL',
      isEmailVerified: true,
      status: 'ACTIVE',
    },
    update: {
      fullName: 'Khách hàng mô phỏng dự báo',
      status: 'ACTIVE',
    },
    select: { id: true, email: true, fullName: true },
  });
}

async function resetOwnedDemoData() {
  const reservations = await prisma.booking.findMany({
    where: { note: { startsWith: '[FORECAST_DEMO_V1]' } },
    select: { reservationId: true },
  });
  if (reservations.length === 0) return 0;

  await prisma.booking.deleteMany({
    where: { note: { startsWith: '[FORECAST_DEMO_V1]' } },
  });
  await prisma.reservation.deleteMany({
    where: { id: { in: reservations.map((row) => row.reservationId) } },
  });
  return reservations.length;
}

function bookingShape({
  attraction,
  customer,
  visitDateKey,
  dayIndex,
  attractionIndex,
  bookingIndex,
}) {
  const visitDate = dateOnly(visitDateKey);
  const weekday = visitDate.getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const daysBeforeVisit = 8 + ((dayIndex * 7 + bookingIndex * 3) % 22);
  const createdAt = new Date(visitDate.getTime() - daysBeforeVisit * DAY_MS + 3 * 60 * 60 * 1000);
  const paidAt = new Date(createdAt.getTime() + 4 * 60 * 1000);
  const seasonal = 1 + 0.18 * Math.sin((dayIndex / 30) * Math.PI * 2);
  const trend = 0.9 + dayIndex * 0.0025;
  const demand = (attractionIndex + 2)
    * (weekend ? 1.45 : 1)
    * seasonal
    * trend
    * deterministicNoise(attractionIndex, dayIndex, bookingIndex);
  const quantity = Math.max(
    1,
    Math.min(
      Math.max(1, Number(attraction.defaultCapacity || 100)),
      Math.round(demand),
    ),
  );
  const unitPrice = attraction.price;
  const totalAmount = Math.round(unitPrice * quantity);
  const commissionRate = Number(attraction.partner.commissionRate || 0.1);
  const commissionAmount = Math.round(totalAmount * commissionRate);
  const noShow = (dayIndex + attractionIndex * 5 + bookingIndex * 11) % 29 === 0;
  const transactionId = [
    DEMO_MARKER,
    attraction.id,
    visitDateKey,
    bookingIndex,
  ].join(':');

  return {
    transactionId,
    reservation: {
      userId: customer.id,
      ticketProductId: attraction.ticketProduct.id,
      date: visitDate,
      quantity,
      status: 'CONFIRMED',
      expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
      snapshotUnitPrice: unitPrice,
      snapshotRefundPolicy: attraction.ticketProduct.refundPolicy,
      snapshotRefundFeeRate: attraction.ticketProduct.refundFeeRate,
      snapshotRefundCutoffHours: attraction.ticketProduct.refundCutoffHours,
      snapshotCommissionRate: commissionRate,
      createdAt,
    },
    booking: {
      userId: customer.id,
      subtotalAmount: totalAmount,
      discountAmount: 0,
      totalAmount,
      status: noShow ? 'NO_SHOW' : 'COMPLETED',
      paymentMethod: 'vnpay',
      fullName: customer.fullName,
      email: customer.email,
      note: DEMO_NOTE,
      snapshotAt: createdAt,
      snapshotAttractionId: attraction.id,
      snapshotAttractionTitle: attraction.title,
      snapshotAttractionAddress: attraction.address,
      snapshotAttractionCity: attraction.city,
      snapshotAttractionDistrict: attraction.district,
      snapshotAttractionImage: attraction.images[0]?.imageUrl || null,
      snapshotTicketName: attraction.ticketProduct.name,
      snapshotTicketType: attraction.ticketProduct.type,
      snapshotTicketDescription: attraction.ticketProduct.description,
      snapshotUnitPrice: unitPrice,
      snapshotRefundPolicy: attraction.ticketProduct.refundPolicy,
      snapshotRefundFeeRate: attraction.ticketProduct.refundFeeRate,
      snapshotRefundCutoffHours: attraction.ticketProduct.refundCutoffHours,
      snapshotVisitDate: visitDate,
      commissionRateSnapshot: commissionRate,
      commissionAmountSnapshot: commissionAmount,
      partnerNetAmountSnapshot: totalAmount - commissionAmount,
      createdAt,
      payments: {
        create: {
          amount: totalAmount,
          paymentGateway: DEMO_MARKER,
          transactionId,
          status: 'SUCCESS',
          paidAt,
          rawResponse: {
            source: 'demo_booking_history',
            disclaimer: 'Dữ liệu mô phỏng, không phải giao dịch thật.',
          },
          createdAt: paidAt,
        },
      },
      ticketInstances: {
        create: Array.from({ length: quantity }, (_, ticketIndex) => ({
          ticketProductId: attraction.ticketProduct.id,
          qrCodeToken: `${transactionId}:ticket:${ticketIndex}`,
          status: noShow ? 'EXPIRED' : 'USED',
          checkedInAt: noShow
            ? null
            : new Date(visitDate.getTime() + 2 * 60 * 60 * 1000),
          createdAt,
        })),
      },
    },
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không được tạo dữ liệu forecast demo trong production.');
  }

  const shouldReset = process.argv.includes('--reset');
  const existingCount = await prisma.booking.count({
    where: { note: { startsWith: '[FORECAST_DEMO_V1]' } },
  });
  if (existingCount > 0 && !shouldReset) {
    console.log(
      `Đã có ${existingCount} booking forecast demo. Dùng --reset nếu muốn tạo lại.`,
    );
    return;
  }
  if (shouldReset) {
    const deleted = await resetOwnedDemoData();
    console.log(`Đã xóa ${deleted} booking demo cũ do script sở hữu.`);
  }

  const [customer, attractions] = await Promise.all([
    ensureDemoCustomer(),
    findDemoAttractions(),
  ]);
  if (attractions.length < 3) {
    throw new Error('Cần ít nhất 3 điểm đang mở bán của cùng một đối tác.');
  }
  await prisma.reservation.deleteMany({
    where: {
      userId: customer.id,
      booking: null,
    },
  });

  const endKey = addDays(vietnamDateKey(), -1);
  const startKey = addDays(endKey, -(HISTORY_DAYS - 1));
  let createdBookings = 0;
  let createdTickets = 0;

  for (let dayIndex = 0; dayIndex < HISTORY_DAYS; dayIndex += 1) {
    const visitDateKey = addDays(startKey, dayIndex);
    const weekday = dateOnly(visitDateKey).getUTCDay();
    const bookingsThatDay = weekday === 0 || weekday === 6 ? 2 : 1;

    for (let attractionIndex = 0; attractionIndex < attractions.length; attractionIndex += 1) {
      const attraction = attractions[attractionIndex];
      for (let bookingIndex = 0; bookingIndex < bookingsThatDay; bookingIndex += 1) {
        const shape = bookingShape({
          attraction,
          customer,
          visitDateKey,
          dayIndex,
          attractionIndex,
          bookingIndex,
        });
        const quantity = await prisma.$transaction(async (tx) => {
          const reservation = await tx.reservation.create({
            data: shape.reservation,
            select: { id: true, quantity: true },
          });
          await tx.booking.create({
            data: {
              ...shape.booking,
              reservationId: reservation.id,
            },
          });
          return reservation.quantity;
        });
        createdBookings += 1;
        createdTickets += quantity;
      }
    }
  }

  console.log(
    `Đã tạo ${createdBookings} booking / ${createdTickets} vé demo trong ${HISTORY_DAYS} ngày cho:`,
  );
  for (const attraction of attractions) {
    console.log(`- ${attraction.title} (${attraction.city}) · ${attraction.price.toLocaleString('vi-VN')} VND`);
  }
  console.log('Nguồn dữ liệu: demo_booking_history — không phải giao dịch thật.');
}

main()
  .catch((error) => {
    console.error('Seed forecast demo thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
