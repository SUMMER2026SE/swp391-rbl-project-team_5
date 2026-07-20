// Seed dữ liệu mẫu cho Module 2 (Partner Portal)
// Chạy: node prisma/seed.js  (sau khi đã migrate / db push)
require('dotenv').config({ quiet: true });

const prisma = require('../src/config/prisma');
const {
  ensureSeedPartnerIdentity,
  ensureSeedPartnerKycDocument,
} = require('./seedPartnerIdentity');

const PARTNER_EMAIL = String(process.env.SEED_PARTNER_EMAIL || '').trim().toLowerCase();
const PARTNER_PASSWORD = String(process.env.SEED_PARTNER_PASSWORD || '');

const CATEGORIES = [
  { name: 'Công viên giải trí & Nghỉ dưỡng', description: 'Công viên chủ đề, khu vui chơi và trải nghiệm nghỉ dưỡng dành cho gia đình.', icon: 'attractions' },
  { name: 'Thiên nhiên & Tham quan', description: 'Điểm đến sinh thái, cảnh quan và chương trình khám phá thiên nhiên.', icon: 'park' },
  { name: 'Khu vui chơi', description: 'Hoạt động vui chơi và giải trí phù hợp cho gia đình, trẻ em và nhóm bạn.', icon: 'mood' },
  { name: 'Văn hóa & Trải nghiệm địa phương', description: 'Hoạt động văn hóa, nghệ thuật và trải nghiệm đời sống bản địa.', icon: 'theater_comedy' },
  { name: 'Bảo tàng & Di sản', description: 'Không gian bảo tàng, di tích lịch sử và trải nghiệm tìm hiểu di sản.', icon: 'museum' },
  { name: 'Phiêu lưu & Đường thủy', description: 'Trải nghiệm vận động, khám phá ngoài trời và hoạt động đường thủy có kiểm soát an toàn.', icon: 'sailing' },
];

const VOUCHERS = [
  {
    code: 'GIAM20',
    discountType: 'FIXED',
    discountValue: 20000,
    maxDiscount: null,
    minSpend: 100000,
  },
  {
    code: 'VIETTICKET10',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    maxDiscount: 50000,
    minSpend: 150000,
  },
];

async function seedCategories() {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: { description: category.description, icon: category.icon, isActive: true },
      create: { ...category, isActive: true },
    });
  }
  console.log(`✓ Đã seed ${CATEGORIES.length} danh mục.`);
}

async function seedVouchers() {
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  for (const voucher of VOUCHERS) {
    await prisma.voucher.upsert({
      where: { code: voucher.code },
      update: {
        ...voucher,
        expiryDate,
        isActive: true,
      },
      create: {
        ...voucher,
        expiryDate,
        isActive: true,
      },
    });
  }

  console.log(`✓ Đã seed ${VOUCHERS.length} voucher Module 3.`);
}

async function seedPartner() {
  if (!PARTNER_EMAIL || PARTNER_PASSWORD.length < 12) {
    throw new Error(
      'Cần cấu hình SEED_PARTNER_EMAIL và SEED_PARTNER_PASSWORD (ít nhất 12 ký tự).',
    );
  }
  const identity = await ensureSeedPartnerIdentity({
    client: prisma,
    email: PARTNER_EMAIL,
    password: PARTNER_PASSWORD,
    fullName: 'Nguyễn Văn Lộc',
    phoneNumber: '0901234567',
  });
  const user = identity.user;
  if (identity.created) {
    console.log(`✓ Đã tạo tài khoản đối tác: ${PARTNER_EMAIL}`);
  } else {
    console.log(`✓ Đã xoay mật khẩu và thu hồi phiên cũ của đối tác: ${PARTNER_EMAIL}.`);
  }
  const businessLicenseUrl = await ensureSeedPartnerKycDocument({
    userId: user.id,
  });

  const kycData = {
    businessName: 'Công ty Du lịch Lộc Việt',
    taxCode: '0312345678',
    registrationDate: new Date('2020-01-15T00:00:00.000Z'),
    representativeName: 'Nguyễn Văn Lộc',
    representativePhone: '0901234567',
    businessAddress: '123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh',
    businessLicenseUrl,
    bankName: 'Vietcombank',
    branchName: 'Chi nhánh Thành phố Hồ Chí Minh',
    bankAccountNumber: '0123456789',
    bankAccountName: 'NGUYEN VAN LOC',
    payoutCurrency: 'VND',
    kycConsentAccepted: true,
    kycConsentVersion: '2026-07-17-v1',
    kycConsentAcceptedAt: new Date(),
    status: 'APPROVED',
  };

  const partner = await prisma.partnerProfile.upsert({
    where: { userId: user.id },
    update: kycData,
    create: {
      userId: user.id,
      ...kycData,
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

  const themePark = await prisma.category.findUnique({ where: { name: 'Công viên giải trí & Nghỉ dưỡng' } });

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
      recommendedVisitMinutes: 420,
      environment: 'MIXED',
      isFullDay: true,
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      publishedAt: new Date(),
      categories: themePark ? { create: { categoryId: themePark.id } } : undefined,
      images: {
        create: [{
          imageUrl: 'https://picsum.photos/seed/banahills/1024/640',
          isPrimary: true,
        }],
      },
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
            refundFeeRate: 0.5,
            minAgeYears: 3,
            maxAgeYears: 11,
            requiresAdult: true,
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

  console.log(`✓ Đã tạo điểm tham quan mẫu Ba Na Hills, gồm vé và khung giờ (#${banaHills.id.slice(0, 8)}).`);
}

async function main() {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Seed dữ liệu mẫu bị cấm trong production.');
    }
    if (process.env.ALLOW_DEMO_SEED !== 'true') {
      throw new Error('Đặt ALLOW_DEMO_SEED=true để xác nhận seed dữ liệu mẫu.');
    }
    await prisma.$connect();
    console.log('Đang seed dữ liệu Module 2...');
    await seedCategories();
    await seedVouchers();
    const partner = await seedPartner();
    await seedAttractions(partner);

    console.log('Đang tính toán lại minTicketPrice cho các điểm tham quan...');
    await prisma.$executeRaw`
      UPDATE "Attraction" a
      SET "minTicketPrice" = (
        SELECT MIN(tp."sellingPrice")
        FROM "TicketProduct" tp
        WHERE tp."attractionId" = a."id"
          AND tp."status" = 'ACTIVE'
          AND tp."archivedAt" IS NULL
      )
    `;

    console.log('==================================================');
    console.log('SEED THÀNH CÔNG!');
    console.log(`Đối tác mẫu: ${PARTNER_EMAIL}`);
    console.log('==================================================');
  } catch (error) {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
