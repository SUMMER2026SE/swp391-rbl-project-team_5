'use strict';

/**
 * Bộ dữ liệu bổ sung cho các nghiệp vụ mới chưa được seed_defense_demo.js phủ.
 *
 * seed_defense_demo.js dựng nền (tài khoản, catalog, booking, refund, settlement,
 * Live-AutoPilot) nhưng không tạo dòng nào cho các bảng ra đời ở đợt merge cuối:
 * hỏi đáp công khai, vote hữu ích, yêu cầu đổi KYC, maker-checker chuyển khoản,
 * sổ cái voucher, manifest hành khách và thông tin hóa đơn.
 *
 * Script này chạy SAU demo:prepare và chỉ sở hữu dữ liệu do chính nó tạo:
 * mọi id đều dẫn xuất ổn định từ MARKER nên chạy lại là idempotent.
 *
 * Chạy:
 *   npm run demo:prepare      # nền
 *   npm run demo:gap          # bổ sung (script này)
 */

require('dotenv').config({ quiet: true });

const { createHash } = require('crypto');
const { Client } = require('pg');

const MARKER = 'GAP_DEMO_V1';
const DAY_MS = 24 * 60 * 60 * 1000;

function gapId(scope, key) {
  const hex = createHash('sha256')
    .update(`vietticket-gap-demo:${scope}:${key}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function assertLocalTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Tuyệt đối không seed dữ liệu demo trong production.');
  }
  let url;
  try {
    url = new URL(String(process.env.DATABASE_URL || ''));
  } catch {
    throw new Error('DATABASE_URL không hợp lệ; từ chối ghi dữ liệu demo.');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('demo:gap chỉ được phép ghi vào database chạy trên localhost.');
  }
  if (!process.argv.includes('--confirm-local-demo')) {
    throw new Error('Thiếu cờ --confirm-local-demo. Hãy chạy npm run demo:gap.');
  }
}

// ---------------------------------------------------------------------------
// Tra cứu neo dữ liệu. Không hardcode uuid của bộ nền: seed_defense_demo có thể
// đổi cách sinh id, nên luôn resolve qua email/tiêu đề là dữ liệu ổn định.
// ---------------------------------------------------------------------------
async function resolveAnchors(c) {
  const one = async (label, sql, params = []) => {
    const r = await c.query(sql, params);
    if (r.rowCount === 0) {
      throw new Error(`Không tìm thấy ${label}. Hãy chạy "npm run demo:prepare" trước.`);
    }
    return r.rows[0];
  };

  const userByEmail = (email) => one(`user ${email}`, 'select id, "fullName", email from "User" where email=$1', [email]);

  // Tuần tự: một pg Client không chạy song song nhiều query trên cùng kết nối.
  const customer = await userByEmail('minh.anh.nguyen@vietticket.local');
  const customer2 = await userByEmail('bui.mai.phuong@vietticket.local');
  const customer3 = await userByEmail('dang.quoc.huy@vietticket.local');
  const partnerUser = await userByEmail('hoang.nam.tran@vietticket.local');
  const admin = await userByEmail('ngoc.lan.vu@vietticket.local');
  const adminChecker = await userByEmail('minh.quan.ngo@vietticket.local');
  const platformStaff = await userByEmail('thu.ha.le@vietticket.local');
  const gateStaff = await userByEmail('quoc.bao.pham@vietticket.local');

  const partner = await one(
    'hồ sơ partner đã duyệt',
    'select id, "businessName", "bankAccountNumber", "bankName", "representativePhone", "businessAddress" from "PartnerProfile" where "userId"=$1',
    [partnerUser.id],
  );

  const museum = await one(
    'điểm tham quan bảo tàng',
    `select id, title from "Attraction" where "partnerId"=$1 and status='APPROVED' and title ilike '%Bảo tàng%'`,
    [partner.id],
  );
  const cruise = await one(
    'điểm tham quan du thuyền',
    `select id, title from "Attraction" where "partnerId"=$1 and status='APPROVED' and title ilike '%sông Sài Gòn%' order by title limit 1`,
    [partner.id],
  );

  // Loại trừ chính các bản nhân bản của script: nếu không, lần chạy thứ hai sẽ
  // chọn trúng bản clone (createdAt mới hơn) rồi tự xoá mất nguồn ở bước reset.
  const clonedBookingIds = ['bank-matched', 'bank-approved'].map((k) => gapId('booking', k));
  const bankBooking = await one(
    'booking chuyển khoản gốc của bộ nền',
    `select b.*, r.quantity from "Booking" b join "Reservation" r on r.id=b."reservationId"
     where b."paymentMethod"='bank_transfer' and b.id <> all($1::text[])
     order by b."createdAt" desc limit 1`,
    [clonedBookingIds],
  );

  const confirmedBookings = (await c.query(
    `select b.id, r.quantity, b."snapshotVisitDate", b."snapshotAttractionTitle"
     from "Booking" b join "Reservation" r on r.id=b."reservationId"
     where b."userId"=$1 and b.status in ('CONFIRMED','COMPLETED')
     order by b."snapshotVisitDate" desc`,
    [customer.id],
  )).rows;
  if (confirmedBookings.length < 2) {
    throw new Error('Cần ít nhất 2 booking CONFIRMED/COMPLETED của khách chính.');
  }

  // Lấy review của toàn bộ điểm thuộc đối tác demo, không chỉ 2 điểm chính,
  // để luôn còn review chưa ai vote cho hội đồng bấm thử trên giao diện.
  const reviews = (await c.query(
    `select rv.id, rv.rating, rv."userId" from "Review" rv
     join "Attraction" at on at.id = rv."attractionId"
     where at."partnerId" = $1 order by rv."createdAt" limit 8`,
    [partner.id],
  )).rows;
  if (reviews.length < 2) {
    throw new Error('Cần ít nhất 2 review của đối tác demo để tạo vote hữu ích.');
  }

  const ticketProduct = await one(
    'vé của bảo tàng',
    'select id, "sellingPrice" from "TicketProduct" where "attractionId"=$1 order by "sellingPrice" limit 1',
    [museum.id],
  );

  return {
    customer, customer2, customer3, partnerUser, admin, adminChecker, platformStaff, gateStaff,
    partner, museum, cruise, bankBooking, confirmedBookings, reviews, ticketProduct,
  };
}

// ---------------------------------------------------------------------------
// Dọn dữ liệu do chính script này sở hữu. Nhận diện bằng id dẫn xuất từ MARKER,
// không đụng tới bất kỳ dòng nào của bộ nền hay dữ liệu thật.
// ---------------------------------------------------------------------------
async function resetOwned(c, a) {
  const questionIds = ['answered', 'unanswered', 'hidden-admin', 'reported-2', 'auto-hidden']
    .map((k) => gapId('question', k));
  const clonedBookingIds = ['bank-matched', 'bank-approved'].map((k) => gapId('booking', k));
  const clonedReservationIds = ['bank-matched', 'bank-approved'].map((k) => gapId('reservation', k));
  const voucherIds = ['scope-attraction', 'scope-partner', 'exhausted-per-user']
    .map((k) => gapId('voucher', k));

  await c.query('delete from "AttractionQuestionReport" where "questionId" = any($1::text[])', [questionIds]);
  await c.query('delete from "AttractionQuestion" where id = any($1::text[])', [questionIds]);
  await c.query('delete from "ReviewHelpfulVote" where "reviewId" = any($1::text[])',
    [a.reviews.map((r) => r.id)]);
  await c.query('delete from "PartnerKycChangeRequest" where id = any($1::text[])',
    [['pending', 'approved', 'rejected'].map((k) => gapId('kyc-change', k))]);
  await c.query('delete from "BankTransferReconciliation" where "bookingId" = any($1::text[])', [clonedBookingIds]);
  await c.query('delete from "VoucherRedemption" where "voucherId" = any($1::text[])', [voucherIds]);
  await c.query('delete from "TicketInstance" where "bookingId" = any($1::text[])', [clonedBookingIds]);
  await c.query('delete from "Payment" where "bookingId" = any($1::text[])', [clonedBookingIds]);
  await c.query('delete from "Booking" where id = any($1::text[])', [clonedBookingIds]);
  await c.query('delete from "Reservation" where id = any($1::text[])', [clonedReservationIds]);
  await c.query('update "Booking" set "voucherId"=null where "voucherId" = any($1::text[])', [voucherIds]);
  await c.query('delete from "Voucher" where id = any($1::text[])', [voucherIds]);
  await c.query('delete from "User" where id=$1', [gapId('user', 'gate-scanner')]);
}

// --- A. Hỏi & đáp công khai -------------------------------------------------
async function seedQuestions(c, a) {
  const now = Date.now();
  const rows = [
    {
      key: 'answered',
      attractionId: a.museum.id,
      userId: a.customer2.id,
      question: 'Bảo tàng có cho phép chụp ảnh bên trong các phòng trưng bày không ạ?',
      answer: 'Dạ có. Quý khách được chụp ảnh không dùng đèn flash và không dùng chân máy tại toàn bộ khu trưng bày thường xuyên.',
      answeredById: a.partnerUser.id,
      status: 'PUBLISHED',
      reportCount: 0,
      ageDays: 6,
    },
    {
      key: 'unanswered',
      attractionId: a.museum.id,
      userId: a.customer3.id,
      question: 'Đoàn học sinh 30 em có được giảm giá vé nhóm không, và cần đặt trước bao lâu?',
      answer: null,
      answeredById: null,
      status: 'PUBLISHED',
      reportCount: 0,
      ageDays: 1,
    },
    {
      key: 'hidden-admin',
      attractionId: a.museum.id,
      userId: a.customer2.id,
      question: 'Liên hệ 09xxxxxxxx để mua vé rẻ hơn ngoài cổng, khỏi đặt trên web.',
      answer: null,
      answeredById: null,
      status: 'HIDDEN',
      reportCount: 0,
      moderationReason: 'Nội dung mời chào giao dịch ngoài nền tảng, vi phạm quy định cộng đồng.',
      moderatedAt: new Date(now - 2 * DAY_MS),
      ageDays: 3,
    },
    {
      key: 'reported-2',
      attractionId: a.cruise.id,
      userId: a.customer3.id,
      question: 'Tour này chán lắm đừng ai đi phí tiền!!!',
      answer: null,
      answeredById: null,
      status: 'PUBLISHED',
      reportCount: 2,
      ageDays: 2,
    },
    {
      key: 'auto-hidden',
      attractionId: a.cruise.id,
      userId: a.customer2.id,
      question: 'Spam quảng cáo dịch vụ không liên quan tới điểm tham quan.',
      answer: null,
      answeredById: null,
      status: 'HIDDEN',
      reportCount: 3,
      moderationReason: 'Tự động ẩn do đạt ngưỡng 3 lượt báo cáo.',
      moderatedAt: new Date(now - 1 * DAY_MS),
      ageDays: 4,
    },
  ];

  for (const r of rows) {
    const createdAt = new Date(now - r.ageDays * DAY_MS);
    await c.query(
      `insert into "AttractionQuestion"
       (id,"attractionId","userId",question,answer,"answeredById","answeredAt",status,"reportCount",
        "moderationReason","moderatedAt","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        gapId('question', r.key), r.attractionId, r.userId, r.question, r.answer, r.answeredById,
        r.answeredById ? new Date(createdAt.getTime() + 4 * 60 * 60 * 1000) : null,
        r.status, r.reportCount, r.moderationReason || null, r.moderatedAt || null, createdAt, createdAt,
      ],
    );
  }

  // Reporter phải là tài khoản khác tác giả câu hỏi. Pool phải đủ rộng để câu
  // hỏi "auto-hidden" đạt đúng ngưỡng 3 report thật, nếu không reportCount sẽ
  // nói dối so với số dòng report và màn hình kiểm duyệt mất tính thuyết phục.
  const reporters = [
    a.customer.id, a.customer2.id, a.customer3.id, a.platformStaff.id, a.gateStaff.id,
  ];
  const addReport = async (key, count, reason) => {
    const qid = gapId('question', key);
    const authorId = (await c.query('select "userId" from "AttractionQuestion" where id=$1', [qid])).rows[0].userId;
    const eligible = reporters.filter((id) => id !== authorId).slice(0, count);
    for (const uid of eligible) {
      await c.query(
        'insert into "AttractionQuestionReport" ("questionId","userId",reason,"createdAt") values ($1,$2,$3,now())',
        [qid, uid, reason],
      );
    }
    return eligible.length;
  };
  const r1 = await addReport('reported-2', 2, 'Nội dung công kích, không phải câu hỏi về điểm tham quan.');
  const r2 = await addReport('auto-hidden', 3, 'Spam quảng cáo.');

  // reportCount phải khớp số dòng report thật, nếu không màn hình kiểm duyệt sẽ nói dối.
  await c.query('update "AttractionQuestion" set "reportCount"=$2 where id=$1', [gapId('question', 'reported-2'), r1]);
  await c.query('update "AttractionQuestion" set "reportCount"=$2 where id=$1', [gapId('question', 'auto-hidden'), r2]);

  return { questions: rows.length, reports: r1 + r2 };
}

// --- B. Vote đánh giá hữu ích ----------------------------------------------
async function seedHelpfulVotes(c, a) {
  const voters = [a.customer2.id, a.customer3.id, a.platformStaff.id];
  let inserted = 0;
  // Review[0]: 3 vote. Review[1]: 1 vote. Các review còn lại: 0 vote.
  // Cố ý KHÔNG cho khách chính vote, để hội đồng bấm trực tiếp trên giao diện.
  const plan = [
    { review: a.reviews[0], count: 3 },
    { review: a.reviews[1], count: 1 },
  ];
  for (const { review, count } of plan) {
    if (!review) continue;
    const eligible = voters.filter((id) => id !== review.userId).slice(0, count);
    for (const uid of eligible) {
      await c.query(
        'insert into "ReviewHelpfulVote" ("reviewId","userId","createdAt") values ($1,$2,now()) on conflict do nothing',
        [review.id, uid],
      );
      inserted += 1;
    }
  }
  // Số review mà khách chính chưa vote — đây mới là con số quyết định hội đồng
  // có bấm thử được nút "Hữu ích" hay không.
  const votable = (await c.query(
    `select count(*)::int n from "Review" rv
     join "Attraction" at on at.id = rv."attractionId"
     where at."partnerId" = $1
       and rv."userId" <> $2
       and not exists (select 1 from "ReviewHelpfulVote" v where v."reviewId"=rv.id and v."userId"=$2)`,
    [a.partner.id, a.customer.id],
  )).rows[0].n;
  return { votes: inserted, votableByCustomer: votable };
}

// --- C. Yêu cầu đổi thông tin KYC ------------------------------------------
async function seedKycChangeRequests(c, a) {
  const now = Date.now();
  const rows = [
    {
      key: 'pending',
      status: 'PENDING',
      proposedData: {
        bankName: 'Ngân hàng TMCP Ngoại thương Việt Nam',
        bankAccountNumber: '0071000998877',
        bankAccountName: 'CONG TY TNHH DU LICH TRAI NGHIEM VIET',
      },
      reason: 'Doanh nghiệp chuyển tài khoản nhận tiền sang Vietcombank từ kỳ đối soát tháng 8.',
      reviewedById: null, reviewNote: null, reviewedAt: null, ageDays: 1,
    },
    {
      key: 'approved',
      status: 'APPROVED',
      proposedData: {
        representativePhone: '0917624381',
        businessAddress: '18 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
      },
      reason: 'Cập nhật địa chỉ trụ sở và số điện thoại người đại diện theo giấy phép mới.',
      reviewedById: a.admin.id,
      reviewNote: 'Đã đối chiếu giấy phép kinh doanh bản cập nhật, thông tin khớp.',
      reviewedAt: new Date(now - 5 * DAY_MS), ageDays: 8,
    },
    {
      key: 'rejected',
      status: 'REJECTED',
      proposedData: { taxCode: '0311111111' },
      reason: 'Xin đổi mã số thuế sang pháp nhân khác.',
      reviewedById: a.adminChecker.id,
      reviewNote: 'Từ chối: đổi mã số thuế đồng nghĩa đổi pháp nhân, phải đăng ký hồ sơ đối tác mới thay vì sửa hồ sơ cũ.',
      reviewedAt: new Date(now - 11 * DAY_MS), ageDays: 13,
    },
  ];

  for (const r of rows) {
    const createdAt = new Date(now - r.ageDays * DAY_MS);
    await c.query(
      `insert into "PartnerKycChangeRequest"
       (id,"partnerId","requestedById","proposedData",reason,status,"reviewedById","reviewNote","reviewedAt","createdAt","updatedAt")
       values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
      [
        gapId('kyc-change', r.key), a.partner.id, a.partnerUser.id, JSON.stringify(r.proposedData),
        r.reason, r.status, r.reviewedById, r.reviewNote, r.reviewedAt, createdAt, r.reviewedAt || createdAt,
      ],
    );
  }
  return { requests: rows.length };
}

// --- D. Maker-checker đối soát chuyển khoản ---------------------------------
// Nhân bản nguyên vẹn booking chuyển khoản có sẵn để mọi cột snapshot đều hợp lệ,
// thay vì dựng tay và bỏ sót ràng buộc nghiệp vụ.
async function cloneBankBooking(c, srcBookingId, key, overrides) {
  const newBookingId = gapId('booking', key);
  const newReservationId = gapId('reservation', key);

  const src = (await c.query('select "reservationId" from "Booking" where id=$1', [srcBookingId])).rows[0];

  // Hàm này được gọi nhiều lần trong cùng một transaction nên phải dọn bảng tạm
  // của lượt trước, "on commit drop" chỉ chạy khi transaction kết thúc.
  await c.query('drop table if exists _res_clone');
  await c.query('create temp table _res_clone on commit drop as select * from "Reservation" where id=$1', [src.reservationId]);
  await c.query('update _res_clone set id=$1, status=$2', [newReservationId, overrides.reservationStatus]);
  await c.query('insert into "Reservation" select * from _res_clone');

  await c.query('drop table if exists _bk_clone');
  await c.query('create temp table _bk_clone on commit drop as select * from "Booking" where id=$1', [srcBookingId]);
  await c.query(
    'update _bk_clone set id=$1, "reservationId"=$2, status=$3, "createdAt"=$4, "snapshotAt"=$4',
    [newBookingId, newReservationId, overrides.status, overrides.createdAt],
  );
  await c.query('insert into "Booking" select * from _bk_clone');

  return newBookingId;
}

async function seedBankReconciliation(c, a) {
  const now = Date.now();

  // (1) MATCHED — admin A đã khớp sao kê, chờ admin B duyệt. Đây là màn demo chính.
  const matchedBookingId = await cloneBankBooking(c, a.bankBooking.id, 'bank-matched', {
    status: 'PENDING_PAYMENT',
    reservationStatus: 'HELD',
    createdAt: new Date(now - 40 * 60 * 1000),
  });
  await c.query(
    `insert into "BankTransferReconciliation"
     (id,"bookingId","externalReference","receivedAmount","receivedAt","payerName","evidenceNote",
      status,"matchedById","matchedAt","approvedById","approvedAt","createdAt","updatedAt")
     values ($1,$2,$3,$4,$5,$6,$7,'MATCHED',$8,$9,null,null,$9,$9)`,
    [
      gapId('reconciliation', 'matched'), matchedBookingId, `FT${String(now).slice(-10)}01`,
      a.bankBooking.totalAmount, new Date(now - 25 * 60 * 1000), 'NGUYEN MINH ANH',
      'Khớp sao kê Vietcombank 09:12, nội dung chuyển khoản đúng định dạng.',
      a.admin.id, new Date(now - 20 * 60 * 1000),
    ],
  );

  // (2) APPROVED — đã đủ hai chữ ký, dùng làm lịch sử đối chiếu.
  const approvedBookingId = await cloneBankBooking(c, a.bankBooking.id, 'bank-approved', {
    status: 'CONFIRMED',
    reservationStatus: 'CONFIRMED',
    createdAt: new Date(now - 3 * DAY_MS),
  });
  await c.query(
    `insert into "BankTransferReconciliation"
     (id,"bookingId","externalReference","receivedAmount","receivedAt","payerName","evidenceNote",
      status,"matchedById","matchedAt","approvedById","approvedAt","createdAt","updatedAt")
     values ($1,$2,$3,$4,$5,$6,$7,'APPROVED',$8,$9,$10,$11,$9,$11)`,
    [
      gapId('reconciliation', 'approved'), approvedBookingId, `FT${String(now).slice(-10)}02`,
      a.bankBooking.totalAmount, new Date(now - 3 * DAY_MS), 'TRAN HOANG NAM',
      'Đã đối chiếu sao kê và ảnh chụp biên lai do khách gửi.',
      a.admin.id, new Date(now - 3 * DAY_MS + 30 * 60 * 1000),
      a.adminChecker.id, new Date(now - 3 * DAY_MS + 55 * 60 * 1000),
    ],
  );

  return { matchedBookingId, approvedBookingId };
}

// --- E. Phạm vi voucher + sổ cái sử dụng ------------------------------------
async function seedVouchers(c, a) {
  const now = Date.now();
  const start = new Date(now - 7 * DAY_MS);
  const expiry = new Date(now + 45 * DAY_MS);

  const vouchers = [
    {
      key: 'scope-attraction',
      code: 'BAOTANG25',
      discountType: 'PERCENTAGE', discountValue: 25, maxDiscount: 80000, minSpend: 100000,
      usageLimit: 50, maxUsesPerUser: 2,
      fundingSource: 'PARTNER', platformFundingPercent: 0,
      fundingPartnerId: a.partner.id,
      applicablePartnerId: null,
      applicableAttractionId: a.museum.id,
    },
    {
      key: 'scope-partner',
      code: 'DOITAC10',
      discountType: 'PERCENTAGE', discountValue: 10, maxDiscount: 50000, minSpend: null,
      usageLimit: 200, maxUsesPerUser: 3,
      fundingSource: 'SHARED', platformFundingPercent: 50,
      fundingPartnerId: a.partner.id,
      applicablePartnerId: a.partner.id,
      applicableAttractionId: null,
    },
    {
      key: 'exhausted-per-user',
      code: 'CHIMOTLAN',
      discountType: 'FIXED', discountValue: 30000, maxDiscount: null, minSpend: 50000,
      usageLimit: 100, maxUsesPerUser: 1,
      fundingSource: 'PLATFORM', platformFundingPercent: 100,
      fundingPartnerId: null,
      applicablePartnerId: null,
      applicableAttractionId: null,
    },
  ];

  for (const v of vouchers) {
    await c.query(
      `insert into "Voucher"
       (id,code,"discountType","discountValue","maxDiscount","minSpend","startDate","expiryDate",
        "isActive","usageLimit","usedCount","maxUsesPerUser","userId",source,"fundingSource",
        "platformFundingPercent","fundingPartnerId","applicablePartnerId","applicableAttractionId",
        "applicableTicketProductId","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,0,$10,null,'PROMOTION',$11,$12,$13,$14,$15,null,$16,$16)`,
      [
        gapId('voucher', v.key), v.code, v.discountType, v.discountValue, v.maxDiscount, v.minSpend,
        start, expiry, v.usageLimit, v.maxUsesPerUser, v.fundingSource, v.platformFundingPercent,
        v.fundingPartnerId, v.applicablePartnerId, v.applicableAttractionId, start,
      ],
    );
  }

  // Khách chính đã dùng hết hạn mức cá nhân của CHIMOTLAN (maxUsesPerUser=1).
  // Gắn vào một booking đã hoàn tất để màn hình checkout chặn đúng lý do
  // "đã dùng", chứ không phải "hết lượt toàn hệ thống".
  const usedBooking = a.confirmedBookings[0];
  const exhaustedId = gapId('voucher', 'exhausted-per-user');
  await c.query(
    `insert into "VoucherRedemption" (id,"voucherId","userId","bookingId",status,"releasedAt","createdAt","updatedAt")
     values ($1,$2,$3,$4,'ACTIVE',null,now(),now())
     on conflict ("bookingId") do update set "voucherId"=excluded."voucherId", status='ACTIVE'`,
    [gapId('redemption', 'active'), exhaustedId, a.customer.id, usedBooking.id],
  );
  await c.query('update "Voucher" set "usedCount"=1 where id=$1', [exhaustedId]);

  // Một lượt đã được hoàn trả (booking huỷ) để chứng minh sổ cái nhả lại lượt dùng.
  const cancelled = (await c.query(
    `select id, "userId" from "Booking" where status in ('CANCELLED','REFUNDED') order by "createdAt" desc limit 1`,
  )).rows[0];
  let released = 0;
  if (cancelled) {
    await c.query(
      `insert into "VoucherRedemption" (id,"voucherId","userId","bookingId",status,"releasedAt","createdAt","updatedAt")
       values ($1,$2,$3,$4,'RELEASED',now(),now(),now())
       on conflict ("bookingId") do update set status='RELEASED', "releasedAt"=now()`,
      [gapId('redemption', 'released'), gapId('voucher', 'scope-partner'), cancelled.userId, cancelled.id],
    );
    released = 1;
  }

  return { vouchers: vouchers.length, activeRedemptions: 1, releasedRedemptions: released };
}

// --- F/G. Manifest hành khách + thông tin hóa đơn ---------------------------
function isoDateMinusYears(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function seedManifestAndInvoice(c, a) {
  const [first, second] = a.confirmedBookings;

  // Manifest đủ số hành khách theo quantity của reservation — nếu lệch,
  // màn hình danh sách khách của đối tác sẽ báo dữ liệu không hợp lệ.
  const buildTravelers = (n) => Array.from({ length: n }, (_, i) => ({
    fullName: ['Nguyễn Minh Anh', 'Trần Bảo Long', 'Lê Thu Hằng', 'Phạm Gia Huy'][i] || `Khách ${i + 1}`,
    dateOfBirth: isoDateMinusYears(28 + i * 3),
    ageAtVisit: 28 + i * 3,
    heightCm: 165 + i * 4,
  }));

  await c.query('update "Booking" set "travelerManifest"=$2::jsonb where id=$1', [
    first.id,
    JSON.stringify({
      version: 1,
      travelers: buildTravelers(Number(first.quantity)),
      adultCompanion: null,
      confirmedAccurate: true,
    }),
  ]);

  // Booking thứ hai: có trẻ em đi kèm người lớn giám hộ.
  const childManifest = {
    version: 1,
    travelers: [
      {
        fullName: 'Nguyễn Bảo Ngọc',
        dateOfBirth: isoDateMinusYears(9),
        ageAtVisit: 9,
        heightCm: 132,
      },
      ...(Number(second.quantity) > 1
        ? [{ fullName: 'Nguyễn Minh Anh', dateOfBirth: isoDateMinusYears(31), ageAtVisit: 31, heightCm: 168 }]
        : []),
    ].slice(0, Number(second.quantity)),
    adultCompanion: Number(second.quantity) === 1
      ? {
        fullName: 'Nguyễn Minh Anh',
        dateOfBirth: isoDateMinusYears(31),
        ageAtVisit: 31,
        heightCm: 168,
        companionBookingReference: null,
      }
      : null,
    confirmedAccurate: true,
  };
  await c.query('update "Booking" set "travelerManifest"=$2::jsonb where id=$1',
    [second.id, JSON.stringify(childManifest)]);

  // Hóa đơn doanh nghiệp (có MST) và hóa đơn cá nhân.
  await c.query('update "Booking" set "invoiceDetails"=$2::jsonb where id=$1', [
    first.id,
    JSON.stringify({
      version: 1,
      requestInvoice: true,
      buyerType: 'BUSINESS',
      invoiceName: 'CÔNG TY TNHH GIẢI PHÁP SỰ KIỆN AN PHÚ',
      taxCode: '0312345678-001',
      invoiceAddress: '25 Lê Duẩn, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
      invoiceEmail: 'ketoan@anphu-events.local',
      requestedAt: new Date().toISOString(),
    }),
  ]);
  await c.query('update "Booking" set "invoiceDetails"=$2::jsonb where id=$1', [
    second.id,
    JSON.stringify({
      version: 1,
      requestInvoice: true,
      buyerType: 'PERSONAL',
      invoiceName: 'Nguyễn Minh Anh',
      taxCode: null,
      invoiceAddress: '145 Nguyễn Đình Chiểu, Phường Võ Thị Sáu, Quận 3, TP. Hồ Chí Minh',
      invoiceEmail: a.customer.email,
      requestedAt: new Date().toISOString(),
    }),
  ]);

  return { manifests: 2, invoices: 2 };
}

// --- H. Phân cấp nhân viên --------------------------------------------------
async function seedStaffAccessLevels(c, a) {
  // Bộ nền cấp MANAGER cho nhân viên cổng vì runbook yêu cầu họ cấp lại vé.
  // Thiếu mất nhánh SCANNER — cấp quyền chỉ quét vé, không được thu hồi/cấp lại.
  // Tạo thêm một nhân viên soát vé thật của cùng đối tác để hội đồng thấy được
  // giao diện khác nhau giữa hai cấp quyền.
  const scannerId = gapId('user', 'gate-scanner');
  const pwHash = (await c.query('select "passwordHash" from "User" where id=$1', [a.gateStaff.id]))
    .rows[0].passwordHash;
  await c.query(
    `insert into "User" (id,email,"passwordHash","fullName",role,provider,"isEmailVerified",status,
       "employerPartnerId","staffAccessLevel","termsAcceptedAt","termsVersion","privacyVersion",
       "consentIpAddress","createdAt","updatedAt")
     select $1,$2,$3,$4,'STAFF','LOCAL',true,'ACTIVE',$5,'SCANNER',
       now(),u."termsVersion",u."privacyVersion",'127.0.0.1',now(),now()
     from "User" u where u.id=$6
     on conflict (id) do update set "staffAccessLevel"='SCANNER', status='ACTIVE'`,
    [scannerId, 'soatve.canh@vietticket.local', pwHash, 'Cảnh Soát Vé',
      (await c.query('select "employerPartnerId" from "User" where id=$1', [a.gateStaff.id])).rows[0].employerPartnerId,
      a.gateStaff.id],
  );

  // Nhân viên nào còn NULL thì áp đúng quy tắc migration 20260729123000.
  const r = await c.query(
    `update "User"
     set "staffAccessLevel" = case when "employerPartnerId" is null then 'MANAGER'::"StaffAccessLevel"
                                   else 'SCANNER'::"StaffAccessLevel" end
     where role='STAFF' and "staffAccessLevel" is null
     returning email`,
  );
  const levels = (await c.query(
    `select "staffAccessLevel" as lvl, count(*)::int n from "User" where role='STAFF' group by 1 order by 1`,
  )).rows;
  return { promoted: r.rowCount, distribution: levels };
}

async function main() {
  assertLocalTarget();
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  try {
    await c.query('begin');
    const a = await resolveAnchors(c);
    await resetOwned(c, a);

    const questions = await seedQuestions(c, a);
    const votes = await seedHelpfulVotes(c, a);
    const kyc = await seedKycChangeRequests(c, a);
    const bank = await seedBankReconciliation(c, a);
    const vouchers = await seedVouchers(c, a);
    const manifest = await seedManifestAndInvoice(c, a);
    const staff = await seedStaffAccessLevels(c, a);
    await c.query('commit');

    console.log('');
    console.log('='.repeat(62));
    console.log(`BỔ SUNG NGHIỆP VỤ MỚI — ${MARKER}`);
    console.log('='.repeat(62));
    console.log(`Hỏi & đáp:            ${questions.questions} câu hỏi, ${questions.reports} lượt báo cáo`);
    console.log(`Vote hữu ích:         ${votes.votes} lượt (${votes.votableByCustomer} review khách chính bấm được)`);
    console.log(`Yêu cầu đổi KYC:      ${kyc.requests} (PENDING / APPROVED / REJECTED)`);
    console.log(`Đối soát chuyển khoản: 1 MATCHED chờ duyệt + 1 APPROVED`);
    console.log(`  - Booking chờ duyệt:  ${bank.matchedBookingId}`);
    console.log(`Voucher có phạm vi:   ${vouchers.vouchers} mã (BAOTANG25 / DOITAC10 / CHIMOTLAN)`);
    console.log(`Sổ cái voucher:       ${vouchers.activeRedemptions} ACTIVE, ${vouchers.releasedRedemptions} RELEASED`);
    console.log(`Manifest hành khách:  ${manifest.manifests} booking`);
    console.log(`Thông tin hóa đơn:    ${manifest.invoices} booking (BUSINESS + PERSONAL)`);
    console.log(`Phân cấp nhân viên:   nâng ${staff.promoted}; hiện có `
      + staff.distribution.map((x) => `${x.lvl}=${x.n}`).join(', '));
    console.log('='.repeat(62));
  } catch (error) {
    await c.query('rollback');
    throw error;
  } finally {
    await c.end();
  }
}

main().catch((error) => {
  console.error('Seed bổ sung thất bại:', error.message);
  process.exitCode = 1;
});
