// Seed dữ liệu mẫu cho Module 2 (Partner Portal)
// Chạy: node prisma/seed.js  (sau khi đã migrate / db push)
require('dotenv').config({ quiet: true });

const bcrypt = require('bcrypt');
const prisma = require('../src/config/prisma');

const PARTNER_EMAIL = 'partner@vietticket.com';
const PARTNER_PASSWORD = 'Partner@123';

const CATEGORIES = [
  'Theme Park & Resort',
  'Nature & Sightseeing',
  'Amusement Park',
  'Cultural Experience',
  'Museum',
  'Adventure',
];

async function seedCategories() {
  for (const name of CATEGORIES) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(`✓ Đã seed ${CATEGORIES.length} danh mục.`);
}

async function seedPartner() {
  let user = await prisma.user.findUnique({ where: { email: PARTNER_EMAIL } });

  if (!user) {
    const passwordHash = await bcrypt.hash(PARTNER_PASSWORD, 10);
    user = await prisma.user.create({
      data: {
        email: PARTNER_EMAIL,
        passwordHash,
        fullName: 'Nguyễn Văn Lộc',
        role: 'PARTNER',
        isEmailVerified: true,
        status: 'ACTIVE',
        profile: { create: { phoneNumber: '0901234567' } },
      },
    });
    console.log(`✓ Đã tạo tài khoản đối tác: ${PARTNER_EMAIL} / ${PARTNER_PASSWORD}`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'PARTNER', isEmailVerified: true, status: 'ACTIVE' },
    });
    console.log(`✓ Tài khoản ${PARTNER_EMAIL} đã tồn tại — đảm bảo role PARTNER.`);
  }

  const partner = await prisma.partnerProfile.upsert({
    where: { userId: user.id },
    update: { status: 'APPROVED' },
    create: {
      userId: user.id,
      businessName: 'Lộc Premium Partner',
      taxCode: '0312345678',
      bankName: 'Vietcombank',
      bankAccountNumber: '0123456789',
      bankAccountName: 'NGUYEN VAN LOC',
      status: 'APPROVED',
    },
  });

  return partner;
}

async function seedAttractions(partner) {
  const count = await prisma.attraction.count({ where: { partnerId: partner.id } });
  if (count > 0) {
    console.log(`✓ Đối tác đã có ${count} điểm tham quan — bỏ qua seed điểm mẫu.`);
    return;
  }

  const themePark = await prisma.category.findUnique({ where: { name: 'Theme Park & Resort' } });
  const nature = await prisma.category.findUnique({ where: { name: 'Nature & Sightseeing' } });

  const banaHills = await prisma.attraction.create({
    data: {
      partnerId: partner.id,
      title: 'Sun World Ba Na Hills',
      description: 'Khu du lịch nổi tiếng với Cầu Vàng và làng Pháp cổ kính.',
      address: 'Thôn An Sơn, xã Hòa Ninh',
      city: 'Đà Nẵng',
      district: 'Huyện Hòa Vang',
      openTime: '08:00',
      closeTime: '17:00',
      defaultCapacity: 200,
      openDays: '1,1,1,1,1,1,1',
      status: 'APPROVED',
      categories: themePark ? { create: { categoryId: themePark.id } } : undefined,
      ticketProducts: {
        create: [
          {
            name: 'Vé người lớn',
            type: 'ADULT',
            description: 'Vé trọn gói cho khách từ 12 tuổi.',
            originalPrice: 900000,
            sellingPrice: 850000,
            status: 'ACTIVE',
            refundPolicy: 'FREE_CANCELLATION',
          },
          {
            name: 'Vé trẻ em',
            type: 'CHILD',
            description: 'Vé cho trẻ từ 3–11 tuổi.',
            originalPrice: 700000,
            sellingPrice: 650000,
            status: 'ACTIVE',
            refundPolicy: 'REFUND_WITH_FEE',
          },
        ],
      },
      timeSlots: {
        create: [
          { startTime: '08:00', endTime: '10:00', maxCapacity: 50, isActive: true },
          { startTime: '10:00', endTime: '12:00', maxCapacity: 50, isActive: true },
        ],
      },
    },
  });

  await prisma.attraction.create({
    data: {
      partnerId: partner.id,
      title: 'Vịnh Hạ Long Cruise',
      description: 'Du thuyền ngắm vịnh di sản thế giới.',
      address: 'Cảng Tuần Châu',
      city: 'Quảng Ninh',
      district: 'Cảng Tuần Châu',
      openTime: '07:30',
      closeTime: '18:00',
      defaultCapacity: 100,
      openDays: '1,1,1,1,1,1,1',
      status: 'APPROVED',
      categories: nature ? { create: { categoryId: nature.id } } : undefined,
    },
  });

  console.log(`✓ Đã tạo 2 điểm tham quan mẫu (gồm vé & khung giờ cho Ba Na Hills #${banaHills.id.slice(0, 8)}).`);
}

async function main() {
  try {
    await prisma.$connect();
    console.log('Đang seed dữ liệu Module 2...');
    await seedCategories();
    const partner = await seedPartner();
    await seedAttractions(partner);
    console.log('==================================================');
    console.log('SEED THÀNH CÔNG!');
    console.log(`Đăng nhập đối tác: ${PARTNER_EMAIL} / ${PARTNER_PASSWORD}`);
    console.log('==================================================');
  } catch (error) {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
