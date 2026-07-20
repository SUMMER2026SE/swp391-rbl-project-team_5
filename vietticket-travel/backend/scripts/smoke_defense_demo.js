'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const request = require('supertest');

// Supertest uses an ephemeral Host header. Pin the trusted document origin so
// seeded KYC URLs and the approval security check evaluate against the same host.
process.env.BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

const PREFIX = 'defense-demo-v1-';
const PASSWORD = String(process.env.DEMO_PASSWORD || 'Demo@VietTicket2026');
const SEED_SCRIPT = path.join(__dirname, 'seed_defense_demo.js');
const { scenarioBookingId, scenarioRefundRequestId } = require('./seed_defense_demo');

const ACCOUNTS = {
  customer: 'demo.customer@vietticket.local',
  partner: 'demo.partner@vietticket.local',
  gateStaff: 'demo.gate@vietticket.local',
  platformStaff: 'demo.support@vietticket.local',
  admin: 'demo.admin@vietticket.local',
};

function resetDemoData() {
  execFileSync(process.execPath, [SEED_SCRIPT, '--reset', '--confirm-local-demo'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'ignore',
  });
}

function responseMessage(response) {
  return response.body?.message
    || response.body?.error?.message
    || response.text
    || 'Không có thông báo lỗi.';
}

async function call(label, requestPromise, expectedStatuses = [200]) {
  const response = await requestPromise;
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label}: HTTP ${response.status} - ${responseMessage(response)}`);
  }
  console.log(`PASS  ${label} (HTTP ${response.status})`);
  return response;
}

async function login(app, label, email) {
  const agent = request.agent(app);
  await call(
    `Đăng nhập nội bộ để kiểm thử vai trò ${label}`,
    agent.post('/api/auth/login').send({ email, password: PASSWORD }),
  );
  return agent;
}

async function assertFinalState(prisma) {
  const [
    approvedBooking,
    rejectedBooking,
    checkedInTicket,
    reissuedBooking,
    approvedRefund,
    rejectedRefund,
    repliedReview,
    moderatedReview,
    approvedKyc,
    rejectedKyc,
    approvedAttraction,
    rejectedAttraction,
    hiddenAttraction,
    restoredAttraction,
    approvedSettlement,
    paidSettlement,
    resolvedSupport,
  ] = await Promise.all([
    prisma.booking.findUnique({ where: { id: scenarioBookingId('partner-approve') } }),
    prisma.booking.findUnique({ where: { id: scenarioBookingId('partner-reject') } }),
    prisma.ticketInstance.findFirst({ where: { qrCodeToken: 'DEMOQR-CHECKIN-01' } }),
    prisma.booking.findUnique({
      where: { id: scenarioBookingId('reissue') },
      include: { ticketInstances: true },
    }),
    prisma.refundRequest.findUnique({
      where: { id: scenarioRefundRequestId('approve') },
      include: { booking: { select: { status: true } } },
    }),
    prisma.refundRequest.findUnique({ where: { id: scenarioRefundRequestId('reject') } }),
    prisma.review.findUnique({ where: { id: `${PREFIX}review-awaiting-partner` } }),
    prisma.review.findUnique({ where: { id: `${PREFIX}review-awaiting-moderation` } }),
    prisma.partnerProfile.findUnique({ where: { id: `${PREFIX}partner-kyc-approve` } }),
    prisma.partnerProfile.findUnique({ where: { id: `${PREFIX}partner-kyc-reject` } }),
    prisma.attraction.findUnique({ where: { id: `${PREFIX}attraction-pending-approve` } }),
    prisma.attraction.findUnique({ where: { id: `${PREFIX}attraction-pending-reject` } }),
    prisma.attraction.findUnique({ where: { id: `${PREFIX}attraction-museum` } }),
    prisma.attraction.findUnique({ where: { id: `${PREFIX}attraction-suspended` } }),
    prisma.partnerSettlement.findUnique({ where: { id: `${PREFIX}settlement-draft` } }),
    prisma.partnerSettlement.findUnique({ where: { id: `${PREFIX}settlement-approved` } }),
    prisma.supportTicket.findUnique({ where: { id: `${PREFIX}support-open` } }),
  ]);

  const assertions = [
    ['Booking đối tác duyệt', approvedBooking?.status === 'CONFIRMED'],
    ['Booking đối tác từ chối', rejectedBooking?.status === 'CANCELLED'],
    ['QR đã check-in', checkedInTicket?.status === 'USED' && Boolean(checkedInTicket?.checkedInAt)],
    [
      'Cấp lại vé giữ đúng một QR hợp lệ',
      reissuedBooking?.ticketInstances?.filter((ticket) => ticket.status === 'VALID').length === 1
        && reissuedBooking?.ticketInstances?.some((ticket) => ticket.status === 'EXPIRED'),
    ],
    [
      'Yêu cầu hoàn được duyệt và booking đã hoàn tiền',
      approvedRefund?.status === 'APPROVED' && approvedRefund?.booking?.status === 'REFUNDED',
    ],
    ['Hoàn tiền bị từ chối', rejectedRefund?.status === 'REJECTED'],
    ['Partner đã phản hồi review', Boolean(repliedReview?.replyComment)],
    ['Review vi phạm đã ẩn', moderatedReview?.isHidden === true],
    ['KYC được duyệt', approvedKyc?.status === 'APPROVED'],
    ['KYC bị từ chối', rejectedKyc?.status === 'REJECTED'],
    ['Địa điểm được duyệt', approvedAttraction?.status === 'APPROVED'],
    ['Địa điểm bị từ chối', rejectedAttraction?.status === 'REJECTED'],
    [
      'Địa điểm đang hoạt động đã ẩn',
      hiddenAttraction?.status === 'APPROVED'
        && hiddenAttraction?.operationalStatus === 'SUSPENDED'
        && hiddenAttraction?.publicationStatus === 'PAUSED',
    ],
    [
      'Địa điểm tạm ngưng đã khôi phục nhưng chờ Partner phát hành lại',
      restoredAttraction?.status === 'APPROVED'
        && restoredAttraction?.operationalStatus === 'ACTIVE'
        && restoredAttraction?.publicationStatus === 'PAUSED',
    ],
    ['Đối soát nháp được duyệt', approvedSettlement?.status === 'APPROVED'],
    ['Đối soát được ghi nhận đã trả', paidSettlement?.status === 'PAID'],
    ['Yêu cầu hỗ trợ đã được giải quyết', resolvedSupport?.status === 'RESOLVED'],
  ];

  for (const [label, passed] of assertions) {
    if (!passed) throw new Error(`Sai hậu điều kiện: ${label}`);
    console.log(`PASS  ${label}`);
  }
}

async function run() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không được chạy smoke test dữ liệu demo trong production.');
  }

  console.log('Đang tạo lại dữ liệu sạch trước smoke test...');
  resetDemoData();

  // Require sau bước reset để auth limiter và Prisma bắt đầu trong một tiến trình sạch.
  const app = require('../src/app');
  const prisma = require('../src/config/prisma');

  try {
    const [customer, partner, gateStaff, platformStaff, admin] = await Promise.all([
      login(app, 'CUSTOMER', ACCOUNTS.customer),
      login(app, 'PARTNER', ACCOUNTS.partner),
      login(app, 'GATE STAFF', ACCOUNTS.gateStaff),
      login(app, 'PLATFORM STAFF', ACCOUNTS.platformStaff),
      login(app, 'ADMIN', ACCOUNTS.admin),
    ]);

    const refundPreview = await call(
      'Khách xem chính sách và số tiền hoàn trước khi gửi',
      customer.get(`/api/payments/refund-preview/${scenarioBookingId('refund-customer-create')}`),
    );
    if (!refundPreview.body?.data?.refundable || refundPreview.body.data.refundAmount <= 0) {
      throw new Error('Refund preview không trả về một khoản hoàn hợp lệ.');
    }

    await call(
      'Khách tạo đánh giá cho chuyến đã hoàn thành',
      customer.post('/api/reviews').send({
        bookingId: scenarioBookingId('review-create'),
        rating: 5,
        comment: 'Quy trình đặt vé rõ ràng, nhân viên hướng dẫn tận tình.',
      }),
      [201],
    );
    await call(
      'Khách bổ sung tin nhắn vào yêu cầu hỗ trợ',
      customer.post(`/api/support/tickets/${PREFIX}support-open/messages`).send({
        message: 'Tôi gửi thêm mã đơn để nhân viên kiểm tra giúp trước giờ tham quan.',
      }),
      [201],
    );

    await call(
      'Partner duyệt booking chờ xác nhận',
      partner.patch(`/api/partners/bookings/${scenarioBookingId('partner-approve')}/approve`),
    );
    await call(
      'Partner từ chối booking và kích hoạt luồng hoàn bắt buộc',
      partner.patch(`/api/partners/bookings/${scenarioBookingId('partner-reject')}/reject`).send({
        reason: 'Tàu phải bảo trì đột xuất nên không thể phục vụ đúng khung giờ đã đặt.',
      }),
    );
    await call(
      'Partner phản hồi đánh giá của khách',
      partner.post(`/api/reviews/${PREFIX}review-awaiting-partner/reply`).send({
        replyComment: 'Cảm ơn góp ý của bạn. Chúng tôi đã bổ sung biển hướng dẫn tại quầy đón khách.',
      }),
    );

    // Smoke test có thể chạy ban đêm; chỉ trong transaction kiểm thử này mở
    // cửa sổ check-in toàn ngày. Khối finally seed lại lịch công khai 08:00–17:00.
    await prisma.attraction.update({
      where: { id: `${PREFIX}attraction-museum` },
      data: { openTime: '00:00', closeTime: '23:59' },
    });
    await call('Nhân viên cổng tra cứu QR hợp lệ', gateStaff.get('/api/staff/checkin/DEMOQR-CHECKIN-01'));
    await call('Nhân viên cổng check-in QR', gateStaff.post('/api/staff/checkin/DEMOQR-CHECKIN-01'));
    await call(
      'Nhân viên cổng thu hồi QR cũ và cấp lại vé',
      gateStaff.post(`/api/staff/bookings/${scenarioBookingId('reissue')}/reissue`).send({
        reasonCode: 'DAMAGED_QR',
        reason: 'Mã QR trên điện thoại của khách bị lỗi hiển thị tại cổng.',
      }),
    );

    await call(
      'Nhân viên nền tảng hoàn tất yêu cầu hoàn đã đối soát sandbox',
      platformStaff.patch(`/api/staff/refunds/${scenarioRefundRequestId('approve')}`).send({
        action: 'APPROVED',
        staffNotes: 'Đã kiểm tra giao dịch và xác nhận kết quả hoàn tiền sandbox thành công.',
      }),
    );
    await call(
      'Nhân viên nền tảng từ chối yêu cầu hoàn không đủ điều kiện',
      platformStaff.patch(`/api/staff/refunds/${scenarioRefundRequestId('reject')}`).send({
        action: 'REJECTED',
        staffNotes: 'Yêu cầu đã quá thời hạn hoàn tiền theo chính sách được lưu tại thời điểm đặt.',
      }),
    );
    await call(
      'Nhân viên hỗ trợ nhận và trả lời yêu cầu mở',
      platformStaff.post(`/api/support/tickets/${PREFIX}support-open/messages`).send({
        message: 'Chúng tôi đã kiểm tra mã đơn và xác nhận vé vẫn còn hiệu lực để sử dụng.',
      }),
      [201],
    );
    await call(
      'Nhân viên hỗ trợ đóng yêu cầu với kết luận nghiệp vụ',
      platformStaff.patch(`/api/support/tickets/${PREFIX}support-open/status`).send({
        status: 'RESOLVED',
        resolutionCode: 'RESOLVED_INFORMATION',
        resolutionNote: 'Đã xác nhận vé còn hiệu lực và hướng dẫn khách thời gian có mặt tại cổng.',
      }),
    );

    await call(
      'Admin duyệt hồ sơ KYC đủ giấy tờ',
      admin.put(`/api/admin/partners/${PREFIX}partner-kyc-approve/review`).send({ action: 'APPROVED' }),
    );
    await call(
      'Admin từ chối hồ sơ KYC thiếu nhất quán',
      admin.put(`/api/admin/partners/${PREFIX}partner-kyc-reject/review`).send({
        action: 'REJECTED',
        rejectionReason: 'Tên chủ tài khoản ngân hàng chưa trùng với tên pháp lý trên giấy phép kinh doanh.',
      }),
    );
    await call(
      'Admin duyệt địa điểm có snapshot hợp lệ',
      admin.put(`/api/admin/attractions/${PREFIX}attraction-pending-approve/review`).send({ action: 'APPROVED' }),
    );
    await call(
      'Admin từ chối địa điểm cần bổ sung hồ sơ',
      admin.put(`/api/admin/attractions/${PREFIX}attraction-pending-reject/review`).send({
        action: 'REJECTED',
        rejectionReason: 'Cần bổ sung phương án an toàn đường thủy và ảnh rõ khu vực trang bị áo phao.',
      }),
    );
    await call(
      'Admin tạm ẩn địa điểm đang kinh doanh',
      admin.put(`/api/admin/attractions/${PREFIX}attraction-museum/hide`).send({
        reason: 'Tạm ẩn để kiểm tra phản ánh về thời gian mở cửa trong ngày lễ.',
      }),
    );
    await call(
      'Admin khôi phục địa điểm đã khắc phục',
      admin.put(`/api/admin/attractions/${PREFIX}attraction-suspended/restore`),
    );
    await call(
      'Admin ẩn đánh giá vi phạm và ghi lý do',
      admin.patch(`/api/reviews/${PREFIX}review-awaiting-moderation/moderate`).send({
        isHidden: true,
        reason: 'Nội dung chứa công kích cá nhân, không phản ánh chất lượng dịch vụ du lịch.',
      }),
    );
    await call(
      'Admin duyệt kỳ đối soát nháp',
      admin.patch(`/api/admin/settlements/${PREFIX}settlement-draft/status`).send({ status: 'APPROVED' }),
    );
    await call(
      'Admin ghi nhận đã chuyển khoản kỳ đối soát',
      admin.patch(`/api/admin/settlements/${PREFIX}settlement-approved/status`).send({
        status: 'PAID',
        bankReference: 'DEMO-SMOKE-TRANSFER-001',
      }),
    );

    await assertFinalState(prisma);
    console.log('\nSMOKE TEST THÀNH CÔNG: các chuỗi nghiệp vụ demo chính đều qua kiểm tra.');
  } finally {
    await prisma.$disconnect();
  }
}

let smokeError = null;
run()
  .catch((error) => {
    smokeError = error;
    console.error(`\nSMOKE TEST THẤT BẠI: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      console.log('\nĐang reset lại dữ liệu chuẩn dành cho buổi demo...');
      resetDemoData();
      if (!smokeError) console.log('Dữ liệu demo đã được phục hồi nguyên trạng.');
    } catch (resetError) {
      console.error(`Không thể phục hồi dữ liệu demo: ${resetError.message}`);
      process.exitCode = 1;
    }
  });
