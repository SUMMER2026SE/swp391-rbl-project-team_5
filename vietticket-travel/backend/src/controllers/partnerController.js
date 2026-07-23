const prisma = require('../config/prisma');
const { Prisma } = require('@prisma/client');
const { sanitizeUser } = require('./authController');
const { validateKyc } = require('../utils/partnerValidators');
const { isValidPhoneNumber } = require('../utils/validators');
const { emitBookingStatusUpdated } = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');
const {
  sendBookingCancelledByPartnerEmail,
  sendBookingRejectedEmail,
} = require('../utils/mailer');
const {
  confirmReservationAndStock,
  createTicketInstances,
  selectBookingPayment,
} = require('./bookingController');
const { releaseInventory } = require('../utils/refundService');
const {
  getBookingActivityWindow,
  getManualApprovalDeadline,
} = require('../utils/activityTime');
const { expirePendingPartnerBooking } = require('../utils/pendingPartnerWorker');
const { queueMandatoryRefund } = require('../services/mandatoryRefundService');
const { getRequestIp, writeAuditLog } = require('../utils/auditLog');
const { formatBookingReference } = require('../utils/bookingReference');
const {
  isDocumentOwnedByUser,
  removeUnreferencedDocumentsForUser,
} = require('../middleware/uploadMiddleware');
const {
  buildTimeline,
  getPeriodStart,
  normalizePeriod,
} = require('../services/analyticsService');
const {
  buildRecognizedBookingPeriodWhere,
  recognizedAmountsOf,
  recognizedAtOf,
} = require('../services/financialReportService');
const { hasAnyRole } = require('../utils/userRoles');

// Ngày theo giờ Việt Nam (GMT+7) dạng YYYY-MM-DD. Cắt trực tiếp toISOString() theo
// UTC sẽ lệch 1 ngày cho đơn tạo trong khung 00:00–07:00 giờ VN.
function toVietnamDateString(value) {
  return new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

const CURRENT_KYC_CONSENT_VERSION = '2026-07-17-v1';
const KYC_REVIEW_FIELDS = [
  'businessName',
  'businessLicenseUrl',
  'taxCode',
  'registrationDate',
  'representativeName',
  'representativePhone',
  'businessAddress',
  'bankName',
  'branchName',
  'bankAccountNumber',
  'bankAccountName',
  'swiftCode',
  'payoutCurrency',
];

function toNullable(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function bookingConflict(message = 'Đơn đặt vé đã được xử lý trước đó.') {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function emptyPartnerBookingStats() {
  return {
    total: 0,
    confirmed: 0,
    pendingPartner: 0,
    recognizedRevenue: 0,
  };
}

function canSubmitPartnerKyc(user) {
  return hasAnyRole(user, ['CUSTOMER', 'PARTNER'])
    && !hasAnyRole(user, ['ADMIN', 'STAFF']);
}

// Định dạng hồ sơ đối tác trả về cho FE (trang Cài đặt + Pending)
function toPartnerResponse(partner, user) {
  return {
    id: partner.id,
    businessName: partner.businessName,
    legalBusinessName: partner.businessName,
    businessLicenseUrl: partner.businessLicenseUrl || '',
    taxCode: partner.taxCode || '',
    registrationDate: partner.registrationDate
      ? new Date(partner.registrationDate).toISOString().slice(0, 10)
      : '',
    representativeName: partner.representativeName || '',
    representativePhone: partner.representativePhone || '',
    businessAddress: partner.businessAddress || '',
    bankName: partner.bankName || '',
    branchName: partner.branchName || '',
    bankAccountNumber: partner.bankAccountNumber || '',
    bankAccountName: partner.bankAccountName || '',
    swiftCode: partner.swiftCode || '',
    payoutCurrency: partner.payoutCurrency || 'VND',
    website: partner.website || '',
    description: partner.description || '',
    kycConsentAccepted: Boolean(partner.kycConsentAccepted),
    kycConsentVersion: partner.kycConsentVersion || '',
    kycConsentAcceptedAt: partner.kycConsentAcceptedAt || null,
    status: partner.status, // PENDING | APPROVED | REJECTED | SUSPENDED
    rejectionReason: partner.rejectionReason || '',
    // Thông tin tài khoản dùng cho tab "Thông tin đối tác"
    displayName: user?.fullName || partner.businessName,
    contactEmail: user?.email || '',
    phone: user?.profile?.phoneNumber || '',
    createdAt: partner.createdAt,
  };
}

// POST /api/partners/register — Nộp hồ sơ KYC, tạo PartnerProfile ở trạng thái PENDING
async function submitKyc(req, res, next) {
  try {
    if (!canSubmitPartnerKyc(req.user)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'CUSTOMER_OR_PARTNER_REQUIRED',
          message: 'Chi tai khoan khach hang hoac doi tac can nop lai ho so moi co the dang ky doi tac.',
        },
      });
    }

    const validationError = validateKyc(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }
    if (!isDocumentOwnedByUser(req.body.businessLicenseUrl, req.user.id, req)) {
      return res.status(400).json({
        message: 'Tài liệu pháp lý phải được tải lên qua hệ thống VietTicket.',
      });
    }

    const existing = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

    // A suspension is an operational sanction and can only be lifted by an administrator.
    const isResubmission = existing?.status === 'REJECTED';

    if (existing && !isResubmission) {
      return res.status(409).json({
        message: 'Bạn đã nộp hồ sơ đối tác trước đó.',
        partner: toPartnerResponse(existing, req.user),
      });
    }

    const consentAcceptedAt = new Date();
    const data = {
      userId: req.user.id,
      businessName: req.body.businessName.trim(),
      businessLicenseUrl: toNullable(req.body.businessLicenseUrl) ?? null,
      taxCode: String(req.body.taxCode).trim(),
      registrationDate: new Date(`${req.body.registrationDate}T00:00:00.000Z`),
      representativeName: req.body.representativeName.trim(),
      representativePhone: req.body.representativePhone.trim(),
      businessAddress: req.body.businessAddress.trim(),
      bankName: toNullable(req.body.bankName) ?? null,
      branchName: toNullable(req.body.branchName) ?? null,
      bankAccountNumber: toNullable(req.body.bankAccountNumber) ?? null,
      bankAccountName: toNullable(req.body.bankAccountName) ?? null,
      swiftCode: toNullable(req.body.swiftCode) ?? null,
      payoutCurrency: String(req.body.payoutCurrency || 'VND').trim().toUpperCase(),
      kycConsentAccepted: true,
      kycConsentVersion: CURRENT_KYC_CONSENT_VERSION,
      kycConsentAcceptedAt: consentAcceptedAt,
      kycConsentIpAddress: getRequestIp(req),
      status: 'PENDING',
    };

    const partner = await prisma.$transaction(async (tx) => {
      let submittedPartner;
      if (isResubmission) {
        const updateData = { ...data, status: 'PENDING', rejectionReason: null };
        delete updateData.userId;
        submittedPartner = await tx.partnerProfile.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        submittedPartner = await tx.partnerProfile.create({ data });
      }

      await writeAuditLog({
        client: tx,
        req,
        action: isResubmission ? 'PARTNER_KYC_RESUBMITTED' : 'PARTNER_KYC_SUBMITTED',
        entityType: 'PARTNER',
        entityId: submittedPartner.id,
        metadata: {
          consentVersion: CURRENT_KYC_CONSENT_VERSION,
          previousStatus: existing?.status || null,
          documentFilename: new URL(data.businessLicenseUrl).pathname.split('/').pop(),
        },
      });
      return submittedPartner;
    });

    await removeUnreferencedDocumentsForUser(req.user.id, [
      partner.businessLicenseUrl,
    ]).catch(() => undefined);

    const refreshedUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true, roleMemberships: true },
    });

    return res.status(isResubmission ? 200 : 201).json({
      success: true,
      data: toPartnerResponse(partner, refreshedUser),
      message: 'Nộp hồ sơ đối tác thành công. Hồ sơ của bạn đang được xét duyệt.',
      partner: toPartnerResponse(partner, refreshedUser),
      user: sanitizeUser(refreshedUser),
    });
  } catch (error) {
    const uniqueTarget = Array.isArray(error.meta?.target)
      ? error.meta.target
      : [error.meta?.target].filter(Boolean);
    if (error.code === 'P2002' && uniqueTarget.some((target) => String(target).includes('taxCode'))) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TAX_CODE_ALREADY_REGISTERED',
          message: 'Mã số thuế này đã được sử dụng cho một hồ sơ đối tác khác.',
        },
      });
    }
    next(error);
  }
}

// GET /api/partners/me — Lấy hồ sơ đối tác hiện tại
async function getMyPartner(req, res, next) {
  try {
    const partner = req.partner || await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ đối tác.' },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true, roleMemberships: true },
    });

    const data = toPartnerResponse(partner, user);
    return res.status(200).json({ success: true, data, partner: data });
  } catch (error) {
    next(error);
  }
}

// PUT /api/partners/settings — Cập nhật thông tin đối tác (tab Cài đặt)
async function updateSettings(req, res, next) {
  try {
    const requestedKycChanges = KYC_REVIEW_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field));
    if (requestedKycChanges.length > 0) {
      return res.status(409).json({
        message: 'Thông tin pháp lý và nhận tiền chỉ được thay đổi qua quy trình xác minh của VietTicket.',
        code: 'KYC_CHANGE_REQUIRES_REVIEW',
        fields: requestedKycChanges,
      });
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'contactEmail')) {
      return res.status(409).json({
        message: 'Email đăng nhập chỉ được thay đổi qua quy trình xác minh email.',
        code: 'EMAIL_CHANGE_REQUIRES_VERIFICATION',
      });
    }
    const editableFields = new Set(['displayName', 'phone', 'website', 'description']);
    const unsupportedFields = Object.keys(req.body || {}).filter(
      (field) => !editableFields.has(field),
    );
    if (unsupportedFields.length > 0) {
      return res.status(400).json({
        message: 'Yêu cầu chứa trường cài đặt không được hỗ trợ.',
        code: 'UNSUPPORTED_SETTINGS_FIELDS',
        fields: unsupportedFields,
      });
    }

    const partnerUpdate = {};
    if (req.body.website !== undefined) {
      const website = toNullable(req.body.website) ?? null;
      if (website) {
        try {
          const parsedWebsite = new URL(website);
          if (!['http:', 'https:'].includes(parsedWebsite.protocol) || website.length > 255) {
            throw new Error('invalid website');
          }
        } catch {
          return res.status(400).json({ message: 'Website phải là địa chỉ HTTP/HTTPS hợp lệ.' });
        }
      }
      partnerUpdate.website = website;
    }
    if (req.body.description !== undefined) {
      const description = toNullable(req.body.description) ?? null;
      if (description && description.length > 2000) {
        return res.status(400).json({ message: 'Mô tả đối tác không được vượt quá 2.000 ký tự.' });
      }
      partnerUpdate.description = description;
    }

    // Cập nhật song song thông tin tài khoản (User + UserProfile)
    const userUpdate = {};
    const profileUpdate = {};
    if (req.body.displayName !== undefined) {
      const displayName = String(req.body.displayName).trim().replace(/\s+/g, ' ');
      if (displayName.length < 2 || displayName.length > 100) {
        return res.status(400).json({ message: 'Tên hiển thị phải từ 2 đến 100 ký tự.' });
      }
      userUpdate.fullName = displayName;
    }
    if (req.body.phone !== undefined) {
      const phone = toNullable(req.body.phone) ?? null;
      if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
      }
      profileUpdate.phoneNumber = phone;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true, roleMemberships: true },
    });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản đối tác.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const partner = Object.keys(partnerUpdate).length > 0
        ? await tx.partnerProfile.update({
          where: { id: req.partner.id },
          data: partnerUpdate,
        })
        : req.partner;

      let updatedUser = user;
      if (Object.keys(userUpdate).length > 0 || Object.keys(profileUpdate).length > 0) {
        updatedUser = await tx.user.update({
          where: { id: req.user.id },
          data: {
            ...userUpdate,
            ...(Object.keys(profileUpdate).length > 0
              ? {
                  profile: {
                    upsert: { create: profileUpdate, update: profileUpdate },
                  },
                }
              : {}),
          },
          include: { profile: true, roleMemberships: true },
        });
      }

      const changedFields = [
        ...Object.keys(partnerUpdate),
        ...Object.keys(userUpdate),
        ...Object.keys(profileUpdate),
      ];
      if (changedFields.length > 0) {
        await writeAuditLog({
          client: tx,
          req,
          action: 'PARTNER_PROFILE_UPDATED',
          entityType: 'PARTNER',
          entityId: req.partner.id,
          metadata: { changedFields },
        });
      }

      return { partner, user: updatedUser };
    });

    return res.json({
      message: 'Cập nhật thông tin đối tác thành công.',
      partner: toPartnerResponse(result.partner, result.user),
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/partners/dashboard — Thống kê tổng quan (số liệu thật từ DB)
// GET /api/partners/dashboard — Thống kê tổng quan (số liệu thật từ DB)
async function getDashboard(req, res, next) {
  try {
    const partnerId = req.partner.id;

    const attractions = await prisma.attraction.findMany({
      where: { partnerId, archivedAt: null },
      select: {
        id: true,
        status: true,
        publicationStatus: true,
        operationalStatus: true,
      },
    });

    const attractionIds = attractions.map((a) => a.id);

    const totalTickets = attractionIds.length
      ? await prisma.ticketProduct.count({
          where: { attractionId: { in: attractionIds }, archivedAt: null },
        })
      : 0;

    // Tính số liệu booking thật từ DB
    let totalBookingsThisMonth = 0;
    let revenueThisMonth = 0;
    let ticketsSoldThisMonth = 0;
    let totalRevenue = 0;
    let netRevenueThisMonth = 0;
    let totalNetRevenue = 0;
    let totalTicketsSold = 0;
    let pendingBookings = 0;
    let occupancyRate = 0;
    let recentBookings = [];

    // Doanh thu tính theo partner và KHÔNG lọc archived để KHỚP với getReports
    // (tránh lệch số liệu khi partner đã lưu trữ địa điểm/vé từng có đơn đã thanh toán).
    {
      const now = new Date();
      const startOfMonth = getPeriodStart('month', now);
      const revenueBookings = await prisma.booking.findMany({
        where: {
          ...buildRecognizedBookingPeriodWhere(new Date(0), now),
          reservation: { ticketProduct: { attraction: { partnerId } } },
        },
        select: {
          status: true,
          createdAt: true,
          snapshotVisitDate: true,
          commissionRateSnapshot: true,
          commissionAmountSnapshot: true,
          partnerNetAmountSnapshot: true,
          payments: { where: { status: 'SUCCESS', isDuplicate: false }, select: { amount: true } },
          refundTransactions: {
            where: { status: 'SUCCESS' },
            select: {
              amount: true,
              processedAt: true,
              reconciledAt: true,
              createdAt: true,
              refundRequest: { select: { type: true } },
            },
          },
          reservation: { select: { quantity: true, date: true } },
        },
      });
      revenueBookings.forEach((b) => {
        const recognized = recognizedAmountsOf(b);
        if (recognized.netAmount <= 0) return;
        const qty = ['COMPLETED', 'NO_SHOW'].includes(b.status)
          ? Number(b.reservation?.quantity || 0)
          : 0;
        totalRevenue += recognized.netAmount;
        totalNetRevenue += recognized.partnerPayableAmount;
        totalTicketsSold += qty;
        const recognizedAt = new Date(recognizedAtOf(b) || now);
        if (recognizedAt >= startOfMonth) {
          revenueThisMonth += recognized.netAmount;
          netRevenueThisMonth += recognized.partnerPayableAmount;
          ticketsSoldThisMonth += qty;
        }
      });

      // "Đặt vé tháng này" là chỉ số SẢN LƯỢNG (khác doanh thu ghi nhận theo ngày
      // sử dụng ở trên). Đếm số đơn đã thanh toán thành công tạo trong tháng, khớp
      // với danh sách /partner/bookings mà thẻ này liên kết tới.
      totalBookingsThisMonth = await prisma.booking.count({
        where: {
          reservation: { ticketProduct: { attraction: { partnerId } } },
          isForecastTrainingSample: false,
          status: { not: 'PENDING_PAYMENT' },
          payments: { some: { status: 'SUCCESS', isDuplicate: false } },
          createdAt: { gte: startOfMonth },
        },
      });
    }

    if (attractionIds.length > 0) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Lấy tất cả bookings liên quan đến partner này qua reservation -> ticketProduct -> attraction
      const ticketProducts = await prisma.ticketProduct.findMany({
        where: { attractionId: { in: attractionIds }, archivedAt: null },
        select: { id: true },
      });
      const ticketProductIds = ticketProducts ? ticketProducts.map((r) => r.id) : [];

      if (ticketProductIds.length > 0) {
        // Lấy reservationIds có ticketProductId thuộc partner
        const reservations = await prisma.reservation.findMany({
          where: { ticketProductId: { in: ticketProductIds } },
          select: { id: true },
        });
        const reservationIds = reservations ? reservations.map((r) => r.id) : [];

        if (reservationIds.length > 0) {
          // (Doanh thu đã được tính theo partner ở trên — KHỚP getReports.)
          // Đơn chờ duyệt (PENDING_PAYMENT)
          pendingBookings = await prisma.booking.count({
            where: {
              reservationId: { in: reservationIds },
              isForecastTrainingSample: false,
              status: 'PENDING_PARTNER',
            },
          });

          // Tỷ lệ lấp đầy kho vé: sum(DailyStock.bookedQuantity) / sum(DailyStock.capacity) trên các ticketProduct của partner trong tháng hiện tại
          const dailyStocks = (await prisma.dailyStock.findMany({
            where: {
              ticketProductId: { in: ticketProductIds },
              date: {
                gte: startOfMonth,
                lte: endOfMonth,
              },
            },
            select: {
              bookedQuantity: true,
              capacity: true,
            },
          })) || [];

          let totalBookedQty = 0;
          let totalCapacity = 0;
          dailyStocks.forEach((ds) => {
            totalBookedQty += ds.bookedQuantity || 0;
            totalCapacity += ds.capacity || 0;
          });
          occupancyRate = totalCapacity > 0 ? (totalBookedQty / totalCapacity) : 0;

          // Đặt vé gần đây (5 mục mới nhất)
          const recentRaw = await prisma.booking.findMany({
            where: {
              reservationId: { in: reservationIds },
              isForecastTrainingSample: false,
              status: { not: 'PENDING_PAYMENT' },
              payments: {
                some: { status: 'SUCCESS', isDuplicate: false },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              payments: {
                orderBy: { createdAt: 'desc' },
                select: { paymentGateway: true, status: true, amount: true, createdAt: true, transactionId: true, paidAt: true, isDuplicate: true },
              },
              refundRequests: { select: { status: true } },
              ticketInstances: {
                select: {
                  id: true,
                  status: true,
                  checkedInAt: true,
                  checkedInBy: { select: { fullName: true } },
                },
              },
              reservation: {
                include: {
                  timeSlot: true,
                  ticketProduct: {
                    include: { attraction: { select: { title: true } } },
                  },
                },
              },
            },
          });

          recentBookings = recentRaw.map((b) => {
            const latestPayment = selectBookingPayment(b.payments);
            return {
              id: b.id,
              attraction: b.reservation.ticketProduct.attraction.title,
              ticket: b.reservation.ticketProduct.name,
              customer: b.fullName,
              email: b.email,
              phone: b.phone || '',
              note: b.note || '',
              date: toVietnamDateString(b.createdAt),
              visitDate: b.reservation.date instanceof Date
                ? b.reservation.date.toISOString().slice(0, 10)
                : String(b.reservation.date).slice(0, 10),
              slot: b.reservation.timeSlot
                ? `${b.reservation.timeSlot.startTime} – ${b.reservation.timeSlot.endTime}`
                : 'Cả ngày',
              qty: b.reservation.quantity,
              amount: Number(b.totalAmount),
              subtotalAmount: Number(b.subtotalAmount),
              discountAmount: Number(b.discountAmount),
              snapshotTicketType: b.snapshotTicketType,
              snapshotUnitPrice: Number(b.snapshotUnitPrice),
              status: b.status.toLowerCase().replace('pending_payment', 'pending'),
              refundRequired: b.refundRequired,
              refundStatus: b.refundRequests?.[0]?.status || null,
              paymentGateway: latestPayment?.paymentGateway || null,
              paymentStatus: latestPayment?.status || null,
              transactionId: latestPayment?.transactionId || null,
              paidAt: latestPayment?.paidAt || null,
              ticketInstances: b.ticketInstances || [],
              createdAt: b.createdAt,
            };
          });
        }
      }
    }

    const stats = {
      totalAttractions: attractions.length,
      activeAttractions: attractions.filter(
        (a) => a.publicationStatus === 'ACTIVE' && a.operationalStatus !== 'SUSPENDED',
      ).length,
      totalTickets,
      totalBookingsThisMonth,
      revenueThisMonth,
      ticketsSoldThisMonth,
      totalRevenue,
      totalTicketsSold,
      netRevenueThisMonth,
      netTotalRevenue: totalNetRevenue,
      occupancyRate,
      pendingBookings,
    };

    return res.json({
      stats,
      recentBookings,
      partnerStatus: req.partner.status,
    });
  } catch (error) {
    next(error);
  }
}

async function getReports(req, res, next) {
  try {
    const period = normalizePeriod(String(req.query.period || '').trim());
    const startDate = getPeriodStart(period);
    const bookings = await prisma.booking.findMany({
      where: {
        ...buildRecognizedBookingPeriodWhere(startDate),
        reservation: {
          ticketProduct: {
            attraction: { partnerId: req.partner.id },
          },
        },
      },
      select: {
        status: true,
        createdAt: true,
        snapshotVisitDate: true,
        commissionRateSnapshot: true,
        commissionAmountSnapshot: true,
        partnerNetAmountSnapshot: true,
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: { amount: true },
        },
        refundTransactions: {
          where: { status: 'SUCCESS' },
          select: {
            amount: true,
            processedAt: true,
            reconciledAt: true,
            createdAt: true,
            refundRequest: { select: { type: true } },
          },
        },
        reservation: {
          select: {
            quantity: true,
            date: true,
            ticketProduct: {
              select: {
                attraction: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const recognizedBookings = bookings
      .map((booking) => ({
        booking,
        recognized: recognizedAmountsOf(booking),
        recognizedAt: recognizedAtOf(booking),
      }))
      .filter((entry) => entry.recognized.netAmount > 0);
    const byAttraction = new Map();
    let paymentGross = 0;
    let refundedAmount = 0;
    let grossRevenue = 0;
    let ticketsSold = 0;
    let commission = 0;
    let netRevenue = 0;
    let retainedCancellationFees = 0;

    for (const { booking, recognized } of recognizedBookings) {
      const revenue = recognized.netAmount;
      const quantity = ['COMPLETED', 'NO_SHOW'].includes(booking.status)
        ? Number(booking.reservation.quantity || 0)
        : 0;
      const attraction = booking.reservation.ticketProduct.attraction;
      paymentGross += recognized.grossAmount;
      refundedAmount += recognized.refundAmount;
      grossRevenue += revenue;
      commission += recognized.commissionAmount;
      netRevenue += recognized.partnerPayableAmount;
      if (booking.status === 'REFUNDED') {
        retainedCancellationFees += recognized.netAmount;
      }
      ticketsSold += quantity;

      const current = byAttraction.get(attraction.id) || {
        id: attraction.id,
        name: attraction.title,
        bookings: 0,
        ticketsSold: 0,
        revenue: 0,
      };
      current.bookings += 1;
      current.ticketsSold += quantity;
      current.revenue += revenue;
      byAttraction.set(attraction.id, current);
    }

    const attractions = [...byAttraction.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((item) => ({
        ...item,
        share: grossRevenue > 0 ? item.revenue / grossRevenue : 0,
      }));

    return res.json({
      success: true,
      data: {
        period,
        summary: {
          bookings: recognizedBookings.length,
          ticketsSold,
          paymentGross,
          refundedAmount,
          grossRevenue,
          commission,
          netRevenue,
          retainedCancellationFees,
        },
        timeline: buildTimeline(
          recognizedBookings.map(({ booking, recognized, recognizedAt }) => ({
            ...booking,
            recognized,
            createdAt: recognizedAt,
          })),
          period,
          (booking) => booking.recognized.netAmount,
        ),
        attractions,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/partners/bookings — Danh sách đặt vé của partner (có phân trang + lọc)
async function getPartnerBookings(req, res, next) {
  try {
    const partnerId = req.partner.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const statusFilter = req.query.status;
    const search = (req.query.search || '').trim().toLowerCase();

    // Lấy tất cả attractionIds của partner
    const attractions = await prisma.attraction.findMany({
      where: { partnerId },
      select: { id: true },
    });
    const attractionIds = attractions.map((a) => a.id);

    if (attractionIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        stats: emptyPartnerBookingStats(),
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const ticketProductIds = await prisma.ticketProduct.findMany({
      where: { attractionId: { in: attractionIds } },
      select: { id: true },
    }).then((rows) => rows.map((r) => r.id));

    if (ticketProductIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        stats: emptyPartnerBookingStats(),
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const reservationIds = await prisma.reservation.findMany({
      where: { ticketProductId: { in: ticketProductIds } },
      select: { id: true },
    }).then((rows) => rows.map((r) => r.id));

    if (reservationIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        stats: emptyPartnerBookingStats(),
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    // Map status filter từ FE sang DB enum
    const STATUS_MAP = {
      pending_payment: 'PENDING_PAYMENT',
      confirmed: 'CONFIRMED',
      pending_partner: 'PENDING_PARTNER',
      cancelled: 'CANCELLED',
      completed: 'COMPLETED',
      refund_requested: 'REFUND_REQUESTED',
      refunded: 'REFUNDED',
      no_show: 'NO_SHOW',
    };

    const paidPartnerBookingWhere = {
      reservationId: { in: reservationIds },
      isForecastTrainingSample: false,
      payments: {
        some: { status: 'SUCCESS', isDuplicate: false },
      },
    };
    const where = {
      ...paidPartnerBookingWhere,
      status:
        statusFilter && statusFilter !== 'all' && STATUS_MAP[statusFilter]
          ? STATUS_MAP[statusFilter]
          : { not: 'PENDING_PAYMENT' },
    };

    // Search đa trường phải nằm trong query DB để count & phân trang khớp với kết quả
    // (trước đây lọc sau phân trang -> total sai và bỏ sót kết quả ở trang khác).
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        {
          reservation: {
            ticketProduct: {
              attraction: { title: { contains: search, mode: 'insensitive' } },
            },
          },
        },
      ];
    }

    const [total, bookings, statusGroups = [], recognizedBookings = []] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          payments: {
            orderBy: { createdAt: 'desc' },
            select: { paymentGateway: true, status: true, amount: true, createdAt: true, transactionId: true, paidAt: true, isDuplicate: true },
          },
          refundRequests: { select: { status: true } },
          ticketInstances: {
            select: {
              id: true,
              status: true,
              checkedInAt: true,
              checkedInBy: { select: { fullName: true } },
            },
          },
          reservation: {
            include: {
              timeSlot: true,
              ticketProduct: {
                include: { attraction: { select: { title: true } } },
              },
            },
          },
        },
      }),
      prisma.booking.groupBy({
        by: ['status'],
        where: {
          ...paidPartnerBookingWhere,
          status: { not: 'PENDING_PAYMENT' },
        },
        _count: { _all: true },
      }),
      prisma.booking.findMany({
        where: {
          ...buildRecognizedBookingPeriodWhere(new Date(0)),
          reservationId: { in: reservationIds },
        },
        select: {
          status: true,
          commissionRateSnapshot: true,
          commissionAmountSnapshot: true,
          partnerNetAmountSnapshot: true,
          payments: {
            where: { status: 'SUCCESS', isDuplicate: false },
            select: { amount: true },
          },
          refundTransactions: {
            where: { status: 'SUCCESS' },
            select: {
              amount: true,
              refundRequest: { select: { type: true } },
            },
          },
        },
      }),
    ]);

    const data = bookings.map((b) => {
      const latestPayment = selectBookingPayment(b.payments);
      return {
        id: b.id,
        attraction: b.reservation.ticketProduct.attraction.title,
        ticket: b.reservation.ticketProduct.name,
        customer: b.fullName,
        email: b.email,
        phone: b.phone || '',
        note: b.note || '',
        date: toVietnamDateString(b.createdAt),
        visitDate: b.reservation.date instanceof Date
          ? b.reservation.date.toISOString().slice(0, 10)
          : String(b.reservation.date).slice(0, 10),
        slot: b.reservation.timeSlot
          ? `${b.reservation.timeSlot.startTime} – ${b.reservation.timeSlot.endTime}`
          : 'Cả ngày',
        qty: b.reservation.quantity,
        amount: Number(b.totalAmount),
        subtotalAmount: Number(b.subtotalAmount),
        discountAmount: Number(b.discountAmount),
        snapshotTicketType: b.snapshotTicketType,
        snapshotUnitPrice: Number(b.snapshotUnitPrice),
        status: b.status.toLowerCase(),
        refundRequired: b.refundRequired,
        refundStatus: b.refundRequests?.[0]?.status || null,
        paymentGateway: latestPayment?.paymentGateway || null,
        paymentStatus: latestPayment?.status || null,
        transactionId: latestPayment?.transactionId || null,
        paidAt: latestPayment?.paidAt || null,
        ticketInstances: b.ticketInstances || [],
        createdAt: b.createdAt,
      };
    });

    // (search đã được áp dụng trong query DB ở trên)

    const countsByStatus = Object.fromEntries(
      statusGroups.map((group) => [group.status, Number(group?._count?._all || 0)]),
    );
    const stats = {
      total: Object.values(countsByStatus).reduce((sum, count) => sum + count, 0),
      confirmed: countsByStatus.CONFIRMED || 0,
      pendingPartner: countsByStatus.PENDING_PARTNER || 0,
      recognizedRevenue: recognizedBookings.reduce(
        (sum, booking) => sum + recognizedAmountsOf(booking).partnerPayableAmount,
        0,
      ),
    };

    return res.json({
      success: true,
      data,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/partners/bookings/:id/approve — Partner duyệt đơn đặt vé
// Khi duyệt: CONFIRMED booking + tạo TicketInstance (QR) + xác nhận stock
async function approveBooking(req, res, next) {
  try {
    const partnerId = req.partner.id;
    const bookingId = req.params.id;

    // Kiểm tra booking tồn tại và lấy đủ thông tin cần thiết
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: {
            id: true,
            status: true,
            isDuplicate: true,
            paidAt: true,
            createdAt: true,
          },
        },
        ticketInstances: { select: { id: true } },
        reservation: {
          include: {
            timeSlot: true,
            ticketProduct: {
              include: {
                attraction: {
                  select: { partnerId: true, openTime: true, closeTime: true },
                },
              },
            },
          },
        },
      },
    });

    if (!booking || booking.isForecastTrainingSample) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt vé.' });
    }

    if (booking.reservation.ticketProduct.attraction.partnerId !== partnerId) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền duyệt đơn này.' });
    }

    if (booking.status === 'CONFIRMED') {
      return res.status(400).json({ success: false, message: 'Đơn đặt vé này đã được xác nhận trước đó.' });
    }

    if (booking.status !== 'PENDING_PARTNER') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể duyệt đơn ở trạng thái chờ đối tác duyệt.',
      });
    }

    const now = new Date();
    const approvalDeadline = getManualApprovalDeadline(booking);
    if (!approvalDeadline || now >= approvalDeadline) {
      await expirePendingPartnerBooking(bookingId, { now });
      return res.status(409).json({
        success: false,
        message: 'Đơn đã quá thời hạn duyệt hoặc hoạt động đã bắt đầu. Hệ thống đã chuyển đơn sang quy trình hoàn tiền.',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Re-read TRONG transaction: guard bằng dữ liệu mới nhất để hai request
      // duyệt đồng thời không trừ kho / tạo vé hai lần.
      const current = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          payments: {
            where: { status: 'SUCCESS', isDuplicate: false },
            select: {
              id: true,
              status: true,
              isDuplicate: true,
              paidAt: true,
              createdAt: true,
            },
          },
          reservation: {
            include: {
              timeSlot: true,
              ticketProduct: {
                include: {
                  attraction: {
                    select: { partnerId: true, openTime: true, closeTime: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!current || current.isForecastTrainingSample || current.status !== 'PENDING_PARTNER') {
        const err = new Error('Đơn đặt vé đã được xử lý trước đó.');
        err.statusCode = 409;
        throw err;
      }
      if (current.reservation.ticketProduct.attraction.partnerId !== partnerId) {
        throw bookingConflict('Bạn không có quyền duyệt đơn này.');
      }
      const currentDeadline = getManualApprovalDeadline(current);
      if (!currentDeadline || new Date() >= currentDeadline) {
        throw bookingConflict('Đơn đã quá thời hạn duyệt hoặc hoạt động đã bắt đầu.');
      }
      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: 'PENDING_PARTNER', isForecastTrainingSample: false },
        data: { status: 'CONFIRMED' },
      });
      if (claimed.count !== 1) {
        throw bookingConflict();
      }
      const reservation = current.reservation;

      if (reservation.status !== 'CONFIRMED') {
        await confirmReservationAndStock(tx, reservation);
      }

      // 5. Tạo TicketInstance (QR code) nếu chưa có.
      // Đếm lại TRONG transaction (không dùng dữ liệu đọc trước đó) để
      // hai request duyệt đồng thời không tạo vé trùng.
      const existingTickets = await tx.ticketInstance.count({
        where: { bookingId },
      });
      if (existingTickets === 0) {
        await createTicketInstances(
          tx,
          bookingId,
          reservation.ticketProductId,
          reservation.quantity,
        );
      }
    });

    emitBookingStatusUpdated({
      customerId: booking.userId,
      bookingId,
      status: 'CONFIRMED',
      message: `Đặt vé ${formatBookingReference(bookingId)} của bạn đã được đối tác phê duyệt thành công!`,
    });
    queueConfirmedTicketEmail(bookingId);

    return res.json({
      success: true,
      message: 'Đã xác nhận đơn đặt vé và tạo mã QR thành công.',
      data: { id: bookingId, status: 'confirmed' },
    });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/partners/bookings/:id/reject — Partner từ chối đơn đặt vé
// Khi từ chối: CANCELLED booking + hoàn trả DailyStock & TimeSlotStock.
// Đơn PENDING_PARTNER đã thu tiền qua cổng -> bắt buộc gắn refundRequired
// và tự tạo RefundRequest (hoàn 100%) để rơi vào hàng đợi duyệt của Staff.
async function rejectBooking(req, res, next) {
  try {
    const partnerId = req.partner.id;
    const bookingId = req.params.id;
    const reason = String(req.body?.reason || '').trim();

    if (reason.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập lý do từ chối (tối thiểu 5 ký tự) để thông báo cho khách hàng.',
      });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: {
            id: true,
            status: true,
            isDuplicate: true,
            paymentGateway: true,
            amount: true,
          },
        },
        refundRequests: { select: { id: true, status: true } },
        reservation: {
          include: {
            ticketProduct: {
              include: { attraction: { select: { partnerId: true } } },
            },
          },
        },
      },
    });

    if (!booking || booking.isForecastTrainingSample) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt vé.' });
    }

    if (booking.reservation.ticketProduct.attraction.partnerId !== partnerId) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền từ chối đơn này.' });
    }

    if (booking.status !== 'PENDING_PARTNER') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể từ chối đơn ở trạng thái chờ đối tác duyệt.',
      });
    }

    const hasPaid = booking.payments.length > 0;
    const cancelledAt = new Date();

    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          payments: {
            where: { status: 'SUCCESS', isDuplicate: false },
            select: {
              id: true,
              status: true,
              isDuplicate: true,
              paymentGateway: true,
              amount: true,
            },
          },
          refundRequests: { select: { id: true, status: true } },
          reservation: {
            include: {
              ticketProduct: {
                include: { attraction: { select: { partnerId: true } } },
              },
            },
          },
        },
      });
      if (!booking || booking.isForecastTrainingSample || booking.status !== 'PENDING_PARTNER') {
        throw bookingConflict();
      }
      if (booking.reservation.ticketProduct.attraction.partnerId !== partnerId) {
        throw bookingConflict('Bạn không có quyền từ chối đơn này.');
      }

      const reservation = booking.reservation;
      const hasPaid = booking.payments.length > 0;
      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: 'PENDING_PARTNER', isForecastTrainingSample: false },
        data: {
          status: 'CANCELLED',
          refundRequired: hasPaid,
          cancelledAt,
          cancellationReason: reason,
          cancellationSource: 'PARTNER_REJECTION',
        },
      });
      if (claimed.count !== 1) {
        throw bookingConflict();
      }

      // 1. Hoàn trả DailyStock: bookedQuantity -> giảm, giải phóng lại slot
      //    Chỉ hoàn nếu reservation đã CONFIRMED (tức đã từng chuyển held -> booked)
      if (reservation.status === 'CONFIRMED') {
        await releaseInventory(tx, booking);
      } else if (reservation.status === 'HELD') {
        // Nếu còn HELD thì hoàn lại heldQuantity
        const dailyStock = await tx.dailyStock.updateMany({
          where: {
            ticketProductId: reservation.ticketProductId,
            date: reservation.date,
            heldQuantity: { gte: reservation.quantity },
          },
          data: {
            heldQuantity: { decrement: reservation.quantity },
          },
        });
        if (dailyStock.count !== 1) {
          throw bookingConflict('Không thể hoàn trả kho vé giữ chỗ.');
        }

        const attractionStock = await tx.attractionDailyStock.updateMany({
          where: {
            attractionId: reservation.ticketProduct.attractionId,
            date: reservation.date,
            heldQty: { gte: reservation.quantity },
          },
          data: { heldQty: { decrement: reservation.quantity } },
        });
        if (attractionStock.count !== 1) {
          throw bookingConflict('Không thể hoàn trả kho giữ chỗ của điểm tham quan.');
        }

        if (reservation.timeSlotId) {
          const timeSlotStock = await tx.timeSlotStock.updateMany({
            where: {
              timeSlotId: reservation.timeSlotId,
              date: reservation.date,
              heldQty: { gte: reservation.quantity },
            },
            data: {
              heldQty: { decrement: reservation.quantity },
            },
          });
          if (timeSlotStock.count !== 1) {
            throw bookingConflict('Không thể hoàn trả kho giữ chỗ theo khung giờ.');
          }
        }
      }

      // 3. Cập nhật Reservation -> CANCELLED
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'CANCELLED' },
      });

      // Giải phóng lượt dùng voucher nếu đơn này có áp dụng mã ưu đãi
      if (booking.voucherId) {
        await tx.voucher.updateMany({
          where: { id: booking.voucherId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }

      // 5. Đơn đã thu tiền -> tạo RefundRequest hoàn 100% (partner từ chối thì
      //    khách không chịu phí hủy) để Staff duyệt hoàn qua luồng sẵn có.
      if (hasPaid) {
        await queueMandatoryRefund(tx, booking, {
          now: cancelledAt,
          type: 'PARTNER_CANCELLATION',
          reason: `Đối tác từ chối đơn đặt vé. Lý do: ${reason}`,
        });
      }
    });

    emitBookingStatusUpdated({
      customerId: booking.userId,
      bookingId,
      status: 'CANCELLED',
      message:
        `Rất tiếc, yêu cầu đặt vé ${formatBookingReference(bookingId)} đã bị từ chối. Lý do: ${reason}.` +
        (hasPaid ? ' Số tiền bạn đã thanh toán sẽ được hoàn lại đầy đủ trong thời gian sớm nhất.' : ''),
    });

    // Email thông báo từ chối + cam kết hoàn tiền (không chặn response nếu gửi lỗi).
    sendBookingRejectedEmail({
      to: booking.email,
      fullName: booking.fullName,
      bookingId,
      reason,
      refundAmount: hasPaid ? Number(booking.totalAmount) : 0,
    }).catch((emailError) =>
      console.error('[partner-reject] Không thể gửi email:', emailError.message),
    );

    return res.json({
      success: true,
      message: hasPaid
        ? 'Đã từ chối đơn, hoàn trả kho vé và tạo yêu cầu hoàn tiền cho khách.'
        : 'Đã từ chối đơn đặt vé và hoàn trả kho vé.',
      data: { id: bookingId, status: 'cancelled', refundRequired: hasPaid },
    });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/partners/bookings/:id/cancel — Partner hủy đơn đã xác nhận trước giờ sử dụng.
async function cancelConfirmedBooking(req, res, next) {
  try {
    const partnerId = req.partner.id;
    const bookingId = req.params.id;
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập lý do hủy (tối thiểu 5 ký tự).',
      });
    }

    const include = {
      payments: {
        where: { status: 'SUCCESS', isDuplicate: false },
        select: {
          id: true,
          status: true,
          isDuplicate: true,
          paymentGateway: true,
          amount: true,
        },
      },
      refundRequests: { select: { id: true, status: true } },
      ticketInstances: { select: { id: true, status: true } },
      reservation: {
        include: {
          timeSlot: true,
          ticketProduct: {
            include: {
              attraction: {
                select: {
                  id: true,
                  title: true,
                  partnerId: true,
                  openTime: true,
                  closeTime: true,
                },
              },
            },
          },
        },
      },
    };
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include });
    if (!booking || booking.isForecastTrainingSample) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt vé.' });
    }
    if (booking.reservation.ticketProduct.attraction.partnerId !== partnerId) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền hủy đơn này.' });
    }
    if (booking.status !== 'CONFIRMED') {
      return res.status(409).json({
        success: false,
        message: 'Chỉ đơn đã xác nhận và chưa sử dụng mới có thể được Partner hủy.',
      });
    }
    if (booking.ticketInstances.some((ticket) => ticket.status === 'USED')) {
      return res.status(409).json({ success: false, message: 'Không thể hủy đơn đã có vé check-in.' });
    }
    const now = new Date();
    const { startsAt } = getBookingActivityWindow(booking);
    if (!startsAt || now >= startsAt) {
      return res.status(409).json({
        success: false,
        message: 'Không thể hủy đơn sau khi hoạt động đã bắt đầu. Vui lòng liên hệ Staff để xử lý ngoại lệ.',
      });
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: bookingId }, include });
      if (!current || current.isForecastTrainingSample || current.status !== 'CONFIRMED') {
        throw bookingConflict();
      }
      if (current.reservation.ticketProduct.attraction.partnerId !== partnerId) {
        throw bookingConflict('Bạn không có quyền hủy đơn này.');
      }
      if (current.ticketInstances.some((ticket) => ticket.status === 'USED')) {
        throw bookingConflict('Không thể hủy đơn đã có vé check-in.');
      }
      const currentStart = getBookingActivityWindow(current).startsAt;
      if (!currentStart || new Date() >= currentStart) {
        throw bookingConflict('Hoạt động đã bắt đầu, không thể hủy theo luồng Partner.');
      }

      const hasPaid = current.payments.length > 0;
      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: 'CONFIRMED', isForecastTrainingSample: false },
        data: {
          status: 'CANCELLED',
          refundRequired: hasPaid,
          cancelledAt: now,
          cancellationReason: reason,
          cancellationSource: 'PARTNER',
        },
      });
      if (claimed.count !== 1) throw bookingConflict();

      await releaseInventory(tx, current);
      await tx.ticketInstance.updateMany({
        where: { bookingId, status: 'VALID' },
        data: { status: 'EXPIRED' },
      });
      if (current.voucherId) {
        await tx.voucher.updateMany({
          where: { id: current.voucherId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }
      if (hasPaid) {
        await queueMandatoryRefund(tx, current, {
          type: 'PARTNER_CANCELLATION',
          reason: `Đối tác hủy đơn đã xác nhận. Lý do: ${reason}`,
          now,
        });
      }
      await writeAuditLog({
        client: tx,
        req,
        action: 'PARTNER_CANCELLED_CONFIRMED_BOOKING',
        entityType: 'Booking',
        entityId: bookingId,
        metadata: { reason, refundRequired: hasPaid },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    emitBookingStatusUpdated({
      customerId: booking.userId,
      bookingId,
      status: 'CANCELLED',
      message: `Đơn ${formatBookingReference(bookingId)} đã bị đối tác hủy. Yêu cầu hoàn tiền 100% đang được xử lý tự động.`,
    });
    sendBookingCancelledByPartnerEmail({
      to: booking.email,
      fullName: booking.fullName,
      bookingId,
      reason,
      refundAmount: Number(booking.totalAmount),
    }).catch((error) => {
      console.error('[partner-cancel] Không thể gửi email:', error.message);
    });

    return res.json({
      success: true,
      message: 'Đã hủy đơn, hoàn kho và chuyển khoản hoàn 100% sang xử lý tự động.',
      data: { id: bookingId, status: 'cancelled', refundRequired: booking.payments.length > 0 },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  toPartnerResponse,
  submitKyc,
  getMyPartner,
  updateSettings,
  getDashboard,
  getReports,
  getPartnerBookings,
  approveBooking,
  rejectBooking,
  cancelConfirmedBooking,
  // Aliases để tương thích với MPhu
  registerPartner: submitKyc,
  getMyPartnerProfile: getMyPartner,
};

