'use strict';

/**
 * Seed đánh giá mẫu cho các điểm tham quan nổi bật để trang danh sách/chi tiết
 * không bị trống rating khi demo. Idempotent: điểm nào đã có review sẽ được bỏ qua.
 *
 * Chạy: node prisma/seed-reviews.js
 */

const prisma = require('../src/config/prisma');
const bcrypt = require('bcrypt');

// Vài tài khoản khách để gán đánh giá (không trùng khách thật/nhân viên).
const REVIEWERS = [
  { email: 'reviewer1@demo.vietticket.com', fullName: 'Trần Thu Hà' },
  { email: 'reviewer2@demo.vietticket.com', fullName: 'Lê Minh Quân' },
  { email: 'reviewer3@demo.vietticket.com', fullName: 'Phạm Thị Ngọc' },
  { email: 'reviewer4@demo.vietticket.com', fullName: 'Hoàng Văn Nam' },
  { email: 'reviewer5@demo.vietticket.com', fullName: 'Vũ Thị Lan' },
  { email: 'reviewer6@demo.vietticket.com', fullName: 'Đặng Quốc Bảo' },
];

// Điểm nổi bật cần có rating khi demo (khớp theo title, bỏ qua nếu không tìm thấy).
const FEATURED_TITLES = [
  'VinWonders Nha Trang',
  'Sun World Ba Na Hills',
  'Du thuyền Vịnh Hạ Long',
  'Khu du lịch sinh thái Tràng An',
  'Động Phong Nha',
  'Động Thiên Đường',
  'Dinh Độc Lập',
  'Cáp treo Hòn Thơm Phú Quốc',
  'Khu du lịch Suối Tiên',
  'Đền Ngọc Sơn',
];

const COMMENTS = {
  5: [
    'Trải nghiệm tuyệt vời, cảnh đẹp và nhân viên rất thân thiện. Chắc chắn quay lại!',
    'Đặt vé qua VietTicket rất nhanh, vào cổng quét mã QR tiện lợi, không phải xếp hàng.',
    'Đáng đồng tiền, phù hợp cho cả gia đình đi chơi cả ngày.',
    'Không gian đẹp, nhiều hoạt động thú vị. Rất đáng để ghé thăm.',
  ],
  4: [
    'Nhìn chung rất tốt, chỉ hơi đông vào cuối tuần thôi.',
    'Cảnh đẹp, giá hợp lý, dịch vụ ổn. Sẽ giới thiệu cho bạn bè.',
    'Trải nghiệm ổn, nên đi sớm để tránh nắng và đông.',
  ],
  3: [
    'Bình thường, dịch vụ có thể cải thiện thêm một chút.',
    'Cũng được, nhưng khá đông và trời nắng nên hơi mệt.',
  ],
};

// Mảng điểm số cho từng review theo thứ tự (thiên về 4-5 sao cho tự nhiên).
const RATING_PATTERN = [5, 5, 4, 5, 4, 3, 5, 4];

function pick(list, index) {
  return list[index % list.length];
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function ensureReviewers() {
  const passwordHash = await bcrypt.hash('Demo@12345', 10);
  const users = [];
  for (const r of REVIEWERS) {
    const user = await prisma.user.upsert({
      where: { email: r.email },
      update: {},
      create: {
        email: r.email,
        passwordHash,
        fullName: r.fullName,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        isEmailVerified: true,
      },
      select: { id: true },
    });
    users.push(user.id);
  }
  return users;
}

async function recalcRating(attractionId) {
  const active = await prisma.review.findMany({
    where: { attractionId, isHidden: false },
    select: { rating: true },
  });
  const totalReviews = active.length;
  const averageRating = totalReviews
    ? parseFloat((active.reduce((s, r) => s + r.rating, 0) / totalReviews).toFixed(1))
    : 0;
  await prisma.attraction.update({
    where: { id: attractionId },
    data: { averageRating, totalReviews },
  });
  return { averageRating, totalReviews };
}

async function main() {
  const reviewerIds = await ensureReviewers();
  let seeded = 0;

  for (const title of FEATURED_TITLES) {
    const attraction = await prisma.attraction.findFirst({
      where: { title: { contains: title, mode: 'insensitive' } },
      select: { id: true, title: true, totalReviews: true },
    });
    if (!attraction) {
      console.log(`- Bỏ qua (không tìm thấy): ${title}`);
      continue;
    }
    const existing = await prisma.review.count({ where: { attractionId: attraction.id } });
    if (existing > 0) {
      console.log(`- Bỏ qua (đã có ${existing} review): ${attraction.title}`);
      continue;
    }

    // 5–6 review mỗi điểm, mỗi review một khách khác nhau.
    const count = 5 + (attraction.id.charCodeAt(0) % 2); // 5 hoặc 6
    for (let i = 0; i < count; i += 1) {
      const rating = pick(RATING_PATTERN, i);
      await prisma.review.create({
        data: {
          userId: pick(reviewerIds, i),
          attractionId: attraction.id,
          rating,
          comment: pick(COMMENTS[rating], i),
          createdAt: daysAgo((i + 1) * 3 + (attraction.id.charCodeAt(1) % 5)),
        },
      });
    }
    const stats = await recalcRating(attraction.id);
    seeded += 1;
    console.log(
      `+ ${attraction.title}: ${count} review -> ${stats.averageRating}★ (${stats.totalReviews})`,
    );
  }

  console.log(`\nHoàn tất: đã seed review cho ${seeded} điểm.`);
}

main()
  .catch((error) => {
    console.error('Seed review lỗi:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
