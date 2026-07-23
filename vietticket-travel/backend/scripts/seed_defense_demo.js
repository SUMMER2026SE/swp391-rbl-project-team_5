'use strict';

/**
 * Bộ dữ liệu trình diễn bảo vệ VietTicket Travel.
 *
 * Mục tiêu:
 * - Tạo dữ liệu xuyên suốt cho Customer, Partner, Partner Staff, Platform Staff và Admin.
 * - Tự dịch ngày theo ngày chạy để check-in, hoàn tiền và duyệt đơn không bị hết hạn.
 * - Chạy lại an toàn: chỉ xóa dữ liệu thuộc bộ fixture hiện tại và marker cũ do script sở hữu.
 * - Không bao giờ chạy trong production.
 *
 * Chạy:
 *   npm run demo:prepare   # reset + tạo lại toàn bộ dữ liệu local
 *   npm run demo:check     # chỉ kiểm tra, không ghi database
 */

require('dotenv').config({ quiet: true });

const bcrypt = require('bcrypt');
const { createHash } = require('crypto');
const prisma = require('../src/config/prisma');
const { ensureSeedPartnerKycDocument } = require('../prisma/seedPartnerIdentity');
const { activateLiveTrip } = require('../src/services/liveTripService');
const { refreshTripAutopilot } = require('../src/services/liveTripAutopilotService');
const { predictLiveArrivals } = require('../src/services/livePredictionService');
const { joinQueue } = require('../src/services/smartQueueService');
const {
  LIVE_AUTOPILOT_DEMO_MARKER,
  seedLiveAutopilotSignals,
} = require('./seed_live_autopilot_demo');

const LEGACY_PREFIX = 'defense-demo-v1-';
const PREFIX = 'defense-demo-v2-';
const MARKER = '[DEFENSE_DEMO_V2]';
const DEMO_PASSWORD = String(process.env.DEMO_PASSWORD || 'Demo@VietTicket2026');
const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const HISTORY_DAYS = 90;

function stableUuid(scope, key) {
  const hex = createHash('sha256')
    .update(`vietticket-operational-v2:${scope}:${key}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function fixtureId(scope, key) {
  return stableUuid(scope, key);
}

function assertLocalDemoDatabase() {
  let databaseUrl;
  try {
    databaseUrl = new URL(String(process.env.DATABASE_URL || ''));
  } catch {
    throw new Error('DATABASE_URL không hợp lệ; từ chối reset dữ liệu demo.');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(databaseUrl.hostname)) {
    throw new Error('demo:prepare chỉ được phép reset database chạy trên localhost.');
  }
}

const IDS = Object.freeze({
  users: {
    customer: fixtureId('user', 'customer'),
    partner: fixtureId('user', 'partner'),
    gateStaff: fixtureId('user', 'gate-staff'),
    platformStaff: fixtureId('user', 'platform-staff'),
    admin: fixtureId('user', 'admin'),
    forecastCustomer: fixtureId('user', 'forecast-history'),
    kycApprove: fixtureId('user', 'kyc-approve'),
    kycReject: fixtureId('user', 'kyc-reject'),
  },
  partners: {
    owner: fixtureId('partner', 'owner'),
    kycApprove: fixtureId('partner', 'kyc-approve'),
    kycReject: fixtureId('partner', 'kyc-reject'),
  },
  attractions: {
    museum: fixtureId('attraction', 'museum'),
    cruise: fixtureId('attraction', 'cruise'),
    eco: fixtureId('attraction', 'eco'),
    pendingApprove: fixtureId('attraction', 'pending-approve'),
    pendingReject: fixtureId('attraction', 'pending-reject'),
    suspended: fixtureId('attraction', 'suspended'),
    draft: fixtureId('attraction', 'draft'),
  },
  tickets: {
    museumAdult: fixtureId('ticket', 'museum-adult'),
    museumChild: fixtureId('ticket', 'museum-child'),
    museumStudent: fixtureId('ticket', 'museum-student'),
    cruiseAdult: fixtureId('ticket', 'cruise-adult'),
    cruiseFamily: fixtureId('ticket', 'cruise-family'),
    ecoAdult: fixtureId('ticket', 'eco-adult'),
    ecoChild: fixtureId('ticket', 'eco-child'),
    pendingApprove: fixtureId('ticket', 'pending-approve'),
    pendingReject: fixtureId('ticket', 'pending-reject'),
    suspended: fixtureId('ticket', 'suspended'),
    draft: fixtureId('ticket', 'draft'),
  },
});

const ACCOUNTS = Object.freeze({
  customer: {
    id: IDS.users.customer,
    email: 'minh.anh.nguyen@vietticket.local',
    fullName: 'Nguyễn Minh Anh',
    role: 'CUSTOMER',
    phone: '0903482715',
  },
  partner: {
    id: IDS.users.partner,
    email: 'hoang.nam.tran@vietticket.local',
    fullName: 'Trần Hoàng Nam',
    role: 'PARTNER',
    phone: '0917624380',
  },
  gateStaff: {
    id: IDS.users.gateStaff,
    email: 'quoc.bao.pham@vietticket.local',
    fullName: 'Phạm Quốc Bảo',
    role: 'STAFF',
    phone: '0938246715',
    employerPartnerId: IDS.partners.owner,
  },
  platformStaff: {
    id: IDS.users.platformStaff,
    email: 'thu.ha.le@vietticket.local',
    fullName: 'Lê Thu Hà',
    role: 'STAFF',
    phone: '0982716435',
  },
  admin: {
    id: IDS.users.admin,
    email: 'ngoc.lan.vu@vietticket.local',
    fullName: 'Vũ Ngọc Lan',
    role: 'ADMIN',
    phone: '0963158274',
  },
  forecastCustomer: {
    id: IDS.users.forecastCustomer,
    email: 'nguyen.gia.han@vietticket.local',
    fullName: 'Nguyễn Gia Hân',
    role: 'CUSTOMER',
    phone: '0974526813',
  },
  kycApprove: {
    id: IDS.users.kycApprove,
    email: 'gia.han.do@vietticket.local',
    fullName: 'Đỗ Gia Hân',
    role: 'CUSTOMER',
    phone: '0906724158',
  },
  kycReject: {
    id: IDS.users.kycReject,
    email: 'thanh.tung.bui@vietticket.local',
    fullName: 'Bùi Thanh Tùng',
    role: 'CUSTOMER',
    phone: '0948315276',
  },
});

const BACKGROUND_CUSTOMERS = Object.freeze([
  ACCOUNTS.forecastCustomer,
  ['hoang.gia.bao', 'Hoàng Gia Bảo', '0926417385'],
  ['le.khanh.linh', 'Lê Khánh Linh', '0908361724'],
  ['phan.nhat.minh', 'Phan Nhật Minh', '0935172846'],
  ['vo.thao.nguyen', 'Võ Thảo Nguyên', '0972615834'],
  ['dang.quoc.huy', 'Đặng Quốc Huy', '0914837265'],
  ['bui.mai.phuong', 'Bùi Mai Phương', '0983542176'],
  ['do.anh.khoa', 'Đỗ Anh Khoa', '0967214385'],
  ['nguyen.ngoc.tram', 'Nguyễn Ngọc Trâm', '0942683517'],
  ['tran.duc.thanh', 'Trần Đức Thành', '0907128436'],
  ['lam.bao.chau', 'Lâm Bảo Châu', '0938462157'],
  ['huynh.tuan.kiet', 'Huỳnh Tuấn Kiệt', '0971358264'],
].map((entry) => {
  if (!Array.isArray(entry)) return entry;
  const [slug, fullName, phone] = entry;
  return Object.freeze({
    id: fixtureId('user', `customer-${slug}`),
    email: `${slug}@vietticket.local`,
    fullName,
    role: 'CUSTOMER',
    phone,
  });
}));

const OPERATIONAL_VALUES = Object.freeze({
  voucherCode: 'KHAMPHA15',
  checkinQrPrimary: 'VTQ-A74C-91D2-E8B5-01',
  checkinQrBackup: 'VTQ-A74C-91D2-E8B5-02',
  settlementBankReference: 'FT262010845731',
});

// Public-looking suffixes keep customer-facing references neutral. Scenario
// keys remain internal to the seed/smoke scripts and are never rendered by UI.
const SCENARIO_BOOKING_REFERENCES = Object.freeze({
  'checkin-today': 'A74C91D2E8B5',
  'already-checked-today': '6F20B8CA4D91',
  'museum-school-group-today': '814CB96E20F7',
  'cruise-group-today': 'E29A61D4C870',
  'partner-approve': 'C3E71A9B520F',
  'partner-reject': '9D42F6A10C8E',
  'review-create': 'E8B15C730A4D',
  'review-reply': '4A90D2F68BC1',
  'review-moderate': 'B7C35E194A02',
  'cruise-review-1': '7E42A90C1D53',
  'cruise-review-2': 'A51D7C209E84',
  'cruise-review-3': 'D90B42E75C16',
  'cruise-review-4': '2C68F1A9D437',
  'refund-customer-create': '1F8D60C3B7A4',
  'refund-approve': 'D2A7F9406E1C',
  'refund-reject': '5C19B8E24A70',
  'pending-payment': '8E43A1C7D2F5',
  reissue: 'F6B20D9A4C81',
  refunded: '3A7E51C8B920',
  'no-show': 'C1D84A7F2E56',
  cancelled: '7B2F90D4A61C',
});

const SCENARIO_REFUND_REFERENCES = Object.freeze({
  approve: '2E9A61C4B7D0',
  reject: '8C35F1A90D62',
  completed: '4B70D2E8A51C',
});

function scenarioBookingId(key) {
  const reference = SCENARIO_BOOKING_REFERENCES[key];
  if (!reference) throw new Error(`Không có mã tham chiếu cho booking ${key}.`);
  const base = fixtureId('booking', key);
  return `${base.slice(0, -12)}${reference.toLowerCase()}`;
}

function scenarioRefundRequestId(key) {
  const reference = SCENARIO_REFUND_REFERENCES[key];
  if (!reference) throw new Error(`Không có mã tham chiếu cho yêu cầu hoàn tiền ${key}.`);
  const base = fixtureId('refund-request', key);
  return `${base.slice(0, -12)}${reference.toLowerCase()}`;
}

function qrTokenForBooking(key, index) {
  const reference = SCENARIO_BOOKING_REFERENCES[key];
  if (!reference) throw new Error(`Không có mã QR cho booking ${key}.`);
  return `VTQ-${reference.slice(0, 4)}-${reference.slice(4, 8)}-${reference.slice(8, 12)}-${String(index + 1).padStart(2, '0')}`;
}

function qrTokenForHistory(key, index) {
  const token = createHash('sha256')
    .update(`vietticket-history-qr:${key}:${index}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `VTQ-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}`;
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

function timeKeyFromMinutes(totalMinutes) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, Number(totalMinutes) || 0));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function liveShowcaseWindow(now = new Date()) {
  const vietnamNow = new Date(now.getTime() + VN_OFFSET_MS);
  const currentMinute = vietnamNow.getUTCHours() * 60 + vietnamNow.getUTCMinutes();
  const opensAt = 8 * 60;
  const closesAt = 17 * 60;
  const latestStart = closesAt - 15;
  if (currentMinute >= latestStart) {
    throw new Error(
      'Live-AutoPilot showcase chỉ chuẩn bị được trước 16:45 giờ Việt Nam vì SmartQueue cần tối thiểu 15 phút vận hành hợp lệ.',
    );
  }
  const proposedStart = currentMinute < opensAt - 15
    ? opensAt
    : Math.max(opensAt, Math.ceil((currentMinute + 5) / 5) * 5);
  const startMinute = Math.min(proposedStart, latestStart);
  const endMinute = Math.min(closesAt, startMinute + 90);
  return {
    startTime: timeKeyFromMinutes(startMinute),
    endTime: timeKeyFromMinutes(endMinute),
    callWindowOpen: currentMinute >= startMinute - 15,
  };
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
  const ownedUserIds = [...new Set([
    ...Object.values(IDS.users),
    ...BACKGROUND_CUSTOMERS.map(({ id }) => id),
  ])];
  const ownedPartnerIds = Object.values(IDS.partners);
  const ownedAttractionIds = Object.values(IDS.attractions);

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

    await tx.partnerSettlement.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { partnerId: { in: ownedPartnerIds } },
        ],
      },
    });
    await tx.supportTicket.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { userId: { in: ownedUserIds } },
        ],
      },
    });
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { entityId: { startsWith: LEGACY_PREFIX } },
          { entityId: { startsWith: PREFIX } },
          { actorId: { startsWith: LEGACY_PREFIX } },
          { actorId: { startsWith: PREFIX } },
          { actorId: { in: ownedUserIds } },
          { entityId: { in: [...ownedUserIds, ...ownedPartnerIds, ...ownedAttractionIds] } },
        ],
      },
    });
    await tx.savedItinerary.deleteMany({
      where: {
        OR: [
          { planId: { startsWith: LEGACY_PREFIX } },
          { planId: { startsWith: PREFIX } },
          { userId: { in: ownedUserIds } },
        ],
      },
    });
    await tx.newsletterSubscription.deleteMany({
      where: {
        email: {
          in: ['demo.newsletter@vietticket.local', 'minh.anh.nguyen@vietticket.local'],
        },
      },
    });
    await tx.booking.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { userId: { in: ownedUserIds } },
        ],
      },
    });
    await tx.reservation.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { userId: { in: ownedUserIds } },
        ],
      },
    });
    await tx.attraction.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { id: { in: ownedAttractionIds } },
          { partnerId: { in: ownedPartnerIds } },
        ],
      },
    });
    await tx.category.deleteMany({
      where: {
        OR: [
          { description: { contains: '[DEFENSE_DEMO_V1]' } },
          { description: { contains: MARKER } },
        ],
        attractions: { none: {} },
      },
    });
    await tx.partnerProfile.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { id: { in: ownedPartnerIds } },
          { userId: { in: ownedUserIds } },
        ],
      },
    });
    await tx.voucher.deleteMany({
      where: {
        OR: [
          { id: { in: [fixtureId('voucher', 'khampha15')] } },
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { code: { in: ['DEMO15', OPERATIONAL_VALUES.voucherCode] } },
        ],
      },
    });
    await tx.user.deleteMany({
      where: {
        OR: [
          { id: { startsWith: LEGACY_PREFIX } },
          { id: { startsWith: PREFIX } },
          { id: { in: ownedUserIds } },
        ],
      },
    });

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
      termsVersion: '2026-01',
      privacyVersion: '2026-01',
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
      businessName: 'Công ty TNHH Du lịch Trải nghiệm Việt',
      businessLicenseUrl: ownerLicense,
      taxCode: '0318472916',
      registrationDate: new Date('2020-03-12T00:00:00.000Z'),
      representativeName: ACCOUNTS.partner.fullName,
      representativePhone: ACCOUNTS.partner.phone,
      businessAddress: '02 Công trường Mê Linh, Quận 1, TP. Hồ Chí Minh',
      bankName: 'Vietcombank',
      branchName: 'Chi nhánh TP. Hồ Chí Minh',
      bankAccountNumber: '102874563910',
      bankAccountName: 'CONG TY DU LICH TRAI NGHIEM VIET',
      payoutCurrency: 'VND',
      website: null,
      description: 'Đơn vị vận hành các trải nghiệm văn hóa, sinh thái và du lịch đường thủy tại Thành phố Hồ Chí Minh.',
      kycConsentAccepted: true,
      kycConsentVersion: '2026-01',
      kycConsentAcceptedAt: new Date(),
      kycConsentIpAddress: '127.0.0.1',
      commissionRate: 0.1,
      status: 'APPROVED',
    },
  });

  await createIdentity(ACCOUNTS.gateStaff, passwordHash);
  await createIdentity(ACCOUNTS.platformStaff, passwordHash);
  await createIdentity(ACCOUNTS.admin, passwordHash);
  for (const account of BACKGROUND_CUSTOMERS) {
    await createIdentity(account, passwordHash);
  }
  await createIdentity(ACCOUNTS.kycApprove, passwordHash);
  await createIdentity(ACCOUNTS.kycReject, passwordHash);

  for (const [key, profileId, taxCode, businessName] of [
    ['kycApprove', IDS.partners.kycApprove, '0319257481', 'Công ty TNHH Hành trình Xanh'],
    ['kycReject', IDS.partners.kycReject, '0317648205', 'Hộ kinh doanh Du lịch Bình Minh'],
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
        businessAddress: key === 'kycApprove'
          ? '18 Nguyễn Thị Minh Khai, Quận 1, Thành phố Hồ Chí Minh'
          : '42 Trần Hưng Đạo, Quận 5, Thành phố Hồ Chí Minh',
        bankName: 'Vietcombank',
        branchName: 'Chi nhánh TP. Hồ Chí Minh',
        bankAccountNumber: key === 'kycApprove' ? '104826391570' : '107352864190',
        bankAccountName: account.fullName.toLocaleUpperCase('vi-VN'),
        payoutCurrency: 'VND',
        description: 'Đơn vị lữ hành chuyên tổ chức các hành trình trải nghiệm trong nước.',
        kycConsentAccepted: true,
        kycConsentVersion: '2026-01',
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
      id: fixtureId('voucher', 'khampha15'),
      code: OPERATIONAL_VALUES.voucherCode,
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
      title: 'Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh',
      description: 'Bảo tàng tại 97A Phó Đức Chính, trưng bày mỹ thuật cổ, cận đại và hiện đại trong quần thể kiến trúc kết hợp phong cách Đông – Tây. Thời gian tham quan công bố: 08:00–17:00 hằng ngày.',
      address: '97A Phó Đức Chính, Quận 1', city: 'Hồ Chí Minh', district: 'Quận 1',
      latitude: 10.7683, longitude: 106.6992,
      openTime: '08:00', closeTime: '17:00', defaultCapacity: 180,
      recommendedVisitMinutes: 120, environment: 'INDOOR', isFullDay: false,
      requiresManualApproval: false,
      category: categories.Museum,
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/B%E1%BA%A3o%20t%C3%A0ng%20M%E1%BB%B9%20thu%E1%BA%ADt%20Tp%20%28ki%E1%BA%BFn%20tr%C3%BAc%20t%C3%B2a%20nh%C3%A0%2C%20b%E1%BA%ADc%20tam%20c%E1%BA%A5p%29%20%281%29.jpg?width=1280',
      tickets: [
        { id: IDS.tickets.museumAdult, name: 'Vé tham quan tiêu chuẩn', type: 'ADULT', originalPrice: 30000, sellingPrice: 30000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 16 },
        { id: IDS.tickets.museumChild, name: 'Vé tham quan trẻ em', type: 'CHILD', originalPrice: 15000, sellingPrice: 15000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 6, maxAgeYears: 15, requiresAdult: true },
        { id: IDS.tickets.museumStudent, name: 'Vé học sinh – sinh viên', type: 'STUDENT', originalPrice: 15000, sellingPrice: 15000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 16 },
      ],
    },
    {
      id: IDS.attractions.cruise,
      title: 'Tour Hoàng hôn trên sông Sài Gòn',
      description: 'Chương trình đường thủy do đối tác vận hành, khởi hành tại Bến Bạch Đằng; gồm 90 phút ngắm cảnh, hướng dẫn viên và nước uống. Đơn đặt chỗ được xác nhận theo tải trọng thực tế của chuyến.',
      address: 'Bến Bạch Đằng, Quận 1', city: 'Hồ Chí Minh', district: 'Quận 1',
      latitude: 10.7736, longitude: 106.7066,
      openTime: '08:00', closeTime: '22:00', defaultCapacity: 90,
      recommendedVisitMinutes: 120, environment: 'OUTDOOR', isFullDay: false,
      requiresManualApproval: true,
      category: categories.Adventure,
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Bach%20Dang%20Station%20-%20Sai%20Gon%20Water%20Bus.jpg?width=1280',
      tickets: [
        { id: IDS.tickets.cruiseAdult, name: 'Vé du thuyền người lớn', type: 'ADULT', originalPrice: 350000, sellingPrice: 280000, refundPolicy: 'REFUND_WITH_FEE', refundFeeRate: 0.3, minAgeYears: 12 },
        { id: IDS.tickets.cruiseFamily, name: 'Gói gia đình 2 người lớn + 2 trẻ em', type: 'FAMILY', originalPrice: 1050000, sellingPrice: 920000, refundPolicy: 'REFUND_WITH_FEE', refundFeeRate: 0.3, requiresAdult: true },
      ],
    },
    {
      id: IDS.attractions.eco,
      title: 'Khu du lịch sinh thái Vàm Sát – Cần Giờ',
      description: 'Gói trải nghiệm trọn ngày tại vùng sinh thái Vàm Sát, gồm xe trung chuyển, tuyến tham quan rừng ngập mặn và hướng dẫn viên của đối tác. Vé vào cổng tiêu chuẩn được tách rõ trong mô tả gói dịch vụ.',
      address: 'Tiểu khu 15A, xã An Thới Đông, Cần Giờ', city: 'Hồ Chí Minh', district: 'Cần Giờ',
      latitude: 10.4114, longitude: 106.9547,
      openTime: '08:00', closeTime: '17:00', defaultCapacity: 120,
      recommendedVisitMinutes: 480, environment: 'OUTDOOR', isFullDay: true,
      requiresManualApproval: false,
      category: categories['Nature & Sightseeing'],
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Can_Gio_Mangrove_Forest.jpg/1280px-Can_Gio_Mangrove_Forest.jpg',
      tickets: [
        { id: IDS.tickets.ecoAdult, name: 'Gói khám phá Vàm Sát trọn ngày', type: 'ADULT', originalPrice: 560000, sellingPrice: 520000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 12 },
        { id: IDS.tickets.ecoChild, name: 'Gói Vàm Sát dành cho trẻ em', type: 'CHILD', originalPrice: 390000, sellingPrice: 360000, refundPolicy: 'FREE_CANCELLATION', minAgeYears: 6, maxAgeYears: 11, requiresAdult: true },
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
            description: `${ticket.name}; sử dụng đúng ngày, khung giờ và điều kiện độ tuổi đã chọn.`,
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
      id: fixtureId('special-date', 'cruise-maintenance'),
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
      id: fixtureId('staff-assignment', attractionId),
      staffId: IDS.users.gateStaff,
      attractionId,
      createdById: IDS.users.partner,
    })),
  });

  return attractionDefinitions;
}

async function loadTicketCatalog() {
  const rows = await prisma.ticketProduct.findMany({
    where: { id: { in: Object.values(IDS.tickets) } },
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
  const customerAssignments = {
    'already-checked-today': BACKGROUND_CUSTOMERS[0],
    'museum-school-group-today': BACKGROUND_CUSTOMERS[10],
    'cruise-group-today': BACKGROUND_CUSTOMERS[11],
    'partner-approve': BACKGROUND_CUSTOMERS[1],
    'partner-reject': BACKGROUND_CUSTOMERS[2],
    'review-reply': BACKGROUND_CUSTOMERS[3],
    'review-moderate': BACKGROUND_CUSTOMERS[4],
    'cruise-review-1': BACKGROUND_CUSTOMERS[0],
    'cruise-review-2': BACKGROUND_CUSTOMERS[5],
    'cruise-review-3': BACKGROUND_CUSTOMERS[8],
    'cruise-review-4': BACKGROUND_CUSTOMERS[10],
    'refund-approve': BACKGROUND_CUSTOMERS[5],
    'refund-reject': BACKGROUND_CUSTOMERS[6],
    reissue: BACKGROUND_CUSTOMERS[7],
    refunded: BACKGROUND_CUSTOMERS[8],
    'no-show': BACKGROUND_CUSTOMERS[9],
    cancelled: BACKGROUND_CUSTOMERS[10],
  };
  return [
    {
      key: 'checkin-today', ticketId: IDS.tickets.museumAdult, offset: 0,
      timeSlotIndex: 0,
      quantity: 2, status: 'CONFIRMED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['VALID', 'VALID'],
      note: 'Đoàn gồm hai khách và có thể đến cổng vào ở hai thời điểm khác nhau.',
    },
    {
      key: 'already-checked-today', ticketId: IDS.tickets.museumStudent, offset: 0,
      timeSlotIndex: 0,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Khách đã hoàn tất lượt tham quan.',
    },
    {
      key: 'museum-school-group-today', ticketId: IDS.tickets.museumStudent, offset: 0,
      timeSlotIndex: 0,
      quantity: 150, status: 'CONFIRMED', reservationStatus: 'CONFIRMED',
      ticketStatuses: Array.from({ length: 150 }, () => 'VALID'),
      note: 'Đoàn trường học 150 khách đã xác nhận trước; nhân viên cổng tổ chức làn vào riêng theo danh sách.',
    },
    {
      key: 'cruise-group-today', ticketId: IDS.tickets.cruiseAdult, offset: 0,
      timeSlotIndex: 0,
      quantity: 39, status: 'CONFIRMED', reservationStatus: 'CONFIRMED',
      ticketStatuses: Array.from({ length: 39 }, () => 'VALID'),
      note: 'Đoàn doanh nghiệp 39 khách đã được Partner xác nhận cho chuyến 16:30.',
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
      key: 'cruise-review-1', ticketId: IDS.tickets.cruiseAdult, offset: -12,
      timeSlotIndex: 0,
      quantity: 2, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED', 'USED'], checkedIn: true,
      note: 'Hai khách đã hoàn tất chuyến ngắm hoàng hôn.',
    },
    {
      key: 'cruise-review-2', ticketId: IDS.tickets.cruiseAdult, offset: -15,
      timeSlotIndex: 1,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Khách đã hoàn tất chuyến buổi tối.',
    },
    {
      key: 'cruise-review-3', ticketId: IDS.tickets.cruiseFamily, offset: -20,
      timeSlotIndex: 0,
      quantity: 1, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED'], checkedIn: true,
      note: 'Gia đình đã sử dụng trọn gói bốn khách.',
    },
    {
      key: 'cruise-review-4', ticketId: IDS.tickets.cruiseAdult, offset: -25,
      timeSlotIndex: 1,
      quantity: 2, status: 'COMPLETED', reservationStatus: 'CONFIRMED',
      ticketStatuses: ['USED', 'USED'], checkedIn: true,
      note: 'Hai khách đã hoàn tất chuyến buổi tối.',
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
    customer: customerAssignments[definition.key] || ACCOUNTS.customer,
    visitDateKey: addDateKeyDays(todayKey, definition.offset),
  }));
}

async function createScenarioBooking(definition, ticket) {
  const id = scenarioBookingId(definition.key);
  const reservationId = fixtureId('reservation', definition.key);
  const paymentId = fixtureId('payment', definition.key);
  const unitPrice = money(ticket.sellingPrice);
  const subtotal = unitPrice * definition.quantity;
  const discount = definition.key === 'pending-payment'
    ? Math.min(money(subtotal * 0.15), 100000)
    : 0;
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
      userId: definition.customer.id,
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
      userId: definition.customer.id,
      reservationId,
      voucherId: definition.key === 'pending-payment' ? fixtureId('voucher', 'khampha15') : null,
      subtotalAmount: subtotal,
      discountAmount: discount,
      totalAmount: total,
      status: definition.status,
      refundRequired: definition.status === 'REFUND_REQUESTED',
      paymentMethod: 'vnpay',
      fullName: definition.customer.fullName,
      email: definition.customer.email,
      phone: definition.customer.phone,
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
        isForecastTrainingSample: false,
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
        source: 'operational_fixture_v2',
        environment: 'VNPAY_SANDBOX',
      },
      createdAt,
    },
  });

  if (definition.ticketStatuses.length > 0) {
    await prisma.ticketInstance.createMany({
      data: definition.ticketStatuses.map((status, index) => ({
        id: fixtureId('ticket-instance', `${definition.key}-${index + 1}`),
        bookingId: id,
        ticketProductId: ticket.id,
        qrCodeToken: qrTokenForBooking(definition.key, index),
        status,
        checkedInAt: definition.checkedIn
          ? (
              definition.offset === 0
                ? new Date(now.getTime() - 15 * 60 * 1000)
                : atVietnamTime(definition.visitDateKey, 10, 0)
            )
          : null,
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
    customer: definition.customer,
  };
}

async function seedScenarioBookings() {
  const todayKey = vietnamDateKey();
  const tickets = await loadTicketCatalog();
  const definitions = scenarioBookingDefinitions(todayKey);
  const created = [];
  for (const definition of definitions) {
    const ticket = tickets.get(definition.ticketId);
    if (!ticket) throw new Error(`Không tìm thấy gói vé vận hành ${definition.ticketId}.`);
    created.push(await createScenarioBooking(definition, ticket));
  }

  const byKey = new Map(created.map((booking) => [booking.key, booking]));

  await prisma.refundRequest.createMany({
    data: [
      {
        id: scenarioRefundRequestId('approve'),
        bookingId: byKey.get('refund-approve').id,
        requestKey: fixtureId('refund-request-key', 'approve'),
        requestedById: byKey.get('refund-approve').customer.id,
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
        requestKey: fixtureId('refund-request-key', 'reject'),
        requestedById: byKey.get('refund-reject').customer.id,
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
        requestKey: fixtureId('refund-request-key', 'completed'),
        requestedById: byKey.get('refunded').customer.id,
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
        id: fixtureId('refund-transaction', 'pre-reconciled'),
        bookingId: byKey.get('refund-approve').id,
        paymentId: byKey.get('refund-approve').paymentId,
        refundRequestId: scenarioRefundRequestId('approve'),
        gateway: 'VNPAY',
        gatewayRequestId: gatewayReference('refund-request-approve'),
        transactionType: '02',
        amount: byKey.get('refund-approve').total,
        status: 'SUCCESS',
        reason: 'VNPay đã trả kết quả thành công; nhân viên hoàn tất bước ghi nhận trên hệ thống.',
        rawResponse: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', environment: 'VNPAY_SANDBOX' },
        gatewayResponseCode: '00',
        gatewayTransactionStatus: '00',
        gatewayTransactionId: gatewayReference('refund-approved'),
        submittedAt: new Date(),
        reconciledAt: new Date(),
        processedAt: new Date(),
      },
      {
        id: fixtureId('refund-transaction', 'completed'),
        bookingId: byKey.get('refunded').id,
        paymentId: byKey.get('refunded').paymentId,
        refundRequestId: scenarioRefundRequestId('completed'),
        gateway: 'VNPAY',
        gatewayRequestId: gatewayReference('refund-request-completed'),
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
        id: fixtureId('review', 'awaiting-partner'),
        userId: byKey.get('review-reply').customer.id,
        attractionId: IDS.attractions.museum,
        bookingId: byKey.get('review-reply').id,
        rating: 5,
        comment: 'Không gian trưng bày dễ hiểu, nhân viên hướng dẫn chu đáo. Gia đình tôi sẽ quay lại.',
        isHidden: false,
      },
      {
        id: fixtureId('review', 'awaiting-moderation'),
        userId: byKey.get('review-moderate').customer.id,
        attractionId: IDS.attractions.cruise,
        bookingId: byKey.get('review-moderate').id,
        rating: 2,
        comment: 'Chuyến khởi hành chậm và hướng dẫn viên tên Minh trả lời thiếu tôn trọng. Đơn vị cần kiểm tra lại ca trực 16:30.',
        isHidden: false,
      },
      {
        id: fixtureId('review', 'cruise-1'),
        userId: byKey.get('cruise-review-1').customer.id,
        attractionId: IDS.attractions.cruise,
        bookingId: byKey.get('cruise-review-1').id,
        rating: 5,
        comment: 'Hoàng hôn trên sông rất đẹp, tàu sạch và khởi hành đúng giờ. Nhân viên hỗ trợ chụp ảnh nhiệt tình.',
        isHidden: false,
      },
      {
        id: fixtureId('review', 'cruise-2'),
        userId: byKey.get('cruise-review-2').customer.id,
        attractionId: IDS.attractions.cruise,
        bookingId: byKey.get('cruise-review-2').id,
        rating: 5,
        comment: 'Khung giờ buổi tối thoáng mát, hướng dẫn viên giới thiệu các công trình ven sông vừa đủ và dễ nghe.',
        isHidden: false,
      },
      {
        id: fixtureId('review', 'cruise-3'),
        userId: byKey.get('cruise-review-3').customer.id,
        attractionId: IDS.attractions.cruise,
        bookingId: byKey.get('cruise-review-3').id,
        rating: 5,
        comment: 'Gói gia đình thuận tiện, các bé thích cảnh thành phố lên đèn. Quy trình lên tàu nhanh và rõ ràng.',
        isHidden: false,
      },
      {
        id: fixtureId('review', 'cruise-4'),
        userId: byKey.get('cruise-review-4').customer.id,
        attractionId: IDS.attractions.cruise,
        bookingId: byKey.get('cruise-review-4').id,
        rating: 4,
        comment: 'Trải nghiệm thư giãn và đúng mô tả. Khu vực chờ hơi đông nhưng nhân viên điều phối khá tốt.',
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
    data: { averageRating: 4.2, totalReviews: 5 },
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
    [IDS.tickets.museumAdult, 30000],
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
      const reservationId = fixtureId('history-reservation', suffix);
      const bookingId = fixtureId('history-booking', suffix);
      const paymentId = fixtureId('history-payment', suffix);
      const historyCustomer = BACKGROUND_CUSTOMERS[
        (dayIndex * attractionDefinitions.length + attractionIndex) % BACKGROUND_CUSTOMERS.length
      ];
      const createdAt = new Date(visitDate.getTime() - (7 + attractionIndex) * DAY_MS);
      const subtotal = price * quantity;
      const { commission, partnerNet } = commissionAmounts(subtotal, 0.1);
      const noShow = (dayIndex + attractionIndex * 7) % 37 === 0;

      reservations.push({
        id: reservationId,
        userId: historyCustomer.id,
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
        userId: historyCustomer.id,
        reservationId,
        subtotalAmount: subtotal,
        discountAmount: 0,
        totalAmount: subtotal,
        status: noShow ? 'NO_SHOW' : 'COMPLETED',
        paymentMethod: 'vnpay',
        fullName: historyCustomer.fullName,
        email: historyCustomer.email,
        phone: historyCustomer.phone,
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
        isForecastTrainingSample: true,
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
          id: fixtureId('history-ticket', `${suffix}-${index + 1}`),
          bookingId,
          ticketProductId: ticketId,
          qrCodeToken: qrTokenForHistory(suffix, index),
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

async function seedSettlements(scenarioBookings) {
  const selected = scenarioBookings
    .filter((booking) => ['COMPLETED', 'NO_SHOW'].includes(booking.status))
    .slice(0, 6);
  if (selected.length < 6) {
    throw new Error('Cần ít nhất 6 booking vận hành đã ghi nhận để tạo đối soát.');
  }
  const groups = [selected.slice(0, 2), selected.slice(2, 4), selected.slice(4, 6)];
  const statuses = ['DRAFT', 'APPROVED', 'PAID'];
  const now = new Date();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const rows = groups[groupIndex];
    const status = statuses[groupIndex];
    const grossAmount = rows.reduce((sum, row) => sum + money(row.total), 0);
    const commissionAmount = rows.reduce(
      (sum, row) => sum + money(row.commission),
      0,
    );
    const payableAmount = rows.reduce(
      (sum, row) => sum + money(row.partnerNet),
      0,
    );
    const visitDateKeys = rows.map((row) => row.visitDateKey).sort();
    const settlementId = fixtureId('settlement', status.toLowerCase());

    await prisma.partnerSettlement.create({
      data: {
        id: settlementId,
        partnerId: IDS.partners.owner,
        periodStart: dateOnly(visitDateKeys[0]),
        periodEnd: dateOnly(visitDateKeys.at(-1)),
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
        bankAccountLast4Snapshot: '3910',
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
            id: fixtureId('settlement-item', `${status.toLowerCase()}-${rowIndex + 1}`),
            bookingId: row.id,
            grossAmount: row.total,
            refundAmount: 0,
            netAmount: row.total,
            commissionAmount: row.commission,
            payableAmount: row.partnerNet,
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
      id: fixtureId('saved-itinerary', 'saigon-2-days'),
      userId: IDS.users.customer,
      planId: fixtureId('itinerary-plan', 'saigon-2-days'),
      title: 'Hồ Chí Minh 2 ngày: di sản và sinh thái',
      criteria: {
        city: 'Hồ Chí Minh', days: 2, adults: 2, children: 1,
        budget: 3000000, interests: 'Văn hóa, bảo tàng, thiên nhiên',
        pace: 'normal', companion: 'family',
      },
      data: {
        clientPlanId: fixtureId('itinerary-plan', 'saigon-2-days'),
        title: 'Hồ Chí Minh 2 ngày: di sản và sinh thái',
        description: 'Lịch trình cân bằng giữa trải nghiệm văn hóa nội đô và khám phá hệ sinh thái Cần Giờ.',
        startDate: addDateKeyDays(vietnamDateKey(), 1),
        availabilityChecked: true,
        availabilityCheckedAt: new Date().toISOString(),
        totalEstimatedCost: 2315000,
        estimatedCost: {
          total: 2315000,
          perPerson: 771667,
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
                title: 'Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh',
                suggestedTime: '09:00', durationMinutes: 120,
                latitude: 10.7683, longitude: 106.6992,
                estimatedCost: 75000,
                ticketItems: [
                  {
                    ticketId: IDS.tickets.museumAdult,
                    ticketName: 'Vé tham quan tiêu chuẩn',
                    quantity: 2,
                    unitPrice: 30000,
                    suggestedTimeSlot: {
                      timeSlotId: `${IDS.attractions.museum}-slot-all-day`,
                      startTime: '08:00',
                      endTime: '17:00',
                    },
                  },
                  {
                    ticketId: IDS.tickets.museumChild,
                    ticketName: 'Vé tham quan trẻ em',
                    quantity: 1,
                    unitPrice: 15000,
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
                title: 'Tour Hoàng hôn trên sông Sài Gòn',
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
                title: 'Khu du lịch sinh thái Vàm Sát – Cần Giờ',
                suggestedTime: '08:00', durationMinutes: 480,
                latitude: 10.4114, longitude: 106.9547,
                estimatedCost: 1400000,
                ticketItems: [
                  {
                    ticketId: IDS.tickets.ecoAdult,
                    ticketName: 'Gói khám phá Vàm Sát trọn ngày',
                    quantity: 2,
                    unitPrice: 520000,
                    suggestedTimeSlot: {
                      timeSlotId: `${IDS.attractions.eco}-slot-all-day`,
                      startTime: '08:00',
                      endTime: '17:00',
                    },
                  },
                  {
                    ticketId: IDS.tickets.ecoChild,
                    ticketName: 'Gói Vàm Sát dành cho trẻ em',
                    quantity: 1,
                    unitPrice: 360000,
                    suggestedTimeSlot: {
                      timeSlotId: `${IDS.attractions.eco}-slot-all-day`,
                      startTime: '08:00',
                      endTime: '17:00',
                    },
                  },
                ],
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
      id: fixtureId('newsletter', 'minh-anh'),
      email: ACCOUNTS.customer.email,
      isActive: true,
    },
  });

  await prisma.supportTicket.create({
    data: {
      id: fixtureId('support', 'open'),
      userId: IDS.users.customer,
      bookingId: byKey.get('checkin-today').id,
      subject: 'Cần hỗ trợ nhận diện mã QR tại cổng',
      description: 'Gia đình có hai vé nhưng sẽ đến cổng ở hai thời điểm khác nhau. Xin hướng dẫn cách check-in từng vé.',
      status: 'OPEN',
      priority: 'URGENT',
      messages: {
        create: {
          id: fixtureId('support-message', 'open-1'),
          senderId: IDS.users.customer,
          message: 'Nhờ bộ phận hỗ trợ xác nhận mỗi mã QR chỉ dùng cho một người và có thể quét tách lượt.',
        },
      },
    },
  });

  await prisma.supportTicket.create({
    data: {
      id: fixtureId('support', 'in-progress'),
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
            id: fixtureId('support-message', 'progress-1'),
            senderId: IDS.users.customer,
            message: 'Tôi muốn kiểm tra chính sách trước khi gửi yêu cầu hủy.',
            createdAt: new Date(Date.now() - 30 * 60 * 1000),
          },
          {
            id: fixtureId('support-message', 'progress-2'),
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
      id: fixtureId('support', 'resolved'),
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
          id: fixtureId('support-message', 'resolved-1'),
          senderId: IDS.users.platformStaff,
          message: 'Yêu cầu đã được giải quyết. Cảm ơn bạn đã sử dụng VietTicket Travel.',
        },
      },
    },
  });
}

async function seedLiveAutopilotShowcase(scenarioBookings, { now = new Date() } = {}) {
  const byKey = new Map(scenarioBookings.map((booking) => [booking.key, booking]));
  const checkinBooking = byKey.get('checkin-today');
  if (!checkinBooking) throw new Error('Thiếu booking checkin-today cho Live-AutoPilot showcase.');

  const todayKey = vietnamDateKey(now);
  const showcaseWindow = liveShowcaseWindow(now);
  const planId = fixtureId('itinerary-plan', 'live-autopilot-showcase');
  await prisma.savedItinerary.create({
    data: {
      id: fixtureId('saved-itinerary', 'live-autopilot-showcase'),
      userId: IDS.users.customer,
      planId,
      title: 'Live Trip hôm nay: bảo tàng và hoàng hôn Sài Gòn',
      criteria: {
        city: 'Hồ Chí Minh',
        days: 1,
        adults: 2,
        children: 0,
        startDate: todayKey,
        pace: 'normal',
        companion: 'friends',
        demoMarker: LIVE_AUTOPILOT_DEMO_MARKER,
      },
      data: {
        clientPlanId: planId,
        title: 'Live Trip hôm nay: bảo tàng và hoàng hôn Sài Gòn',
        description: 'Hành trình vận hành trong ngày để trình diễn cảnh báo áp lực, đề xuất đổi giờ có xác nhận và SmartQueue gắn booking.',
        startDate: todayKey,
        availabilityChecked: true,
        availabilityCheckedAt: now.toISOString(),
        totalEstimatedCost: 620000,
        tips: [
          'SmartQueue chỉ giữ thứ tự vào cổng; mã QR hợp lệ vẫn là điều kiện check-in.',
          'Autopilot không tự ý thay đổi hoặc hủy booking đã thanh toán.',
        ],
        days: [{
          day: 1,
          visitDate: todayKey,
          title: 'Di sản và sông Sài Gòn',
          activities: [
            {
              attractionId: IDS.attractions.museum,
              bookingId: checkinBooking.id,
              title: 'Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh',
              suggestedTime: showcaseWindow.startTime,
              durationMinutes: 90,
              latitude: 10.7683,
              longitude: 106.6992,
              estimatedCost: 60000,
              suggestedTimeSlot: {
                timeSlotId: `${IDS.attractions.museum}-slot-all-day`,
                startTime: showcaseWindow.startTime,
                endTime: showcaseWindow.endTime,
              },
              ticketItems: [{
                ticketId: IDS.tickets.museumAdult,
                ticketName: 'Vé tham quan tiêu chuẩn',
                quantity: 2,
                unitPrice: 30000,
                suggestedTimeSlot: {
                  timeSlotId: `${IDS.attractions.museum}-slot-all-day`,
                  startTime: showcaseWindow.startTime,
                  endTime: showcaseWindow.endTime,
                },
              }],
            },
            {
              attractionId: IDS.attractions.cruise,
              title: 'Tour Hoàng hôn trên sông Sài Gòn',
              suggestedTime: '16:30',
              durationMinutes: 90,
              latitude: 10.7736,
              longitude: 106.7066,
              estimatedCost: 560000,
              suggestedTimeSlot: {
                timeSlotId: `${IDS.attractions.cruise}-slot-1`,
                startTime: '16:30',
                endTime: '18:00',
              },
              ticketItems: [{
                ticketId: IDS.tickets.cruiseAdult,
                ticketName: 'Vé du thuyền người lớn',
                quantity: 2,
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
        }],
      },
    },
  });

  const activation = await activateLiveTrip({
    userId: IDS.users.customer,
    planId,
    startDate: todayKey,
    prismaClient: prisma,
  });
  const museumItem = activation.trip.items.find(
    (item) => item.attractionId === IDS.attractions.museum,
  );
  if (!museumItem || museumItem.bookingId !== checkinBooking.id) {
    throw new Error('LiveTrip showcase không liên kết đúng booking bảo tàng của Customer.');
  }

  await prisma.smartQueuePolicy.update({
    where: { attractionId: IDS.attractions.museum },
    data: {
      enabled: true,
      mode: 'STAFF_CONTROLLED',
      openBeforeMinutes: 1440,
      readyGraceMinutes: 10,
      maxReadyParties: 3,
      maxActiveParties: 100,
      fallbackThroughput15m: 12,
      pausedAt: null,
      pausedById: null,
      pauseReason: null,
      updatedById: IDS.users.partner,
    },
  });

  const prediction = await predictLiveArrivals({
    attractionId: IDS.attractions.museum,
    date: todayKey,
    now,
    horizonMinutes: 15,
    publicOnly: false,
    force: true,
    prismaClient: prisma,
  });
  const queue = await joinQueue({
    tripId: activation.trip.id,
    itemId: museumItem.id,
    userId: IDS.users.customer,
    prismaClient: prisma,
    now,
  });
  const autopilot = await refreshTripAutopilot(
    activation.trip.id,
    IDS.users.customer,
    {
      prismaClient: prisma,
      now,
    },
  );

  return {
    tripId: activation.trip.id,
    museumItemId: museumItem.id,
    queueStatus: queue.queue.status,
    queueCallWindowOpen: showcaseWindow.callWindowOpen,
    prediction: {
      modelVersion: prediction.model_version,
      trainingSource: prediction.training_source,
      confidence: prediction.confidence,
      usedFallback: Boolean(prediction.used_fallback),
    },
    autopilot: autopilot.stats,
  };
}

async function seedAuditLogs() {
  await prisma.auditLog.createMany({
    data: [
      {
        id: fixtureId('audit', 'partner-approved'), actorId: IDS.users.admin,
        action: 'PARTNER_KYC_APPROVED', entityType: 'PartnerProfile', entityId: IDS.partners.owner,
        ipAddress: '127.0.0.1', userAgent: 'VietTicket Admin Portal',
        metadata: { businessName: 'Công ty Du lịch Trải nghiệm Việt' },
        createdAt: new Date(Date.now() - 3 * DAY_MS),
      },
      {
        id: fixtureId('audit', 'attraction-published'), actorId: IDS.users.admin,
        action: 'ATTRACTION_PUBLISHED', entityType: 'Attraction', entityId: IDS.attractions.museum,
        ipAddress: '127.0.0.1', userAgent: 'VietTicket Admin Portal',
        metadata: { trangThaiPhatHanh: 'Đang mở bán' },
        createdAt: new Date(Date.now() - 2 * DAY_MS),
      },
      {
        id: fixtureId('audit', 'ticket-checked-in'), actorId: IDS.users.gateStaff,
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
  const showcaseSavedItineraryId = fixtureId('saved-itinerary', 'live-autopilot-showcase');
  const freshPredictionCutoff = new Date(Date.now() - 30 * 60 * 1000);
  const expectedAccountIds = [...new Set([
    ...Object.values(IDS.users),
    ...BACKGROUND_CUSTOMERS.map(({ id }) => id),
  ])];
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
    showcaseTrips,
    showcaseItems,
    showcaseLinkedBookings,
    pendingAutopilotProposals,
    waitingQueueEntries,
    showcaseQueuePolicies,
    liveObservations,
    nonFallbackPredictions,
    liveEvents,
    showcaseGroupBookings,
    museumStock,
    cruiseSlotStock,
  ] = await Promise.all([
    prisma.user.count({ where: { id: { in: expectedAccountIds } } }),
    prisma.partnerProfile.count({ where: { id: { in: [IDS.partners.kycApprove, IDS.partners.kycReject] }, status: 'PENDING' } }),
    prisma.attraction.count({ where: { id: { in: [IDS.attractions.pendingApprove, IDS.attractions.pendingReject] }, status: 'PENDING' } }),
    prisma.booking.count({
      where: { id: { in: Object.keys(SCENARIO_BOOKING_REFERENCES).map(scenarioBookingId) } },
    }),
    prisma.ticketInstance.count({
      where: {
        status: 'VALID',
        booking: { reservation: { date: today } },
        ticketProduct: { attractionId: IDS.attractions.museum },
      },
    }),
    prisma.refundRequest.count({
      where: {
        id: { in: Object.keys(SCENARIO_REFUND_REFERENCES).map(scenarioRefundRequestId) },
        status: 'PENDING',
      },
    }),
    prisma.supportTicket.count({
      where: {
        id: { in: [fixtureId('support', 'open'), fixtureId('support', 'in-progress')] },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
    }),
    prisma.review.count({
      where: {
        id: { in: [fixtureId('review', 'awaiting-partner'), fixtureId('review', 'awaiting-moderation')] },
        isHidden: false,
      },
    }),
    prisma.partnerSettlement.groupBy({
      by: ['status'], where: { partnerId: IDS.partners.owner }, _count: { _all: true },
    }),
    prisma.staffAttractionAssignment.count({ where: { staffId: IDS.users.gateStaff, revokedAt: null } }),
    prisma.revenueForecast.groupBy({
      by: ['trainingSource'],
      where: { attractionId: { in: [IDS.attractions.museum, IDS.attractions.cruise, IDS.attractions.eco] }, forecastDate: { gte: today } },
      _count: { _all: true },
    }),
    prisma.liveTrip.count({
      where: { savedItineraryId: showcaseSavedItineraryId, status: 'ACTIVE' },
    }),
    prisma.liveTripItem.count({
      where: { liveTrip: { savedItineraryId: showcaseSavedItineraryId } },
    }),
    prisma.liveTripItem.count({
      where: {
        liveTrip: { savedItineraryId: showcaseSavedItineraryId },
        bookingId: { not: null },
      },
    }),
    prisma.liveTripProposal.count({
      where: {
        liveTrip: { savedItineraryId: showcaseSavedItineraryId },
        status: 'PENDING',
      },
    }),
    prisma.smartQueueEntry.count({
      where: {
        liveTrip: { savedItineraryId: showcaseSavedItineraryId },
        status: 'WAITING',
        expiresAt: { gt: new Date() },
      },
    }),
    prisma.smartQueuePolicy.count({
      where: {
        attractionId: IDS.attractions.museum,
        enabled: true,
        mode: 'STAFF_CONTROLLED',
        pausedAt: null,
      },
    }),
    prisma.arrivalObservation.count({
      where: {
        attractionId: { in: [IDS.attractions.museum, IDS.attractions.cruise, IDS.attractions.eco] },
        observationKey: { startsWith: `${LIVE_AUTOPILOT_DEMO_MARKER}:` },
        actualArrivalsNext15m: { not: null },
      },
    }),
    prisma.livePrediction.count({
      where: {
        attractionId: IDS.attractions.museum,
        predictionType: 'ARRIVALS',
        usedFallback: false,
        confidence: { in: ['MEDIUM', 'HIGH'] },
        predictedAt: { gte: freshPredictionCutoff },
      },
    }),
    prisma.liveTripEvent.count({
      where: {
        liveTrip: { savedItineraryId: showcaseSavedItineraryId },
        type: { in: ['QUEUE_JOINED', 'ITEM_AT_RISK', 'AUTOPILOT_PROPOSED'] },
      },
    }),
    prisma.booking.count({
      where: {
        id: {
          in: [
            scenarioBookingId('museum-school-group-today'),
            scenarioBookingId('cruise-group-today'),
          ],
        },
        status: 'CONFIRMED',
      },
    }),
    prisma.attractionDailyStock.findUnique({
      where: { attractionId_date: { attractionId: IDS.attractions.museum, date: today } },
      select: { capacity: true, bookedQty: true, heldQty: true },
    }),
    prisma.timeSlotStock.findUnique({
      where: {
        timeSlotId_date: {
          timeSlotId: `${IDS.attractions.cruise}-slot-1`,
          date: today,
        },
      },
      select: { bookedQty: true, heldQty: true },
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
    forecasts: {
      controlledHistoryPoints: forecasts.reduce((sum, row) => sum + row._count._all, 0),
    },
    liveAutopilot: {
      showcaseTrips,
      showcaseItems,
      linkedBookings: showcaseLinkedBookings,
      pendingProposals: pendingAutopilotProposals,
      waitingQueueEntries,
      staffControlledPolicies: showcaseQueuePolicies,
      trainingObservations: liveObservations,
      freshNonFallbackPredictions: nonFallbackPredictions,
      explainabilityEvents: liveEvents,
      pressureSourceBookings: showcaseGroupBookings,
      museumInventoryRatio: museumStock?.capacity
        ? (Number(museumStock.bookedQty || 0) + Number(museumStock.heldQty || 0))
          / Number(museumStock.capacity)
        : 0,
      cruiseFirstSlotInventoryRatio:
        (Number(cruiseSlotStock?.bookedQty || 0) + Number(cruiseSlotStock?.heldQty || 0)) / 45,
    },
  };
}

function assertDemoReady(readiness) {
  const failures = [];
  const requireAtLeast = (field, minimum, label) => {
    if (Number(readiness[field] || 0) < minimum) {
      failures.push(`${label}: cần >= ${minimum}, hiện có ${readiness[field] || 0}`);
    }
  };
  requireAtLeast('accounts', 18, 'Tài khoản theo vai trò và khách hàng vận hành');
  requireAtLeast('pendingKyc', 2, 'Hồ sơ KYC chờ duyệt');
  requireAtLeast('pendingAttractions', 2, 'Địa điểm chờ duyệt');
  requireAtLeast(
    'scenarioBookings',
    Object.keys(SCENARIO_BOOKING_REFERENCES).length,
    'Booking theo trạng thái',
  );
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
  const live = readiness.liveAutopilot || {};
  const requireLiveAtLeast = (field, minimum, label) => {
    if (Number(live[field] || 0) < minimum) {
      failures.push(`${label}: cần >= ${minimum}, hiện có ${live[field] || 0}`);
    }
  };
  requireLiveAtLeast('showcaseTrips', 1, 'LiveTrip showcase đang hoạt động');
  requireLiveAtLeast('showcaseItems', 2, 'Hoạt động trong LiveTrip showcase');
  requireLiveAtLeast('linkedBookings', 1, 'Hoạt động liên kết booking thật');
  requireLiveAtLeast('pendingProposals', 1, 'Đề xuất Autopilot chờ Customer xác nhận');
  requireLiveAtLeast('waitingQueueEntries', 1, 'Lượt SmartQueue đang chờ');
  requireLiveAtLeast('staffControlledPolicies', 1, 'Chính sách SmartQueue do nhân viên điều phối');
  requireLiveAtLeast('trainingObservations', 288, 'Quan sát huấn luyện Live AI có nhãn');
  requireLiveAtLeast('freshNonFallbackPredictions', 1, 'Dự báo ML thật, còn mới và không fallback');
  requireLiveAtLeast('explainabilityEvents', 3, 'Event giải thích quyết định Live-AutoPilot');
  requireLiveAtLeast('pressureSourceBookings', 2, 'Booking đoàn tạo áp lực tồn chỗ có kiểm chứng');
  if (Number(live.museumInventoryRatio || 0) < 0.85) {
    failures.push(`Tỷ lệ tồn chỗ bảo tàng cho SmartQueue: cần >= 0.85, hiện có ${live.museumInventoryRatio || 0}`);
  }
  if (Number(live.cruiseFirstSlotInventoryRatio || 0) < 0.85) {
    failures.push(`Tỷ lệ tồn chỗ chuyến 16:30 cho Autopilot: cần >= 0.85, hiện có ${live.cruiseFirstSlotInventoryRatio || 0}`);
  }
  if (failures.length > 0) {
    const error = new Error(`Bộ dữ liệu vận hành chưa sẵn sàng:\n- ${failures.join('\n- ')}`);
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function printHandoff(readiness, forecastResults = [], liveShowcase = null) {
  console.log('\n============================================================');
  console.log('VIETTICKET OPERATIONAL SHOWCASE — READY');
  console.log('============================================================');
  console.log(`Ngày dữ liệu (Việt Nam): ${vietnamDateKey()}`);
  console.log(`Mật khẩu chung local: ${DEMO_PASSWORD}`);
  console.log('\nTài khoản:');
  console.log(`- Customer:       ${ACCOUNTS.customer.email}`);
  console.log(`- Partner:        ${ACCOUNTS.partner.email}`);
  console.log(`- Staff check-in: ${ACCOUNTS.gateStaff.email}`);
  console.log(`- Staff hỗ trợ:   ${ACCOUNTS.platformStaff.email}`);
  console.log(`- Admin:          ${ACCOUNTS.admin.email}`);
  console.log(`\nMã QR nhập tay: ${OPERATIONAL_VALUES.checkinQrPrimary}`);
  console.log(`Voucher: ${OPERATIONAL_VALUES.voucherCode} (giảm 15%, tối đa 100.000 VND, đơn từ 200.000 VND)`);
  console.log('\nReadiness:');
  console.log(JSON.stringify(readiness, null, 2));
  if (forecastResults.length > 0) {
    console.log('\nForecast cache:');
    console.log(JSON.stringify(forecastResults, null, 2));
  }
  if (liveShowcase) {
    console.log('\nLive-AutoPilot showcase:');
    console.log(JSON.stringify(liveShowcase, null, 2));
  }
  console.log('\nTrước mỗi lần tập/trình diễn: npm run demo:prepare');
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
  assertLocalDemoDatabase();

  console.log('Đang phục hồi bộ dữ liệu vận hành do script sở hữu...');
  await resetOwnedDemoData();
  console.log('Đang tạo tài khoản và hồ sơ KYC theo vai trò...');
  await seedIdentitiesAndPartners();
  console.log('Đang tạo catalog, ticket, lịch và hồ sơ moderation...');
  const attractions = await seedCatalog();
  console.log(`Đang tạo ${HISTORY_DAYS} ngày lịch sử doanh thu cho ba điểm vận hành...`);
  await seedForecastHistory(attractions);
  console.log('Đang tạo booking theo trạng thái, QR, refund và review...');
  const scenarioBookings = await seedScenarioBookings();
  await seedInventory(scenarioBookings);
  console.log('Đang tạo 288 quan sát có nhãn cho Live AI và chính sách SmartQueue...');
  const liveSignals = await seedLiveAutopilotSignals({
    attractionIds: [IDS.attractions.museum, IDS.attractions.cruise, IDS.attractions.eco],
    now: new Date(),
    prismaClient: prisma,
  });
  console.log('Đang tạo settlement, support, favorites, itinerary và audit log...');
  await seedSettlements(scenarioBookings);
  await seedSupportAndCustomerFeatures(scenarioBookings);
  console.log('Đang dựng LiveTrip showcase, dự báo ML, SmartQueue và đề xuất Autopilot...');
  const liveShowcase = await seedLiveAutopilotShowcase(scenarioBookings);
  await seedAuditLogs();
  console.log('Đang làm nóng forecast cache cho ba điểm của Partner...');
  const forecastResults = await prepareForecastCache();
  const readiness = assertDemoReady(await collectDemoReadiness());
  printHandoff(readiness, forecastResults, { ...liveShowcase, signals: liveSignals });
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
  BACKGROUND_CUSTOMERS,
  IDS,
  MARKER,
  OPERATIONAL_VALUES,
  PREFIX,
  addDateKeyDays,
  assertDemoReady,
  buildSubmittedSnapshot,
  fixtureId,
  scenarioBookingDefinitions,
  scenarioBookingId,
  scenarioRefundRequestId,
  vietnamDateKey,
};
