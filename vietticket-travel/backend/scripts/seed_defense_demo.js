'use strict';

/**
 * Bộ dữ liệu trình diễn bảo vệ VietTicket Travel.
 *
 * Mục tiêu:
 * - Tạo dữ liệu xuyên suốt cho Customer, Partner, Partner Staff, Platform Staff và Admin.
 * - Tự dịch ngày theo ngày chạy để check-in, hoàn tiền và duyệt đơn không bị hết hạn.
 * - Chạy lại an toàn: chỉ xóa dữ liệu mang prefix DEFENSE_DEMO_V1 do script sở hữu.
 * - Không bao giờ chạy trong production.
 *
 * Chạy:
 *   npm run demo:prepare   # reset + tạo lại toàn bộ dữ liệu local
 *   npm run demo:check     # chỉ kiểm tra, không ghi database
 */

require('dotenv').config({ quiet: true });

const bcrypt = require('bcrypt');
const prisma = require('../src/config/prisma');
const { ensureSeedPartnerKycDocument } = require('../prisma/seedPartnerIdentity');

const PREFIX = 'defense-demo-v1-';
const MARKER = '[DEFENSE_DEMO_V1]';
const DEMO_PASSWORD = String(process.env.DEMO_PASSWORD || 'Demo@VietTicket2026');
const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const HISTORY_DAYS = 90;

const IDS = Object.freeze({
  users: {
    customer: `${PREFIX}user-customer`,
    partner: `${PREFIX}user-partner`,
    gateStaff: `${PREFIX}user-gate-staff`,
    platformStaff: `${PREFIX}user-platform-staff`,
    admin: `${PREFIX}user-admin`,
    forecastCustomer: `${PREFIX}user-forecast-history`,
    kycApprove: `${PREFIX}user-kyc-approve`,
    kycReject: `${PREFIX}user-kyc-reject`,
  },
  partners: {
    owner: `${PREFIX}partner-owner`,
    kycApprove: `${PREFIX}partner-kyc-approve`,
    kycReject: `${PREFIX}partner-kyc-reject`,
  },
  attractions: {
    museum: `${PREFIX}attraction-museum`,
    cruise: `${PREFIX}attraction-cruise`,
    eco: `${PREFIX}attraction-eco`,
    pendingApprove: `${PREFIX}attraction-pending-approve`,
    pendingReject: `${PREFIX}attraction-pending-reject`,
    suspended: `${PREFIX}attraction-suspended`,
    draft: `${PREFIX}attraction-draft`,
  },
  tickets: {
    museumAdult: `${PREFIX}ticket-museum-adult`,
    museumChild: `${PREFIX}ticket-museum-child`,
    museumStudent: `${PREFIX}ticket-museum-student`,
    cruiseAdult: `${PREFIX}ticket-cruise-adult`,
    cruiseFamily: `${PREFIX}ticket-cruise-family`,
    ecoAdult: `${PREFIX}ticket-eco-adult`,
    ecoChild: `${PREFIX}ticket-eco-child`,
    pendingApprove: `${PREFIX}ticket-pending-approve`,
    pendingReject: `${PREFIX}ticket-pending-reject`,
    suspended: `${PREFIX}ticket-suspended`,
    draft: `${PREFIX}ticket-draft`,
  },
});

const ACCOUNTS = Object.freeze({
  customer: {
    id: IDS.users.customer,
    email: 'minh.anh.nguyen@vietticket.local',
    fullName: 'Nguyễn Minh Anh',
    role: 'CUSTOMER',
    phone: '0901000001',
  },
  partner: {
    id: IDS.users.partner,
    email: 'hoang.nam.tran@vietticket.local',
    fullName: 'Trần Hoàng Nam',
    role: 'PARTNER',
    phone: '0901000002',
  },
  gateStaff: {
    id: IDS.users.gateStaff,
    email: 'quoc.bao.pham@vietticket.local',
    fullName: 'Phạm Quốc Bảo',
    role: 'STAFF',
    phone: '0901000003',
    employerPartnerId: IDS.partners.owner,
  },
  platformStaff: {
    id: IDS.users.platformStaff,
    email: 'thu.ha.le@vietticket.local',
    fullName: 'Lê Thu Hà',
    role: 'STAFF',
    phone: '0901000004',
  },
  admin: {
    id: IDS.users.admin,
    email: 'ngoc.lan.vu@vietticket.local',
    fullName: 'Vũ Ngọc Lan',
    role: 'ADMIN',
    phone: '0901000005',
  },
  forecastCustomer: {
    id: IDS.users.forecastCustomer,
    email: 'nguyen.gia.han@vietticket.local',
    fullName: 'Nguyễn Gia Hân',
    role: 'CUSTOMER',
    phone: '0901000008',
  },
  kycApprove: {
    id: IDS.users.kycApprove,
    email: 'gia.han.do@vietticket.local',
    fullName: 'Đỗ Gia Hân',
    role: 'CUSTOMER',
    phone: '0901000006',
  },
  kycReject: {
    id: IDS.users.kycReject,
    email: 'thanh.tung.bui@vietticket.local',
    fullName: 'Bùi Thanh Tùng',
    role: 'CUSTOMER',
    phone: '0901000007',
  },
});

// Public-looking suffixes keep customer-facing references neutral. Scenario
// keys remain internal to the seed/smoke scripts and are never rendered by UI.
const SCENARIO_BOOKING_REFERENCES = Object.freeze({
  'checkin-today': '260720000001',
  'already-checked-today': '260720000002',
  'partner-approve': '260720000003',
  'partner-reject': '260720000004',
  'review-create': '260720000005',
  'review-reply': '260720000006',
  'review-moderate': '260720000007',
  'refund-customer-create': '260720000008',
  'refund-approve': '260720000009',
  'refund-reject': '260720000010',
  'pending-payment': '260720000011',
  reissue: '260720000012',
  refunded: '260720000013',
  'no-show': '260720000014',
  cancelled: '260720000015',
});

const SCENARIO_REFUND_REFERENCES = Object.freeze({
  approve: '260720000101',
  reject: '260720000102',
  completed: '260720000103',
});

function scenarioBookingId(key) {
  const reference = SCENARIO_BOOKING_REFERENCES[key];
  if (!reference) throw new Error(`Không có mã tham chiếu cho booking ${key}.`);
  return `${PREFIX}booking-${reference}`;
}

function scenarioRefundRequestId(key) {
  const reference = SCENARIO_REFUND_REFERENCES[key];
  if (!reference) throw new Error(`Không có mã tham chiếu cho yêu cầu hoàn tiền ${key}.`);
  return `${PREFIX}refund-${reference}`;
}

function vietnamDateKey(date = new Date()) {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function addDateKeyDays(dateKey, days) {
  return new Date(
    new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS,
  ).toISOString().slice(0, 10);
}

function dateOnly(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function atVietnamTime(dateKey, hours = 9, minutes = 0) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours - 7, minutes));
}

function money(value) {
  return Math.round(Number(value || 0));
}

function gatewayReference(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `VNPAY${hash.toString(36).toUpperCase().padStart(8, '0')}`;
}

function commissionAmounts(total, rate = 0.1) {
  const commission = money(total * rate);
  return { commission, partnerNet: money(total - commission) };
}

function buildSubmittedSnapshot({
  attractionId,
  title,
  description,
  address,
  city,
  district,
  latitude,
  longitude,
  category,
  imageUrl,
  ticketId,
  ticketName,
  sellingPrice,
}) {
  return {
    schemaVersion: 1,
    title,
    description,
    address,
    city,
    district,
    openTime: '08:00',
    closeTime: '18:00',
    latitude,
    longitude,
    requiresManualApproval: false,
    recommendedVisitMinutes: 180,
    environment: 'MIXED',
    isFullDay: false,
    category: { id: category.id, name: category.name },
    images: [{
      id: `${attractionId}-image-primary`,
      url: imageUrl,
      isPrimary: true,
    }],
    tickets: [{
      id: ticketId,
      name: ticketName,
      type: 'ADULT',
      description: 'Gói vé người lớn, đã bao gồm phí tham quan cơ bản.',
      originalPrice: sellingPrice + 50000,
      sellingPrice,
      status: 'ACTIVE',
      refundPolicy: 'FREE_CANCELLATION',
      refundFeeRate: 0,
      refundCutoffHours: 24,
      minAgeYears: 12,
      maxAgeYears: null,
      minHeightCm: null,
      maxHeightCm: null,
      requiresAdult: false,
    }],
    schedule: {
      openDays: [true, true, true, true, true, true, true],
      defaultCapacity: 120,
      timeSlots: [{
        id: `${attractionId}-slot-review`,
        start: '08:00',
        end: '12:00',
        capacity: 60,
        isActive: true,
      }],
      specialDates: {},
    },
  };
}

async function resetOwnedDemoData() {
  await prisma.$transaction(async (tx) => {
    const legacyForecastReservations = await tx.booking.findMany({
      where: {
        OR: [
          { note: { startsWith: '[FORECAST_DEMO_V1]' } },
          { payments: { some: { paymentGateway: 'forecast_demo_v1' } } },
        ],
      },
      select: { reservationId: true },
    });
    if (legacyForecastReservations.length > 0) {
      await tx.booking.deleteMany({
        where: {
          OR: [
            { note: { startsWith: '[FORECAST_DEMO_V1]' } },
            { payments: { some: { paymentGateway: 'forecast_demo_v1' } } },
          ],
        },
      });
      await tx.reservation.deleteMany({
        where: { id: { in: legacyForecastReservations.map(({ reservationId }) => reservationId) } },
      });
    }

    const legacyChecklistUsers = await tx.user.findMany({
      where: {
        AND: [
          { email: { startsWith: 'demo.' } },
          { email: { endsWith: '@vietticket.com' } },
        ],
      },
      select: { id: true },
    });
    if (legacyChecklistUsers.length > 0) {
      const legacyChecklistUserIds = legacyChecklistUsers.map(({ id }) => id);
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: legacyChecklistUserIds } },
            { entityType: { in: ['User', 'USER'] }, entityId: { in: legacyChecklistUserIds } },
          ],
        },
      });
      await tx.user.deleteMany({ where: { id: { in: legacyChecklistUserIds } } });
    }

    await tx.partnerSettlement.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.supportTicket.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { id: { startsWith: PREFIX } },
          { entityId: { startsWith: PREFIX } },
          { actorId: { startsWith: PREFIX } },
        ],
      },
    });
    await tx.savedItinerary.deleteMany({ where: { planId: { startsWith: PREFIX } } });
    await tx.newsletterSubscription.deleteMany({
      where: { email: 'demo.newsletter@vietticket.local' },
    });
    await tx.booking.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.reservation.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.attraction.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.category.deleteMany({
      where: { description: { contains: MARKER }, attractions: { none: {} } },
    });
    await tx.partnerProfile.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.voucher.deleteMany({ where: { code: 'DEMO15' } });
    await tx.user.deleteMany({ where: { id: { startsWith: PREFIX } } });

    // Remove records left by the old manual/API test run. These titles and
    // categories were generated specifically by the test checklist and must
    // never be mixed with the catalog shown during a product demonstration.
    await tx.attraction.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Codex ' } },
          { title: { startsWith: 'Manual Pending Attraction ' } },
          { title: { startsWith: 'Other Partner Booking Attraction ' } },
        ],
      },
    });
    await tx.category.deleteMany({
      where: {
        OR: [
          { name: { startsWith: 'Manual Test Category' } },
          { name: { startsWith: 'Manual Review Category' } },
        ],
        attractions: { none: {} },
      },
    });

    // Normalize a legacy local browser-test record that otherwise leaks test
    // wording into the rejected-KYC tab after preparing the demo database.
    await tx.partnerProfile.updateMany({
      where: {
        OR: [
          {
            businessName: 'Demo Rejected Travel',
            user: { email: 'demo.kyc.customer.review@vietticket.com' },
          },
          { user: { email: 'tran.minh.khoa@vietticket.local' } },
        ],
      },
      data: {
        businessName: 'Công ty Du lịch Hướng Dương',
        representativeName: 'Trần Minh Khoa',
        representativePhone: '0908123456',
        description: 'Hồ sơ đăng ký đối tác chưa đáp ứng đầy đủ yêu cầu xác minh.',
        rejectionReason: 'Hồ sơ chưa cung cấp đầy đủ tài liệu xác minh theo yêu cầu.',
      },
    });
    await tx.user.updateMany({
      where: {
        email: {
          in: [
            'demo.kyc.customer.review@vietticket.com',
            'tran.minh.khoa@vietticket.local',
          ],
        },
      },
      data: {
        email: 'tran.minh.khoa@vietticket.local',
        fullName: 'Trần Minh Khoa',
      },
    });

    const legacyPartnerProfiles = [
      {
        email: 'demo.partner.river@vietticket.com',
        nextEmail: 'contact@saigonrivertravel.vn',
        representativeName: 'Phạm Minh Quân',
      },
      {
        email: 'demo.partner.mekong@vietticket.com',
        nextEmail: 'support@mekongdelticket.vn',
        representativeName: 'Trần Thu Hà',
      },
      {
        email: 'demo.partner.discovery@vietticket.com',
        nextEmail: 'partner@northernheritage.vn',
        representativeName: 'Nguyễn Đức Anh',
      },
    ];
    for (const legacyPartner of legacyPartnerProfiles) {
      await tx.partnerProfile.updateMany({
        where: { user: { email: legacyPartner.email } },
        data: { representativeName: legacyPartner.representativeName },
      });
      await tx.user.updateMany({
        where: { email: legacyPartner.email },
        data: {
          email: legacyPartner.nextEmail,
          fullName: legacyPartner.representativeName,
        },
      });
    }

    await tx.partnerProfile.updateMany({
      where: { user: { email: 'partner@vietticket.com' } },
      data: { businessName: 'Công ty Du lịch Lộc Việt', representativeName: 'Nguyễn Văn Lộc' },
    });
    await tx.user.updateMany({
      where: { email: 'partner@vietticket.com' },
      data: { fullName: 'Nguyễn Văn Lộc' },
    });
    for (const identity of [
      ['admin@vietticket.vn', 'Quản trị VietTicket'],
      ['customer@vietticket.com', 'Nguyễn Minh Khôi'],
      ['staff@vietticket.com', 'Nguyễn Thu Phương'],
      ['checkin.staff@vietticket.com', 'Trần Quốc Việt'],
    ]) {
      await tx.user.updateMany({
        where: { email: identity[0] },
        data: { fullName: identity[1] },
      });
    }
    await tx.attraction.updateMany({
      where: {
        city: {
          in: [
            'TP. Hồ Chí Minh',
            'TP Hồ Chí Minh',
            'TP.HCM',
            'TP HCM',
            'Thành phố Hồ Chí Minh',
            'Ho Chi Minh',
            'Ho Chi Minh City',
          ],
        },
      },
      data: { city: 'Hồ Chí Minh' },
    });
  }, { timeout: 30000 });
}

async function createIdentity(account, passwordHash) {
  return prisma.user.create({
    data: {
      id: account.id,
      email: account.email,
      passwordHash,
      fullName: account.fullName,
      role: account.role,
      provider: 'LOCAL',
      isEmailVerified: true,
      status: 'ACTIVE',
      employerPartnerId: account.employerPartnerId || null,
      termsAcceptedAt: new Date(),
      termsVersion: '2026-07-demo',
      privacyVersion: '2026-07-demo',
      consentIpAddress: '127.0.0.1',
      profile: {
        create: {
          id: `${account.id}-profile`,
          phoneNumber: account.phone,
          dateOfBirth: new Date('1995-05-15T00:00:00.000Z'),
          gender: 'OTHER',
          address: 'Thành phố Hồ Chí Minh',
        },
      },
      roleMemberships: {
        create: account.role === 'PARTNER'
          ? [{ role: 'CUSTOMER' }, { role: 'PARTNER' }]
          : [{ role: account.role }],
      },
    },
  });
}

async function seedIdentitiesAndPartners() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await createIdentity(ACCOUNTS.customer, passwordHash);
  await createIdentity(ACCOUNTS.partner, passwordHash);

  const ownerLicense = await ensureSeedPartnerKycDocument({ userId: IDS.users.partner });
  await prisma.partnerProfile.create({
    data: {
      id: IDS.partners.owner,
      userId: IDS.users.partner,
      businessName: 'Công ty Du lịch Trải nghiệm Việt',
      businessLicenseUrl: ownerLicense,
      taxCode: '0319900001',
      registrationDate: new Date('2020-03-12T00:00:00.000Z'),
      representativeName: ACCOUNTS.partner.fullName,
      representativePhone: ACCOUNTS.partner.phone,
      businessAddress: '02 Công trường Mê Linh, Quận 1, TP. Hồ Chí Minh',
      bankName: 'Vietcombank',
      branchName: 'Chi nhánh TP. Hồ Chí Minh',
      bankAccountNumber: '012345678901',
      bankAccountName: 'CONG TY DU LICH TRAI NGHIEM VIET',
      payoutCurrency: 'VND',
      website: 'https://vietticket.local/doi-tac/trai-nghiem-viet',
      description: 'Đơn vị vận hành các trải nghiệm văn hóa, sinh thái và du lịch đường thủy tại Thành phố Hồ Chí Minh.',
      kycConsentAccepted: true,
      kycConsentVersion: '2026-07-demo',
      kycConsentAcceptedAt: new Date(),
      kycConsentIpAddress: '127.0.0.1',
      commissionRate: 0.1,
      status: 'APPROVED',
    },
  });

  await createIdentity(ACCOUNTS.gateStaff, passwordHash);
  await createIdentity(ACCOUNTS.platformStaff, passwordHash);
  await createIdentity(ACCOUNTS.admin, passwordHash);
  await createIdentity(ACCOUNTS.forecastCustomer, passwordHash);
  await createIdentity(ACCOUNTS.kycApprove, passwordHash);
  await createIdentity(ACCOUNTS.kycReject, passwordHash);

  for (const [key, profileId, taxCode, businessName] of [
    ['kycApprove', IDS.partners.kycApprove, '0319900002', 'Công ty TNHH Hành trình Xanh'],
    ['kycReject', IDS.partners.kycReject, '0319900003', 'Hộ kinh doanh Du lịch Bình Minh'],
  ]) {
    const account = ACCOUNTS[key];
    const licenseUrl = await ensureSeedPartnerKycDocument({ userId: account.id });
    await prisma.partnerProfile.create({
      data: {
        id: profileId,
        userId: account.id,
        businessName,
        businessLicenseUrl: licenseUrl,
        taxCode,
        registrationDate: new Date('2024-01-10T00:00:00.000Z'),
        representativeName: account.fullName,
        representativePhone: account.phone,
        businessAddress: 'Quận 1, Thành phố Hồ Chí Minh',
        bankName: 'Vietcombank',
        branchName: 'Chi nhánh TP. Hồ Chí Minh',
        bankAccountNumber: key === 'kycApprove' ? '012345678902' : '012345678903',
        bankAccountName: account.fullName.toLocaleUpperCase('vi-VN'),
        payoutCurrency: 'VND',
        description: 'Đơn vị lữ hành chuyên tổ chức các hành trình trải nghiệm trong nước.',
        kycConsentAccepted: true,
        kycConsentVersion: '2026-07-demo',
        kycConsentAcceptedAt: new Date(),
        kycConsentIpAddress: '127.0.0.1',
        status: 'PENDING',
      },
    });
  }
}

async function seedCatalog() {
  const categoryDefinitions = [
    ['Museum', 'Bảo tàng & Di sản', 'Không gian bảo tàng, di tích lịch sử và trải nghiệm tìm hiểu di sản.', 'museum'],
    ['Cultural Experience', 'Văn hóa & Trải nghiệm địa phương', 'Hoạt động văn hóa, nghệ thuật và trải nghiệm đời sống bản địa.', 'theater_comedy'],
    ['Adventure', 'Phiêu lưu & Đường thủy', 'Trải nghiệm vận động, khám phá ngoài trời và hoạt động đường thủy có kiểm soát an toàn.', 'sailing'],
    ['Nature & Sightseeing', 'Thiên nhiên & Tham quan', 'Điểm đến sinh thái, cảnh quan và chương trình khám phá thiên nhiên.', 'park'],
    ['Theme Park & Resort', 'Công viên giải trí & Nghỉ dưỡng', 'Công viên chủ đề, khu vui chơi và trải nghiệm nghỉ dưỡng dành cho gia đình.', 'attractions'],
    ['Amusement Park', 'Khu vui chơi', 'Hoạt động vui chơi và giải trí phù hợp cho gia đình, trẻ em và nhóm bạn.', 'mood'],
  ];
  const categories = {};
  for (const [legacyName, name, description, icon] of categoryDefinitions) {
    const [localized, legacy] = await Promise.all([
      prisma.category.findUnique({ where: { name } }),
      prisma.category.findUnique({ where: { name: legacyName } }),
    ]);
    if (localized && legacy && localized.id !== legacy.id) {
      const links = await prisma.attractionCategory.findMany({
        where: { categoryId: legacy.id },
        select: { attractionId: true },
      });
      if (links.length > 0) {
        await prisma.attractionCategory.createMany({
          data: links.map(({ attractionId }) => ({ attractionId, categoryId: localized.id })),
          skipDuplicates: true,
        });
      }
      await prisma.category.delete({ where: { id: legacy.id } });
    } else if (!localized && legacy) {
      await prisma.category.update({
        where: { id: legacy.id },
        data: { name },
      });
    }
    categories[legacyName] = await prisma.category.upsert({
      where: { name },
      update: {
        isActive: true,
        icon,
        description,
      },
      create: {
        name,
        icon,
        isActive: true,
        description,
      },
    });
  }

  await prisma.category.deleteMany({
    where: {
      name: { contains: 'Manual Test Category', mode: 'insensitive' },
      attractions: { none: {} },
    },
  });

  const tomorrowPlusThirty = dateOnly(addDateKeyDays(vietnamDateKey(), 30));
  await prisma.voucher.create({
    data: {
      id: `${PREFIX}voucher-demo15`,
      code: 'DEMO15',
      discountType: 'PERCENTAGE',
      discountValue: 15,
      maxDiscount: 100000,
      minSpend: 200000,
      expiryDate: tomorrowPlusThirty,
      isActive: true,
      usageLimit: 100,
      usedCount: 12,
    },
  });

  const attractionDefinitions = [
    {
      id: IDS.attractions.museum,
      title: 'Bảo tàng Thành phố Hồ Chí Minh',
      description: 'Không gian trưng bày lịch sử, văn hóa và quá trình hình thành đô thị Sài Gòn – Thành phố Hồ Chí Minh; phù hợp cho gia đình, học sinh và khách yêu di sản.',
      address: '65 Lý Tự Trọng, Quận 1', city: 'Hồ Chí Minh', district: 'Quận 1',
      latitude: 10.7765, longitude: 106.6994,
      openTime: '08:00', closeTime: '17:00', defaultCapacity: 180,
      recommendedVisitMinutes: 150, environment: 'INDOOR', isFullDay: false,
      requiresManualApproval: false,
      category: categories.Museum,
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Independence_Palace%2C_Ho_Chi_Minh_%28LRM_20230823_093633%29.jpg/1280px-Independence_Palace%2C_Ho_Chi_Minh_%28LRM_20230823_093633%29.jpg',
      tickets: [
        { id: IDS.tickets.museumAdult, name: 'Vé người lớn', type: 'ADULT', originalPrice: 150000, sellingPrice: 120000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 18 },
        { id: IDS.tickets.museumChild, name: 'Vé trẻ em', type: 'CHILD', originalPrice: 90000, sellingPrice: 60000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 6, maxAgeYears: 11, requiresAdult: true },
        { id: IDS.tickets.museumStudent, name: 'Vé học sinh – sinh viên', type: 'STUDENT', originalPrice: 120000, sellingPrice: 80000, refundPolicy: 'REFUND_WITH_FEE', refundFeeRate: 0.2, minAgeYears: 12 },
      ],
    },
    {
      id: IDS.attractions.cruise,
      title: 'Du thuyền Ngắm Hoàng hôn Sài Gòn',
      description: 'Hành trình ngắm hoàng hôn trên sông Sài Gòn, có hướng dẫn viên, nước uống và khu vực ngồi an toàn; booking cần đối tác xác nhận để bảo đảm tải trọng tàu.',
      address: 'Bến Bạch Đằng, Quận 1', city: 'Hồ Chí Minh', district: 'Quận 1',
      latitude: 10.7736, longitude: 106.7066,
      openTime: '08:00', closeTime: '22:00', defaultCapacity: 90,
      recommendedVisitMinutes: 120, environment: 'OUTDOOR', isFullDay: false,
      requiresManualApproval: true,
      category: categories.Adventure,
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Ho_Chi_Minh_City_Skyline_%28night%29.jpg/1280px-Ho_Chi_Minh_City_Skyline_%28night%29.jpg',
      tickets: [
        { id: IDS.tickets.cruiseAdult, name: 'Vé du thuyền người lớn', type: 'ADULT', originalPrice: 350000, sellingPrice: 280000, refundPolicy: 'REFUND_WITH_FEE', refundFeeRate: 0.3, minAgeYears: 12 },
        { id: IDS.tickets.cruiseFamily, name: 'Gói gia đình 2 người lớn + 2 trẻ em', type: 'FAMILY', originalPrice: 1050000, sellingPrice: 920000, refundPolicy: 'REFUND_WITH_FEE', refundFeeRate: 0.3, requiresAdult: true },
      ],
    },
    {
      id: IDS.attractions.eco,
      title: 'Khu Dự trữ Sinh quyển Cần Giờ',
      description: 'Chương trình sinh thái trọn ngày khám phá rừng ngập mặn Cần Giờ, giáo dục bảo tồn thiên nhiên và trải nghiệm tuyến tham quan có kiểm soát sức chứa.',
      address: 'Huyện Cần Giờ, Thành phố Hồ Chí Minh', city: 'Hồ Chí Minh', district: 'Cần Giờ',
      latitude: 10.4114, longitude: 106.9547,
      openTime: '07:00', closeTime: '18:00', defaultCapacity: 120,
      recommendedVisitMinutes: 480, environment: 'OUTDOOR', isFullDay: true,
      requiresManualApproval: false,
      category: categories['Nature & Sightseeing'],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Can_Gio_Mangrove_Forest.jpg/1280px-Can_Gio_Mangrove_Forest.jpg',
      tickets: [
        { id: IDS.tickets.ecoAdult, name: 'Tour sinh thái người lớn', type: 'ADULT', originalPrice: 600000, sellingPrice: 520000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 12 },
        { id: IDS.tickets.ecoChild, name: 'Tour sinh thái trẻ em', type: 'CHILD', originalPrice: 420000, sellingPrice: 360000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 6, maxAgeYears: 11, requiresAdult: true },
      ],
    },
  ];

  for (const attraction of attractionDefinitions) {
    await prisma.attraction.create({
      data: {
        id: attraction.id,
        partnerId: IDS.partners.owner,
        title: attraction.title,
        description: attraction.description,
        address: attraction.address,
        city: attraction.city,
        district: attraction.district,
        openTime: attraction.openTime,
        closeTime: attraction.closeTime,
        openDays: '1,1,1,1,1,1,1',
        defaultCapacity: attraction.defaultCapacity,
        requiresManualApproval: attraction.requiresManualApproval,
        recommendedVisitMinutes: attraction.recommendedVisitMinutes,
        environment: attraction.environment,
        isFullDay: attraction.isFullDay,
        latitude: attraction.latitude,
        longitude: attraction.longitude,
        status: 'APPROVED',
        publicationStatus: 'ACTIVE',
        operationalStatus: 'ACTIVE',
        publishedAt: new Date(),
        minTicketPrice: Math.min(...attraction.tickets.map((ticket) => ticket.sellingPrice)),
        categories: { create: { categoryId: attraction.category.id } },
        images: {
          create: {
            id: `${attraction.id}-image-primary`,
            imageUrl: attraction.imageUrl,
            isPrimary: true,
          },
        },
        ticketProducts: {
          create: attraction.tickets.map((ticket) => ({
            ...ticket,
            description: `${ticket.name}, sử dụng đúng ngày đã chọn.`,
            status: 'ACTIVE',
            refundFeeRate: ticket.refundFeeRate || 0,
            refundCutoffHours: 24,
            maxAgeYears: ticket.maxAgeYears || null,
            minHeightCm: null,
            maxHeightCm: null,
            requiresAdult: Boolean(ticket.requiresAdult),
          })),
        },
        timeSlots: {
          create: attraction.id === IDS.attractions.cruise
            ? [
                { id: `${attraction.id}-slot-1`, startTime: '16:30', endTime: '18:00', maxCapacity: 45, isActive: true },
                { id: `${attraction.id}-slot-2`, startTime: '18:30', endTime: '20:00', maxCapacity: 45, isActive: true },
              ]
            : [{ id: `${attraction.id}-slot-all-day`, startTime: attraction.openTime, endTime: attraction.closeTime, maxCapacity: attraction.defaultCapacity, isActive: true }],
        },
      },
    });
  }

  await prisma.specialDate.create({
    data: {
      id: `${PREFIX}special-date-cruise`,
      attractionId: IDS.attractions.cruise,
      date: dateOnly(addDateKeyDays(vietnamDateKey(), 14)),
      closed: true,
      note: 'Bảo trì tàu định kỳ.',
    },
  });

  const reviewDefinitions = [
    {
      id: IDS.attractions.pendingApprove,
      ticketId: IDS.tickets.pendingApprove,
      title: 'Không gian Văn hóa Áo dài Việt Nam',
      description: 'Không gian trải nghiệm lịch sử áo dài, quy trình may truyền thống và hoạt động chụp ảnh; hồ sơ đầy đủ đang chờ Admin phê duyệt để đưa lên sàn.',
      address: 'Quận 3, Thành phố Hồ Chí Minh',
      latitude: 10.7842, longitude: 106.6861,
      category: categories['Cultural Experience'],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Vietnamese_Ao_Dai.jpg/800px-Vietnamese_Ao_Dai.jpg',
      sellingPrice: 180000,
    },
    {
      id: IDS.attractions.pendingReject,
      ticketId: IDS.tickets.pendingReject,
      title: 'Trải nghiệm Chợ nổi Sài Gòn',
      description: 'Hồ sơ tour đường thủy đang chờ thẩm định về mô tả an toàn, lộ trình vận chuyển khách và điều kiện vận hành trước khi được phép mở bán.',
      address: 'Quận 8, Thành phố Hồ Chí Minh',
      latitude: 10.7386, longitude: 106.6808,
      category: categories.Adventure,
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Floating_market_Vietnam.jpg/1280px-Floating_market_Vietnam.jpg',
      sellingPrice: 250000,
    },
  ];

  for (const definition of reviewDefinitions) {
    const snapshot = buildSubmittedSnapshot({
      attractionId: definition.id,
      title: definition.title,
      description: definition.description,
      address: definition.address,
      city: 'Hồ Chí Minh',
      district: null,
      latitude: definition.latitude,
      longitude: definition.longitude,
      category: definition.category,
      imageUrl: definition.imageUrl,
      ticketId: definition.ticketId,
      ticketName: 'Vé trải nghiệm người lớn',
      sellingPrice: definition.sellingPrice,
    });
    await prisma.attraction.create({
      data: {
        id: definition.id,
        partnerId: IDS.partners.owner,
        title: definition.title,
        description: definition.description,
        address: definition.address,
        city: 'Hồ Chí Minh',
        openTime: '08:00', closeTime: '18:00', openDays: '1,1,1,1,1,1,1',
        defaultCapacity: 120,
        recommendedVisitMinutes: 180,
        environment: 'MIXED',
        latitude: definition.latitude, longitude: definition.longitude,
        status: 'PENDING', publicationStatus: 'PAUSED', operationalStatus: 'ACTIVE',
        revision: 1, submittedAt: new Date(), submittedData: snapshot,
        minTicketPrice: definition.sellingPrice,
        categories: { create: { categoryId: definition.category.id } },
        images: { create: { id: `${definition.id}-image-primary`, imageUrl: definition.imageUrl, isPrimary: true } },
        ticketProducts: { create: {
          id: definition.ticketId,
          name: 'Vé trải nghiệm người lớn', type: 'ADULT',
          description: 'Vé người lớn, áp dụng theo lịch vận hành.',
          originalPrice: definition.sellingPrice + 50000,
          sellingPrice: definition.sellingPrice,
          status: 'ACTIVE', refundPolicy: 'FREE_CANCELLATION', refundCutoffHours: 24,
          minAgeYears: 12,
        } },
        timeSlots: { create: {
          id: `${definition.id}-slot-review`, startTime: '08:00', endTime: '12:00', maxCapacity: 60, isActive: true,
        } },
      },
    });
  }

  await prisma.attraction.create({
    data: {
      id: IDS.attractions.suspended,
      partnerId: IDS.partners.owner,
      title: 'Khu vui chơi Ven sông Sài Gòn',
      description: 'Khu vui chơi ngoài trời ven sông với các hoạt động gia đình; hiện tạm ngừng vận hành để hoàn tất biện pháp khắc phục an toàn.',
      address: 'Thành phố Thủ Đức', city: 'Hồ Chí Minh', district: 'Thủ Đức',
      openTime: '08:00', closeTime: '20:00', openDays: '1,1,1,1,1,1,1',
      defaultCapacity: 150, recommendedVisitMinutes: 180, environment: 'OUTDOOR',
      latitude: 10.8021, longitude: 106.7501,
      status: 'APPROVED', publicationStatus: 'PAUSED', operationalStatus: 'SUSPENDED',
      publishedAt: new Date(),
      suspensionReason: 'Chờ bổ sung biên bản kiểm tra thiết bị an toàn.',
      suspendedAt: new Date(), suspendedById: IDS.users.admin,
      minTicketPrice: 190000,
      categories: { create: { categoryId: categories['Theme Park & Resort'].id } },
      images: { create: { id: `${IDS.attractions.suspended}-image-primary`, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Dam-sen-water-park-tuonglamphotos.jpg/1280px-Dam-sen-water-park-tuonglamphotos.jpg', isPrimary: true } },
      ticketProducts: { create: {
        id: IDS.tickets.suspended, name: 'Vé vui chơi trong ngày', type: 'ADULT',
        description: 'Vé trải nghiệm khu vui chơi.', originalPrice: 220000, sellingPrice: 190000,
        status: 'ACTIVE', refundPolicy: 'FREE_CANCELLATION', refundCutoffHours: 24,
      } },
      timeSlots: { create: { id: `${IDS.attractions.suspended}-slot`, startTime: '08:00', endTime: '20:00', maxCapacity: 150, isActive: true } },
    },
  });

  await prisma.attraction.create({
    data: {
      id: IDS.attractions.draft,
      partnerId: IDS.partners.owner,
      title: 'Tour Ẩm thực Chợ Lớn – Bản nháp',
      description: 'Tour đi bộ buổi tối khám phá ẩm thực Chợ Lớn cùng hướng dẫn viên địa phương và các món ăn đặc trưng.',
      address: 'Quận 5, Thành phố Hồ Chí Minh', city: 'Hồ Chí Minh', district: 'Quận 5',
      openTime: '17:00', closeTime: '21:00', openDays: '0,0,0,1,1,1,1',
      defaultCapacity: 40, recommendedVisitMinutes: 180, environment: 'MIXED',
      latitude: 10.7542, longitude: 106.6635,
      status: 'DRAFT', publicationStatus: 'PAUSED', operationalStatus: 'ACTIVE',
      minTicketPrice: 320000,
      categories: { create: { categoryId: categories['Cultural Experience'].id } },
      images: { create: { id: `${IDS.attractions.draft}-image-primary`, imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Binh_Tay_Market_2022.jpg/1280px-Binh_Tay_Market_2022.jpg', isPrimary: true } },
      ticketProducts: { create: {
        id: IDS.tickets.draft, name: 'Tour ẩm thực người lớn', type: 'ADULT',
        description: 'Tour đi bộ có hướng dẫn viên và món ăn mẫu.', originalPrice: 380000, sellingPrice: 320000,
        status: 'ACTIVE', refundPolicy: 'REFUND_WITH_FEE', refundFeeRate: 0.2, refundCutoffHours: 24,
      } },
      timeSlots: { create: { id: `${IDS.attractions.draft}-slot`, startTime: '17:00', endTime: '20:00', maxCapacity: 40, isActive: true } },
    },
  });

  await prisma.staffAttractionAssignment.createMany({
    data: [IDS.attractions.museum, IDS.attractions.cruise, IDS.attractions.eco].map((attractionId) => ({
      id: `${PREFIX}assignment-${attractionId.slice(PREFIX.length)}`,
      staffId: IDS.users.gateStaff,
      attractionId,
      createdById: IDS.users.partner,
    })),
  });

  return attractionDefinitions;
}

async function loadTicketCatalog() {
  const rows = await prisma.ticketProduct.findMany({
    where: { id: { startsWith: PREFIX } },
    include: {
      attraction: {
        include: {
          partner: { select: { commissionRate: true } },
          images: { where: { isPrimary: true }, take: 1 },
          timeSlots: { where: { isActive: true }, orderBy: { startTime: 'asc' } },
        },
      },
    },
  });
  return new Map(rows.map((ticket) => [ticket.id, ticket]));
}

function scenarioBookingDefinitions(todayKey) {
  return [
    {
      key: 'checkin-today', ticketId: IDS.tickets.museumAdult, offset: 0,
      quantity: 2, status: 'CONFIRMED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['VALID', 'VALID'],
      note: 'Đoàn gồm hai khách và có thể đến cổng vào ở hai thời điểm khác nhau.',
    },
    {
      key: 'already-checked-today', ticketId: IDS.tickets.museumStudent, offset: 0,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Khách đã hoàn tất lượt tham quan.',
    },
    {
      key: 'partner-approve', ticketId: IDS.tickets.cruiseAdult, offset: 2,
      timeSlotIndex: 0,
      quantity: 2, status: 'PENDING_PARTNER', reservationStatus: 'CONFIRMED',
      ticketStatuses: [],
      note: 'Khách ưu tiên vị trí ngồi gần cửa sổ nếu còn chỗ.',
    },
    {
      key: 'partner-reject', ticketId: IDS.tickets.cruiseAdult, offset: 3,
      timeSlotIndex: 1,
      quantity: 1, status: 'PENDING_PARTNER', reservationStatus: 'CONFIRMED',
      ticketStatuses: [],
      note: 'Khách cần xác nhận chỗ ngồi trước khi khởi hành.',
    },
    {
      key: 'review-create', ticketId: IDS.tickets.museumAdult, offset: -2,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Khách đã hoàn tất lượt tham quan.',
    },
    {
      key: 'review-reply', ticketId: IDS.tickets.museumAdult, offset: -5,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Khách đã hoàn tất lượt tham quan.',
    },
    {
      key: 'review-moderate', ticketId: IDS.tickets.cruiseAdult, offset: -6,
      timeSlotIndex: 0,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Khách đã hoàn tất chuyến đi.',
    },
    {
      key: 'refund-customer-create', ticketId: IDS.tickets.museumAdult, offset: 5,
      quantity: 2, status: 'CONFIRMED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['VALID', 'VALID'],
      note: 'Khách có thể cần thay đổi lịch vì lý do gia đình.',
    },
    {
      key: 'refund-approve', ticketId: IDS.tickets.museumAdult, offset: 6,
      quantity: 1, status: 'REFUND_REQUESTED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['VALID'],
      note: 'Khách đã cung cấp đầy đủ thông tin phục vụ đối soát hoàn tiền.',
    },
    {
      key: 'refund-reject', ticketId: IDS.tickets.museumAdult, offset: 7,
      quantity: 1, status: 'REFUND_REQUESTED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['VALID'],
      note: 'Khách đề nghị hủy do thay đổi kế hoạch cá nhân.',
    },
    {
      key: 'pending-payment', ticketId: IDS.tickets.ecoAdult, offset: 4,
      quantity: 1, status: 'PENDING_PAYMENT', reservationStatus: 'HELD',
      paymentStatus: 'PENDING', ticketStatuses: [],
      note: 'Khách chưa hoàn tất bước thanh toán.',
    },
    {
      key: 'reissue', ticketId: IDS.tickets.ecoAdult, offset: 8,
      quantity: 1, status: 'CONFIRMED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['VALID'],
      note: 'Khách báo không tìm thấy mã QR trong thư xác nhận.',
    },
    {
      key: 'refunded', ticketId: IDS.tickets.museumAdult, offset: -10,
      quantity: 1, status: 'REFUNDED', reservationStatus: 'CANCELLED',
      ticketStatuses: ['REFUNDED'],
      note: 'Yêu cầu hoàn tiền đã được xử lý.',
    },
    {
      key: 'no-show', ticketId: IDS.tickets.cruiseAdult, offset: -1,
      timeSlotIndex: 1,
      quantity: 1, status: 'NO_SHOW', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['EXPIRED'],
      note: 'Khách không đến trong khung giờ đã đặt.',
    },
    {
      key: 'cancelled', ticketId: IDS.tickets.ecoAdult, offset: 9,
      quantity: 1, status: 'CANCELLED', reservationStatus: 'CANCELLED',
      paymentStatus: 'FAILED', ticketStatuses: [],
      note: 'Đơn đã tự động hủy do giao dịch không hoàn tất.',
    },
  ].map((definition) => ({
    ...definition,
    visitDateKey: addDateKeyDays(todayKey, definition.offset),
  }));
}

async function createScenarioBooking(definition, ticket) {
  const publicReference = SCENARIO_BOOKING_REFERENCES[definition.key];
  const id = scenarioBookingId(definition.key);
  const reservationId = `${PREFIX}reservation-${publicReference}`;
  const paymentId = `${PREFIX}payment-${publicReference}`;
  const unitPrice = money(ticket.sellingPrice);
  const subtotal = unitPrice * definition.quantity;
  const discount = definition.key === 'pending-payment' ? 100000 : 0;
  const total = Math.max(0, subtotal - discount);
  const commissionRate = Number(ticket.attraction.partner.commissionRate || 0.1);
  const { commission, partnerNet } = commissionAmounts(total, commissionRate);
  const visitDate = dateOnly(definition.visitDateKey);
  const now = new Date();
  const createdAt = definition.offset < 0
    ? new Date(visitDate.getTime() - 5 * DAY_MS)
    : new Date(now.getTime() - 30 * 60 * 1000);
  const paidAt = definition.status === 'PENDING_PARTNER'
    ? now
    : new Date(createdAt.getTime() + 5 * 60 * 1000);
  const paymentStatus = definition.paymentStatus
    || (definition.status === 'PENDING_PAYMENT' ? 'PENDING' : 'SUCCESS');
  const selectedTimeSlot = Number.isInteger(definition.timeSlotIndex)
    ? ticket.attraction.timeSlots?.[definition.timeSlotIndex] || null
    : null;

  await prisma.reservation.create({
    data: {
      id: reservationId,
      userId: IDS.users.customer,
      ticketProductId: ticket.id,
      timeSlotId: selectedTimeSlot?.id || null,
      date: visitDate,
      quantity: definition.quantity,
      status: definition.reservationStatus,
      expiresAt: definition.reservationStatus === 'HELD'
        ? new Date(now.getTime() + 30 * 60 * 1000)
        : new Date(createdAt.getTime() + 15 * 60 * 1000),
      paymentDeadline: definition.status === 'PENDING_PAYMENT'
        ? new Date(now.getTime() + 30 * 60 * 1000)
        : null,
      paymentAttemptCount: definition.status === 'PENDING_PAYMENT' ? 1 : 0,
      snapshotUnitPrice: unitPrice,
      snapshotRefundPolicy: ticket.refundPolicy,
      snapshotRefundFeeRate: ticket.refundFeeRate,
      snapshotRefundCutoffHours: ticket.refundCutoffHours,
      snapshotCommissionRate: commissionRate,
      createdAt,
    },
  });

  await prisma.booking.create({
    data: {
      id,
      userId: IDS.users.customer,
      reservationId,
      voucherId: definition.key === 'pending-payment' ? `${PREFIX}voucher-demo15` : null,
      subtotalAmount: subtotal,
      discountAmount: discount,
      totalAmount: total,
      status: definition.status,
      refundRequired: definition.status === 'REFUND_REQUESTED',
      paymentMethod: 'vnpay',
      fullName: ACCOUNTS.customer.fullName,
      email: ACCOUNTS.customer.email,
      phone: ACCOUNTS.customer.phone,
      note: definition.note,
      snapshotAt: createdAt,
      snapshotAttractionId: ticket.attraction.id,
      snapshotAttractionTitle: ticket.attraction.title,
      snapshotAttractionAddress: ticket.attraction.address,
      snapshotAttractionCity: ticket.attraction.city,
      snapshotAttractionDistrict: ticket.attraction.district,
      snapshotAttractionImage: ticket.attraction.images[0]?.imageUrl || null,
      snapshotTicketName: ticket.name,
      snapshotTicketType: ticket.type,
      snapshotTicketDescription: ticket.description,
      snapshotUnitPrice: unitPrice,
      snapshotRefundPolicy: ticket.refundPolicy,
      snapshotRefundFeeRate: ticket.refundFeeRate,
      snapshotRefundCutoffHours: ticket.refundCutoffHours,
      snapshotVisitDate: visitDate,
      snapshotTimeSlotLabel: selectedTimeSlot
        ? `${selectedTimeSlot.startTime} – ${selectedTimeSlot.endTime}`
        : null,
      commissionRateSnapshot: commissionRate,
      commissionAmountSnapshot: commission,
      partnerNetAmountSnapshot: partnerNet,
      cancelledAt: definition.status === 'CANCELLED' ? now : null,
      cancellationReason: definition.status === 'CANCELLED'
        ? 'Thanh toán không hoàn tất trong thời hạn giữ chỗ.'
        : null,
      cancellationSource: definition.status === 'CANCELLED' ? 'PAYMENT_TIMEOUT' : null,
      createdAt,
    },
  });

  await prisma.payment.create({
    data: {
      id: paymentId,
      bookingId: id,
      amount: total,
      paymentGateway: 'VNPAY',
      transactionId: paymentStatus === 'SUCCESS'
        ? gatewayReference(`scenario-payment-${definition.key}`)
        : null,
      status: paymentStatus,
      expiresAt: paymentStatus === 'PENDING' ? new Date(now.getTime() + 30 * 60 * 1000) : null,
      paidAt: paymentStatus === 'SUCCESS' ? paidAt : null,
      failureReason: paymentStatus === 'FAILED' ? 'Khách hàng không hoàn tất giao dịch trong thời hạn thanh toán.' : null,
      rawResponse: {
        source: 'defense_demo_fixture',
        disclaimer: 'Dữ liệu mô phỏng local, không phải giao dịch ngân hàng thật.',
      },
      createdAt,
    },
  });

  if (definition.ticketStatuses.length > 0) {
    await prisma.ticketInstance.createMany({
      data: definition.ticketStatuses.map((status, index) => ({
        id: `${PREFIX}ticket-instance-${publicReference}${String(index + 1).padStart(2, '0')}`,
        bookingId: id,
        ticketProductId: ticket.id,
        qrCodeToken: definition.key === 'checkin-today'
          ? `DEMOQR-CHECKIN-${String(index + 1).padStart(2, '0')}`
          : `DEMOQR-${definition.key.toUpperCase()}-${index + 1}`,
        status,
        checkedInAt: definition.checkedIn ? atVietnamTime(definition.visitDateKey, 10, 0) : null,
        checkedInById: definition.checkedIn ? IDS.users.gateStaff : null,
        createdAt,
      })),
    });
  }

  return {
    ...definition,
    id,
    reservationId,
    paymentId,
    ticket,
    total,
    subtotal,
    commission,
    partnerNet,
    timeSlotId: selectedTimeSlot?.id || null,
  };
}

async function seedScenarioBookings() {
  const todayKey = vietnamDateKey();
  const tickets = await loadTicketCatalog();
  const definitions = scenarioBookingDefinitions(todayKey);
  const created = [];
  for (const definition of definitions) {
    const ticket = tickets.get(definition.ticketId);
    if (!ticket) throw new Error(`Không tìm thấy ticket demo ${definition.ticketId}.`);
    created.push(await createScenarioBooking(definition, ticket));
  }

  const byKey = new Map(created.map((booking) => [booking.key, booking]));

  await prisma.refundRequest.createMany({
    data: [
      {
        id: scenarioRefundRequestId('approve'),
        bookingId: byKey.get('refund-approve').id,
        requestKey: `${PREFIX}refund-request-key-approve`,
        requestedById: IDS.users.customer,
        type: 'CUSTOMER_CANCELLATION',
        mandatory: false,
        reason: 'Gia đình thay đổi lịch trình và gửi yêu cầu trước thời hạn miễn phí.',
        originalAmount: byKey.get('refund-approve').total,
        amount: byKey.get('refund-approve').total,
        feeAmount: 0,
        policySnapshot: 'FREE_CANCELLATION',
        feeRateSnapshot: 0,
        bookingStatusBeforeRequest: 'CONFIRMED',
        status: 'PENDING',
      },
      {
        id: scenarioRefundRequestId('reject'),
        bookingId: byKey.get('refund-reject').id,
        requestKey: `${PREFIX}refund-request-key-reject`,
        requestedById: IDS.users.customer,
        type: 'CUSTOMER_CANCELLATION',
        mandatory: false,
        reason: 'Khách thay đổi kế hoạch nhưng chưa cung cấp đủ thông tin xác nhận.',
        originalAmount: byKey.get('refund-reject').total,
        amount: byKey.get('refund-reject').total,
        feeAmount: 0,
        policySnapshot: 'FREE_CANCELLATION',
        feeRateSnapshot: 0,
        bookingStatusBeforeRequest: 'CONFIRMED',
        status: 'PENDING',
      },
      {
        id: scenarioRefundRequestId('completed'),
        bookingId: byKey.get('refunded').id,
        requestKey: `${PREFIX}refund-request-key-completed`,
        requestedById: IDS.users.customer,
        type: 'CUSTOMER_CANCELLATION',
        mandatory: false,
        reason: 'Yêu cầu đã được xử lý hoàn tất trong lịch sử.',
        originalAmount: byKey.get('refunded').total,
        amount: byKey.get('refunded').total,
        feeAmount: 0,
        policySnapshot: 'FREE_CANCELLATION',
        feeRateSnapshot: 0,
        bookingStatusBeforeRequest: 'CONFIRMED',
        status: 'APPROVED',
        staffNotes: 'Đã đối soát và hoàn tiền thành công.',
        processedById: IDS.users.platformStaff,
        processedAt: new Date(),
      },
    ],
  });

  await prisma.refundTransaction.createMany({
    data: [
      {
        id: `${PREFIX}refund-transaction-pre-reconciled`,
        bookingId: byKey.get('refund-approve').id,
        paymentId: byKey.get('refund-approve').paymentId,
        refundRequestId: scenarioRefundRequestId('approve'),
        gateway: 'VNPAY',
        gatewayRequestId: `${PREFIX}gateway-refund-approve`,
        transactionType: '02',
        amount: byKey.get('refund-approve').total,
        status: 'SUCCESS',
        reason: 'VNPay đã trả kết quả thành công; nhân viên hoàn tất bước ghi nhận trên hệ thống.',
        rawResponse: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', demo: true },
        gatewayResponseCode: '00',
        gatewayTransactionStatus: '00',
        gatewayTransactionId: gatewayReference('refund-approved'),
        submittedAt: new Date(),
        reconciledAt: new Date(),
        processedAt: new Date(),
      },
      {
        id: `${PREFIX}refund-transaction-completed`,
        bookingId: byKey.get('refunded').id,
        paymentId: byKey.get('refunded').paymentId,
        refundRequestId: scenarioRefundRequestId('completed'),
        gateway: 'VNPAY',
        gatewayRequestId: `${PREFIX}gateway-refund-completed`,
        transactionType: '02',
        amount: byKey.get('refunded').total,
        status: 'SUCCESS',
        reason: 'Giao dịch hoàn tiền lịch sử.',
        gatewayResponseCode: '00', gatewayTransactionStatus: '00',
        gatewayTransactionId: gatewayReference('refund-history'),
        processedById: IDS.users.platformStaff,
        submittedAt: new Date(), reconciledAt: new Date(), processedAt: new Date(),
      },
    ],
  });

  await prisma.review.createMany({
    data: [
      {
        id: `${PREFIX}review-awaiting-partner`,
        userId: IDS.users.customer,
        attractionId: IDS.attractions.museum,
        bookingId: byKey.get('review-reply').id,
        rating: 5,
        comment: 'Không gian trưng bày dễ hiểu, nhân viên hướng dẫn chu đáo. Gia đình tôi sẽ quay lại.',
        isHidden: false,
      },
      {
        id: `${PREFIX}review-awaiting-moderation`,
        userId: IDS.users.customer,
        attractionId: IDS.attractions.cruise,
        bookingId: byKey.get('review-moderate').id,
        rating: 2,
        comment: 'Bài đánh giá chứa lời lẽ công kích và thông tin liên hệ cá nhân của hướng dẫn viên.',
        isHidden: false,
      },
    ],
  });
  await prisma.attraction.update({
    where: { id: IDS.attractions.museum },
    data: { averageRating: 5, totalReviews: 1 },
  });
  await prisma.attraction.update({
    where: { id: IDS.attractions.cruise },
    data: { averageRating: 2, totalReviews: 1 },
  });

  return created;
}

async function seedInventory(scenarioBookings) {
  const ticketByDate = new Map();
  const attractionByDate = new Map();
  const timeSlotByDate = new Map();

  for (const booking of scenarioBookings) {
    if (booking.offset < 0 || booking.reservationStatus === 'CANCELLED') continue;
    const isHeld = booking.reservationStatus === 'HELD';
    const isBooked = booking.reservationStatus === 'CONFIRMED'
      && !['REFUNDED', 'CANCELLED'].includes(booking.status);
    if (!isHeld && !isBooked) continue;

    const ticketKey = `${booking.ticket.id}|${booking.visitDateKey}`;
    const attractionKey = `${booking.ticket.attraction.id}|${booking.visitDateKey}`;
    const ticketRow = ticketByDate.get(ticketKey) || {
      ticketProductId: booking.ticket.id,
      date: dateOnly(booking.visitDateKey),
      capacity: booking.ticket.attraction.defaultCapacity,
      bookedQuantity: 0,
      heldQuantity: 0,
    };
    const attractionRow = attractionByDate.get(attractionKey) || {
      attractionId: booking.ticket.attraction.id,
      date: dateOnly(booking.visitDateKey),
      capacity: booking.ticket.attraction.defaultCapacity,
      bookedQty: 0,
      heldQty: 0,
    };
    const timeSlotKey = booking.timeSlotId
      ? `${booking.timeSlotId}|${booking.visitDateKey}`
      : null;
    const timeSlotRow = timeSlotKey
      ? timeSlotByDate.get(timeSlotKey) || {
          timeSlotId: booking.timeSlotId,
          date: dateOnly(booking.visitDateKey),
          bookedQty: 0,
          heldQty: 0,
        }
      : null;
    if (isHeld) {
      ticketRow.heldQuantity += booking.quantity;
      attractionRow.heldQty += booking.quantity;
      if (timeSlotRow) timeSlotRow.heldQty += booking.quantity;
    } else {
      ticketRow.bookedQuantity += booking.quantity;
      attractionRow.bookedQty += booking.quantity;
      if (timeSlotRow) timeSlotRow.bookedQty += booking.quantity;
    }
    ticketByDate.set(ticketKey, ticketRow);
    attractionByDate.set(attractionKey, attractionRow);
    if (timeSlotKey) timeSlotByDate.set(timeSlotKey, timeSlotRow);
  }

  if (ticketByDate.size > 0) {
    await prisma.dailyStock.createMany({ data: [...ticketByDate.values()] });
  }
  if (attractionByDate.size > 0) {
    await prisma.attractionDailyStock.createMany({ data: [...attractionByDate.values()] });
  }
  if (timeSlotByDate.size > 0) {
    await prisma.timeSlotStock.createMany({ data: [...timeSlotByDate.values()] });
  }
}

async function seedForecastHistory(attractionDefinitions) {
  const ticketIds = [
    IDS.tickets.museumAdult,
    IDS.tickets.cruiseAdult,
    IDS.tickets.ecoAdult,
  ];
  const ticketPrices = new Map([
    [IDS.tickets.museumAdult, 120000],
    [IDS.tickets.cruiseAdult, 280000],
    [IDS.tickets.ecoAdult, 520000],
  ]);
  const endKey = addDateKeyDays(vietnamDateKey(), -1);
  const startKey = addDateKeyDays(endKey, -(HISTORY_DAYS - 1));
  const reservations = [];
  const bookings = [];
  const payments = [];
  const ticketInstances = [];

  for (let dayIndex = 0; dayIndex < HISTORY_DAYS; dayIndex += 1) {
    const visitDateKey = addDateKeyDays(startKey, dayIndex);
    const visitDate = dateOnly(visitDateKey);
    const weekday = visitDate.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    for (let attractionIndex = 0; attractionIndex < attractionDefinitions.length; attractionIndex += 1) {
      const attraction = attractionDefinitions[attractionIndex];
      const ticketId = ticketIds[attractionIndex];
      const price = ticketPrices.get(ticketId);
      const demandWave = Math.sin((dayIndex + attractionIndex * 4) / 8) > 0 ? 1 : 0;
      const quantity = Math.min(4, 1 + (weekend ? 1 : 0) + demandWave);
      const suffix = `${attractionIndex + 1}-${visitDateKey.replaceAll('-', '')}`;
      const publicReference = String(270000000001 + dayIndex * attractionDefinitions.length + attractionIndex);
      const reservationId = `${PREFIX}history-reservation-${publicReference}`;
      const bookingId = `${PREFIX}history-booking-${publicReference}`;
      const paymentId = `${PREFIX}history-payment-${publicReference}`;
      const createdAt = new Date(visitDate.getTime() - (7 + attractionIndex) * DAY_MS);
      const subtotal = price * quantity;
      const { commission, partnerNet } = commissionAmounts(subtotal, 0.1);
      const noShow = (dayIndex + attractionIndex * 7) % 37 === 0;

      reservations.push({
        id: reservationId,
        userId: IDS.users.forecastCustomer,
        ticketProductId: ticketId,
        date: visitDate,
        quantity,
        status: 'CONFIRMED',
        expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
        snapshotUnitPrice: price,
        snapshotRefundPolicy: 'FREE_CANCELLATION',
        snapshotRefundFeeRate: 0,
        snapshotRefundCutoffHours: 24,
        snapshotCommissionRate: 0.1,
        createdAt,
      });
      bookings.push({
        id: bookingId,
        userId: IDS.users.forecastCustomer,
        reservationId,
        subtotalAmount: subtotal,
        discountAmount: 0,
        totalAmount: subtotal,
        status: noShow ? 'NO_SHOW' : 'COMPLETED',
        paymentMethod: 'vnpay',
        fullName: ACCOUNTS.forecastCustomer.fullName,
        email: ACCOUNTS.forecastCustomer.email,
        phone: ACCOUNTS.forecastCustomer.phone,
        note: 'Đơn đặt vé trực tuyến.',
        snapshotAt: createdAt,
        snapshotAttractionId: attraction.id,
        snapshotAttractionTitle: attraction.title,
        snapshotAttractionAddress: attraction.address,
        snapshotAttractionCity: attraction.city,
        snapshotAttractionDistrict: attraction.district,
        snapshotAttractionImage: attraction.imageUrl,
        snapshotTicketName: attraction.tickets[0].name,
        snapshotTicketType: attraction.tickets[0].type,
        snapshotTicketDescription: 'Gói vé tiêu chuẩn đã bao gồm quyền vào cửa.',
        snapshotUnitPrice: price,
        snapshotRefundPolicy: 'FREE_CANCELLATION',
        snapshotRefundFeeRate: 0,
        snapshotRefundCutoffHours: 24,
        snapshotVisitDate: visitDate,
        commissionRateSnapshot: 0.1,
        commissionAmountSnapshot: commission,
        partnerNetAmountSnapshot: partnerNet,
        createdAt,
      });
      payments.push({
        id: paymentId,
        bookingId,
        amount: subtotal,
        paymentGateway: 'VNPAY',
        transactionId: gatewayReference(`history-payment-${suffix}`),
        status: 'SUCCESS',
        paidAt: new Date(createdAt.getTime() + 5 * 60 * 1000),
        rawResponse: { source: 'demo_booking_history', disclaimer: 'Không phải giao dịch thật.' },
        createdAt,
      });
      for (let index = 0; index < quantity; index += 1) {
        ticketInstances.push({
          id: `${PREFIX}history-ticket-${publicReference}${String(index + 1).padStart(2, '0')}`,
          bookingId,
          ticketProductId: ticketId,
          qrCodeToken: `DEFHISTQR-${suffix}-${index + 1}`,
          status: noShow ? 'EXPIRED' : 'USED',
          checkedInAt: noShow ? null : atVietnamTime(visitDateKey, 10, 0),
          checkedInById: noShow ? null : IDS.users.gateStaff,
          createdAt,
        });
      }
    }
  }

  await prisma.reservation.createMany({ data: reservations });
  await prisma.booking.createMany({ data: bookings });
  await prisma.payment.createMany({ data: payments });
  await prisma.ticketInstance.createMany({ data: ticketInstances });

  return bookings;
}

async function seedSettlements(historyBookings) {
  const selected = historyBookings.slice(-6);
  const groups = [selected.slice(0, 2), selected.slice(2, 4), selected.slice(4, 6)];
  const statuses = ['DRAFT', 'APPROVED', 'PAID'];
  const now = new Date();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const rows = groups[groupIndex];
    const status = statuses[groupIndex];
    const grossAmount = rows.reduce((sum, row) => sum + money(row.totalAmount), 0);
    const commissionAmount = rows.reduce(
      (sum, row) => sum + money(row.commissionAmountSnapshot),
      0,
    );
    const payableAmount = rows.reduce(
      (sum, row) => sum + money(row.partnerNetAmountSnapshot),
      0,
    );
    const settlementId = `${PREFIX}settlement-${status.toLowerCase()}`;

    await prisma.partnerSettlement.create({
      data: {
        id: settlementId,
        partnerId: IDS.partners.owner,
        periodStart: dateOnly(addDateKeyDays(vietnamDateKey(), -90 + groupIndex * 30)),
        periodEnd: dateOnly(addDateKeyDays(vietnamDateKey(), -61 + groupIndex * 30)),
        status,
        currency: 'VND',
        grossAmount,
        refundAmount: 0,
        netAmount: grossAmount,
        commissionAmount,
        payableAmount,
        bookingCount: rows.length,
        bankNameSnapshot: 'Vietcombank',
        bankAccountNameSnapshot: 'CONG TY DU LICH TRAI NGHIEM VIET',
        bankAccountLast4Snapshot: '8901',
        createdById: IDS.users.admin,
        approvedById: status !== 'DRAFT' ? IDS.users.admin : null,
        approvedAt: status !== 'DRAFT' ? now : null,
        paidById: status === 'PAID' ? IDS.users.admin : null,
        paidAt: status === 'PAID' ? now : null,
        bankReference: status === 'PAID'
          ? `VCB-${vietnamDateKey(now).replaceAll('-', '')}-0001`
          : null,
        items: {
          create: rows.map((row, rowIndex) => ({
            id: `${settlementId}-item-${rowIndex + 1}`,
            bookingId: row.id,
            grossAmount: row.totalAmount,
            refundAmount: 0,
            netAmount: row.totalAmount,
            commissionAmount: row.commissionAmountSnapshot,
            payableAmount: row.partnerNetAmountSnapshot,
            releasedAt: status === 'PAID' ? now : null,
          })),
        },
      },
    });
  }
}

async function seedSupportAndCustomerFeatures(scenarioBookings) {
  const byKey = new Map(scenarioBookings.map((booking) => [booking.key, booking]));

  await prisma.favoriteAttraction.createMany({
    data: [IDS.attractions.museum, IDS.attractions.cruise, IDS.attractions.eco].map(
      (attractionId) => ({ userId: IDS.users.customer, attractionId }),
    ),
  });

  await prisma.savedItinerary.create({
    data: {
      id: `${PREFIX}saved-itinerary`,
      userId: IDS.users.customer,
      planId: `${PREFIX}saigon-2-days`,
      title: 'Hồ Chí Minh 2 ngày: di sản và sinh thái',
      criteria: {
        city: 'Hồ Chí Minh', days: 2, adults: 2, children: 1,
        budget: 3000000, interests: 'Văn hóa, bảo tàng, thiên nhiên',
        pace: 'normal', companion: 'family',
      },
      data: {
        clientPlanId: `${PREFIX}saigon-2-days`,
        title: 'Hồ Chí Minh 2 ngày: di sản và sinh thái',
        description: 'Lịch trình cân bằng giữa trải nghiệm văn hóa nội đô và khám phá hệ sinh thái Cần Giờ.',
        startDate: addDateKeyDays(vietnamDateKey(), 1),
        availabilityChecked: true,
        availabilityCheckedAt: new Date().toISOString(),
        totalEstimatedCost: 2700000,
        estimatedCost: {
          total: 2700000,
          perPerson: 900000,
          note: 'Ước tính cho 2 người lớn và 1 trẻ em; giá và tồn vé được kiểm tra lại trước khi giữ chỗ.',
        },
        tips: [
          'Có mặt trước giờ khởi hành du thuyền ít nhất 20 phút.',
          'Chuẩn bị nước uống, kem chống nắng và giày đi bộ cho ngày tham quan Cần Giờ.',
        ],
        days: [
          {
            day: 1,
            visitDate: addDateKeyDays(vietnamDateKey(), 1),
            title: 'Di sản và sông Sài Gòn',
            activities: [
              {
                attractionId: IDS.attractions.museum,
                title: 'Bảo tàng Thành phố Hồ Chí Minh',
                suggestedTime: '09:00', durationMinutes: 150,
                latitude: 10.7765, longitude: 106.6994,
                estimatedCost: 300000,
                ticketItems: [
                  {
                    ticketId: IDS.tickets.museumAdult,
                    ticketName: 'Vé người lớn',
                    quantity: 2,
                    unitPrice: 120000,
                    suggestedTimeSlot: {
                      timeSlotId: `${IDS.attractions.museum}-slot-all-day`,
                      startTime: '08:00',
                      endTime: '17:00',
                    },
                  },
                  {
                    ticketId: IDS.tickets.museumChild,
                    ticketName: 'Vé trẻ em',
                    quantity: 1,
                    unitPrice: 60000,
                    suggestedTimeSlot: {
                      timeSlotId: `${IDS.attractions.museum}-slot-all-day`,
                      startTime: '08:00',
                      endTime: '17:00',
                    },
                  },
                ],
              },
              {
                attractionId: IDS.attractions.cruise,
                title: 'Du thuyền Ngắm Hoàng hôn Sài Gòn',
                suggestedTime: '16:30', durationMinutes: 120,
                latitude: 10.7736, longitude: 106.7066,
                estimatedCost: 840000,
                ticketItems: [{
                  ticketId: IDS.tickets.cruiseAdult,
                  ticketName: 'Vé du thuyền người lớn',
                  quantity: 3,
                  unitPrice: 280000,
                  suggestedTimeSlot: {
                    timeSlotId: `${IDS.attractions.cruise}-slot-1`,
                    startTime: '16:30',
                    endTime: '18:00',
                  },
                }],
              },
            ],
            alternatives: [],
          },
          {
            day: 2,
            visitDate: addDateKeyDays(vietnamDateKey(), 2),
            title: 'Hệ sinh thái Cần Giờ',
            activities: [
              {
                attractionId: IDS.attractions.eco,
                title: 'Khu Dự trữ Sinh quyển Cần Giờ',
                suggestedTime: '07:30', durationMinutes: 480,
                latitude: 10.4114, longitude: 106.9547,
                estimatedCost: 1560000,
                ticketItems: [{
                  ticketId: IDS.tickets.ecoAdult,
                  ticketName: 'Tour sinh thái người lớn',
                  quantity: 3,
                  unitPrice: 520000,
                  suggestedTimeSlot: {
                    timeSlotId: `${IDS.attractions.eco}-slot-all-day`,
                    startTime: '07:00',
                    endTime: '18:00',
                  },
                }],
              },
            ],
            alternatives: [],
          },
        ],
      },
    },
  });

  await prisma.newsletterSubscription.create({
    data: {
      id: `${PREFIX}newsletter`,
      email: 'demo.newsletter@vietticket.local',
      isActive: true,
    },
  });

  await prisma.supportTicket.create({
    data: {
      id: `${PREFIX}support-open`,
      userId: IDS.users.customer,
      bookingId: byKey.get('checkin-today').id,
      subject: 'Cần hỗ trợ nhận diện mã QR tại cổng',
      description: 'Gia đình có hai vé nhưng sẽ đến cổng ở hai thời điểm khác nhau. Xin hướng dẫn cách check-in từng vé.',
      status: 'OPEN',
      priority: 'URGENT',
      messages: {
        create: {
          id: `${PREFIX}support-message-open-1`,
          senderId: IDS.users.customer,
          message: 'Nhờ bộ phận hỗ trợ xác nhận mỗi mã QR chỉ dùng cho một người và có thể quét tách lượt.',
        },
      },
    },
  });

  await prisma.supportTicket.create({
    data: {
      id: `${PREFIX}support-in-progress`,
      userId: IDS.users.customer,
      bookingId: byKey.get('refund-customer-create').id,
      subject: 'Hỏi về thời hạn hoàn tiền',
      description: 'Khách muốn biết số tiền và thời gian xử lý nếu hủy trước ngày tham quan.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: IDS.users.platformStaff,
      assignedAt: new Date(),
      firstRespondedAt: new Date(),
      messages: {
        create: [
          {
            id: `${PREFIX}support-message-progress-1`,
            senderId: IDS.users.customer,
            message: 'Tôi muốn kiểm tra chính sách trước khi gửi yêu cầu hủy.',
            createdAt: new Date(Date.now() - 30 * 60 * 1000),
          },
          {
            id: `${PREFIX}support-message-progress-2`,
            senderId: IDS.users.platformStaff,
            message: 'Vé áp dụng hủy miễn phí trước hạn. Hệ thống sẽ hiển thị preview số tiền trước khi xác nhận.',
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
          },
        ],
      },
    },
  });

  await prisma.supportTicket.create({
    data: {
      id: `${PREFIX}support-resolved`,
      userId: IDS.users.customer,
      subject: 'Cập nhật thông tin người nhận vé',
      description: 'Khách đã nhận được thư xác nhận và đồng ý đóng yêu cầu hỗ trợ.',
      status: 'RESOLVED',
      priority: 'NORMAL',
      assignedToId: IDS.users.platformStaff,
      assignedAt: new Date(),
      firstRespondedAt: new Date(),
      resolvedAt: new Date(),
      resolutionCode: 'INFORMATION_UPDATED',
      resolutionNote: 'Đã hướng dẫn khách sử dụng thông tin snapshot trên booking.',
      messages: {
        create: {
          id: `${PREFIX}support-message-resolved-1`,
          senderId: IDS.users.platformStaff,
          message: 'Yêu cầu đã được giải quyết. Cảm ơn bạn đã sử dụng VietTicket Travel.',
        },
      },
    },
  });
}

async function seedAuditLogs() {
  await prisma.auditLog.createMany({
    data: [
      {
        id: `${PREFIX}audit-partner-approved`, actorId: IDS.users.admin,
        action: 'PARTNER_KYC_APPROVED', entityType: 'PartnerProfile', entityId: IDS.partners.owner,
        ipAddress: '127.0.0.1', userAgent: 'VietTicket Admin Portal',
        metadata: { businessName: 'Công ty Du lịch Trải nghiệm Việt' },
        createdAt: new Date(Date.now() - 3 * DAY_MS),
      },
      {
        id: `${PREFIX}audit-attraction-published`, actorId: IDS.users.admin,
        action: 'ATTRACTION_PUBLISHED', entityType: 'Attraction', entityId: IDS.attractions.museum,
        ipAddress: '127.0.0.1', userAgent: 'VietTicket Admin Portal',
        metadata: { trangThaiPhatHanh: 'Đang mở bán' },
        createdAt: new Date(Date.now() - 2 * DAY_MS),
      },
      {
        id: `${PREFIX}audit-ticket-checked-in`, actorId: IDS.users.gateStaff,
        action: 'TICKET_CHECKED_IN', entityType: 'Booking', entityId: scenarioBookingId('already-checked-today'),
        ipAddress: '127.0.0.1', userAgent: 'VietTicket Admin Portal',
        metadata: { soVeDaCheckIn: 1 },
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    ],
  });
}

async function prepareForecastCache() {
  const { getForecastForAttraction } = require('../src/services/forecastService');
  const results = [];
  for (const attractionId of [
    IDS.attractions.museum,
    IDS.attractions.cruise,
    IDS.attractions.eco,
  ]) {
    try {
      const result = await getForecastForAttraction(attractionId, {
        forecastDays: 7,
        forceRefresh: true,
      });
      results.push({
        attractionId,
        method: result.method,
        trainingSource: result.trainingSource,
        points: result.forecast.length,
      });
    } catch (error) {
      results.push({ attractionId, error: error.message });
    }
  }
  return results;
}

async function collectDemoReadiness() {
  const today = dateOnly(vietnamDateKey());
  const [
    accounts,
    pendingKyc,
    pendingAttractions,
    scenarioBookings,
    todayValidTickets,
    pendingRefunds,
    actionableSupport,
    visibleReviews,
    settlements,
    partnerAssignments,
    forecasts,
  ] = await Promise.all([
    prisma.user.count({ where: { id: { in: Object.values(IDS.users) } } }),
    prisma.partnerProfile.count({ where: { id: { in: [IDS.partners.kycApprove, IDS.partners.kycReject] }, status: 'PENDING' } }),
    prisma.attraction.count({ where: { id: { in: [IDS.attractions.pendingApprove, IDS.attractions.pendingReject] }, status: 'PENDING' } }),
    prisma.booking.count({ where: { id: { startsWith: `${PREFIX}booking-` } } }),
    prisma.ticketInstance.count({
      where: {
        status: 'VALID',
        booking: { reservation: { date: today } },
        ticketProduct: { attractionId: IDS.attractions.museum },
      },
    }),
    prisma.refundRequest.count({ where: { id: { startsWith: PREFIX }, status: 'PENDING' } }),
    prisma.supportTicket.count({ where: { id: { startsWith: PREFIX }, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.review.count({ where: { id: { startsWith: PREFIX }, isHidden: false } }),
    prisma.partnerSettlement.groupBy({
      by: ['status'], where: { id: { startsWith: PREFIX } }, _count: { _all: true },
    }),
    prisma.staffAttractionAssignment.count({ where: { staffId: IDS.users.gateStaff, revokedAt: null } }),
    prisma.revenueForecast.groupBy({
      by: ['trainingSource'],
      where: { attractionId: { in: [IDS.attractions.museum, IDS.attractions.cruise, IDS.attractions.eco] }, forecastDate: { gte: today } },
      _count: { _all: true },
    }),
  ]);

  return {
    accounts,
    pendingKyc,
    pendingAttractions,
    scenarioBookings,
    todayValidTickets,
    pendingRefunds,
    actionableSupport,
    visibleReviews,
    settlements: Object.fromEntries(settlements.map((row) => [row.status, row._count._all])),
    partnerAssignments,
    forecasts: Object.fromEntries(forecasts.map((row) => [row.trainingSource, row._count._all])),
  };
}

function assertDemoReady(readiness) {
  const failures = [];
  const requireAtLeast = (field, minimum, label) => {
    if (Number(readiness[field] || 0) < minimum) {
      failures.push(`${label}: cần >= ${minimum}, hiện có ${readiness[field] || 0}`);
    }
  };
  requireAtLeast('accounts', 8, 'Tài khoản theo vai trò và dữ liệu forecast');
  requireAtLeast('pendingKyc', 2, 'Hồ sơ KYC chờ duyệt');
  requireAtLeast('pendingAttractions', 2, 'Địa điểm chờ duyệt');
  requireAtLeast('scenarioBookings', 15, 'Booking theo trạng thái');
  requireAtLeast('todayValidTickets', 2, 'QR hợp lệ hôm nay');
  requireAtLeast('pendingRefunds', 2, 'Yêu cầu hoàn tiền chờ xử lý');
  requireAtLeast('actionableSupport', 2, 'Support ticket đang xử lý');
  requireAtLeast('visibleReviews', 2, 'Review để Partner/Admin xử lý');
  requireAtLeast('partnerAssignments', 3, 'Phân công điểm cho nhân viên cổng');
  for (const status of ['DRAFT', 'APPROVED', 'PAID']) {
    if (!readiness.settlements[status]) failures.push(`Thiếu settlement ${status}`);
  }
  const forecastPoints = Object.values(readiness.forecasts).reduce((sum, value) => sum + value, 0);
  if (forecastPoints < 21) failures.push(`Forecast tương lai: cần 21 điểm, hiện có ${forecastPoints}`);
  if (failures.length > 0) {
    const error = new Error(`Bộ dữ liệu demo chưa sẵn sàng:\n- ${failures.join('\n- ')}`);
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function printHandoff(readiness, forecastResults = []) {
  console.log('\n============================================================');
  console.log('VIETTICKET DEFENSE DEMO — READY');
  console.log('============================================================');
  console.log(`Ngày dữ liệu (Việt Nam): ${vietnamDateKey()}`);
  console.log(`Mật khẩu chung local: ${DEMO_PASSWORD}`);
  console.log('\nTài khoản:');
  console.log(`- Customer:       ${ACCOUNTS.customer.email}`);
  console.log(`- Partner:        ${ACCOUNTS.partner.email}`);
  console.log(`- Staff check-in: ${ACCOUNTS.gateStaff.email}`);
  console.log(`- Staff hỗ trợ:   ${ACCOUNTS.platformStaff.email}`);
  console.log(`- Admin:          ${ACCOUNTS.admin.email}`);
  console.log('\nMã QR nhập tay: DEMOQR-CHECKIN-01');
  console.log('Voucher: DEMO15 (giảm 15%, tối đa 100.000 VND, đơn từ 200.000 VND)');
  console.log('\nReadiness:');
  console.log(JSON.stringify(readiness, null, 2));
  if (forecastResults.length > 0) {
    console.log('\nForecast cache:');
    console.log(JSON.stringify(forecastResults, null, 2));
  }
  console.log('\nTrước mỗi lần tập/demo: npm run demo:prepare');
  console.log('Kiểm tra không ghi DB:    npm run demo:check');
  console.log('Kịch bản: ../DEMO_RUNBOOK_4_MEMBERS.md');
  console.log('============================================================\n');
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const confirmedLocalDemo = process.argv.includes('--confirm-local-demo');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Tuyệt đối không được seed dữ liệu bảo vệ trong production.');
  }
  if (DEMO_PASSWORD.length < 12) {
    throw new Error('DEMO_PASSWORD phải có ít nhất 12 ký tự.');
  }

  await prisma.$connect();
  if (checkOnly) {
    const readiness = assertDemoReady(await collectDemoReadiness());
    printHandoff(readiness);
    return;
  }
  if (!confirmedLocalDemo) {
    throw new Error('Thiếu cờ --confirm-local-demo. Hãy chạy npm run demo:prepare.');
  }

  console.log('Đang reset dữ liệu demo do script sở hữu...');
  await resetOwnedDemoData();
  console.log('Đang tạo tài khoản và hồ sơ KYC theo vai trò...');
  await seedIdentitiesAndPartners();
  console.log('Đang tạo catalog, ticket, lịch và hồ sơ moderation...');
  const attractions = await seedCatalog();
  console.log(`Đang tạo ${HISTORY_DAYS} ngày lịch sử doanh thu cho ba điểm demo...`);
  const historyBookings = await seedForecastHistory(attractions);
  console.log('Đang tạo booking theo trạng thái, QR, refund và review...');
  const scenarioBookings = await seedScenarioBookings();
  await seedInventory(scenarioBookings);
  console.log('Đang tạo settlement, support, favorites, itinerary và audit log...');
  await seedSettlements(historyBookings);
  await seedSupportAndCustomerFeatures(scenarioBookings);
  await seedAuditLogs();
  console.log('Đang làm nóng forecast cache cho ba điểm của Partner demo...');
  const forecastResults = await prepareForecastCache();
  const readiness = assertDemoReady(await collectDemoReadiness());
  printHandoff(readiness, forecastResults);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.message);
      if (error.readiness) console.error(JSON.stringify(error.readiness, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = {
  ACCOUNTS,
  IDS,
  MARKER,
  PREFIX,
  addDateKeyDays,
  assertDemoReady,
  buildSubmittedSnapshot,
  scenarioBookingDefinitions,
  scenarioBookingId,
  scenarioRefundRequestId,
  vietnamDateKey,
};
