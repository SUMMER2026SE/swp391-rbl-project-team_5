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
} = require('./bookingController');
const { releaseInventory } = require('../utils/refundService');
const {
  getBookingActivityWindow,
  getManualApprovalDeadline,
} = require('../utils/activityTime');
const { expirePendingPartnerBooking } = require('../utils/pendingPartnerWorker');
const { queueMandatoryRefund } = require('../services/mandatoryRefundService');
const { writeAuditLog } = require('../utils/auditLog');
const { isDocumentOwnedByUser } = require('../middleware/uploadMiddleware');
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

function canSubmitPartnerKyc(user) {
  return hasAnyRole(user, ['CUSTOMER', 'PARTNER']);
}

// Định dạng hồ sơ đối tác trả về cho FE (trang Cài đặt + Pending)
function toPartnerResponse(partner, user) {
  return {
    id: partner.id,
    businessName: partner.businessName,
    businessLicenseUrl: partner.businessLicenseUrl || '',
    taxCode: partner.taxCode || '',
    bankName: partner.bankName || '',
    branchName: partner.branchName || '',
    bankAccountNumber: partner.bankAccountNumber || '',
    bankAccountName: partner.bankAccountName || '',
    swiftCode: partner.swiftCode || '',
    payoutCurrency: partner.payoutCurrency || 'VND',
    website: partner.website || '',
    description: partner.description || '',
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
    if (!isDocumentOwnedByUser(req.body.businessLicenseUrl, req.user.id)) {
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

    const data = {
      userId: req.user.id,
      businessName: req.body.businessName.trim(),
      businessLicenseUrl: toNullable(req.body.businessLicenseUrl) ?? null,
      taxCode: toNullable(req.body.taxCode) ?? null,
      bankName: toNullable(req.body.bankName) ?? null,
      branchName: toNullable(req.body.branchName) ?? null,
      bankAccountNumber: toNullable(req.body.bankAccountNumber) ?? null,
      bankAccountName: toNullable(req.body.bankAccountName) ?? null,
      swiftCode: toNullable(req.body.swiftCode) ?? null,
      payoutCurrency: toNullable(req.body.payoutCurrency) ?? 'VND',
      status: 'PENDING',
    };

    let partner;
    if (isResubmission) {
      const updateData = { ...data, status: 'PENDING', rejectionReason: null };
      delete updateData.userId;
      partner = await prisma.partnerProfile.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      partner = await prisma.partnerProfile.create({ data });
    }

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
    const partnerUpdate = {};
    if (req.body.businessName !== undefined) {
      if (!String(req.body.businessName).trim()) {
        return res.status(400).json({ message: 'Tên hiển thị không được để trống.' });
      }
      partnerUpdate.businessName = String(req.body.businessName).trim();
    }
    if (req.body.website !== undefined) partnerUpdate.website = toNullable(req.body.website) ?? null;
    if (req.body.description !== undefined) {
      partnerUpdate.description = toNullable(req.body.description) ?? null;
    }
    if (req.body.bankName !== undefined) partnerUpdate.bankName = toNullable(req.body.bankName) ?? null;
    if (req.body.branchName !== undefined) {
      partnerUpdate.branchName = toNullable(req.body.branchName) ?? null;
    }
    if (req.body.bankAccountNumber !== undefined) {
      partnerUpdate.bankAccountNumber = toNullable(req.body.bankAccountNumber) ?? null;
    }
    if (req.body.bankAccountName !== undefined) {
      partnerUpdate.bankAccountName = toNullable(req.body.bankAccountName) ?? null;
    }

    // Cập nhật song song thông tin tài khoản (User + UserProfile)
    const userUpdate = {};
    const profileUpdate = {};
    if (req.body.displayName !== undefined && String(req.body.displayName).trim()) {
      userUpdate.fullName = String(req.body.displayName).trim();
    }
    if (req.body.phone !== undefined) {
      const phone = toNullable(req.body.phone) ?? null;
      if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
      }
      profileUpdate.phoneNumber = phone;
    }

    const partner = await prisma.partnerProfile.update({
      where: { id: req.partner.id },
      data: partnerUpdate,
    });

    let user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true, roleMemberships: true },
    });

    if (Object.keys(userUpdate).length > 0 || Object.keys(profileUpdate).length > 0) {
      user = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          ...userUpdate,
          profile: {
            upsert: { create: profileUpdate, update: profileUpdate },
          },
        },
        include: { profile: true, roleMemberships: true },
      });
    }

    return res.json({
      message: 'Cập nhật thông tin đối tác thành công.',
      partner: toPartnerResponse(partner, user),
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
      select: { id: true, status: true, publicationStatus: true },
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
          totalBookingsThisMonth += 1;
        }
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
            where: { reservationId: { in: reservationIds } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              payments: {
                orderBy: { createdAt: 'desc' },
                select: { paymentGateway: true, status: true, amount: true, createdAt: true, transactionId: true, paidAt: true },
              },
              refundRequests: { select: { status: true } },
              ticketInstances: {
                select: {
                  id: true,
                  qrCodeToken: true,
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
            const latestPayment = b.payments?.[0] || null;
            return {
              id: b.id,
              attraction: b.reservation.ticketProduct.attraction.title,
              ticket: b.reservation.ticketProduct.name,
              customer: b.fullName,
              email: b.email,
              phone: b.phone || '',
              note: b.note || '',
              date: b.createdAt.toISOString().slice(0, 10),
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
        (a) => a.publicationStatus === 'ACTIVE' && a.status !== 'SUSPENDED',
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
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    // Map status filter từ FE sang DB enum
    const STATUS_MAP = {
      confirmed: 'CONFIRMED',
      pending_partner: 'PENDING_PARTNER',
      cancelled: 'CANCELLED',
      completed: 'COMPLETED',
    };

    const where = {
      reservationId: { in: reservationIds },
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

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          payments: {
            orderBy: { createdAt: 'desc' },
            select: { paymentGateway: true, status: true, amount: true, createdAt: true, transactionId: true, paidAt: true },
          },
          refundRequests: { select: { status: true } },
          ticketInstances: {
            select: {
              id: true,
              qrCodeToken: true,
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
    ]);

    const data = bookings.map((b) => {
      const latestPayment = b.payments?.[0] || null;
      return {
        id: b.id,
        attraction: b.reservation.ticketProduct.attraction.title,
        ticket: b.reservation.ticketProduct.name,
        customer: b.fullName,
        email: b.email,
        phone: b.phone || '',
        note: b.note || '',
        date: b.createdAt.toISOString().slice(0, 10),
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
        status: b.status.toLowerCase().replace('pending_payment', 'pending_partner'),
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

    return res.json({
      success: true,
      data,
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

    if (!booking) {
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
      if (!current || current.status !== 'PENDING_PARTNER') {
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
        where: { id: bookingId, status: 'PENDING_PARTNER' },
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
      message: `Đặt vé ${bookingId.slice(0, 8).toUpperCase()} của bạn đã được đối tác phê duyệt thành công!`,
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

    if (!booking) {
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
      if (!booking || booking.status !== 'PENDING_PARTNER') {
        throw bookingConflict();
      }
      if (booking.reservation.ticketProduct.attraction.partnerId !== partnerId) {
        throw bookingConflict('Bạn không có quyền từ chối đơn này.');
      }

      const reservation = booking.reservation;
      const hasPaid = booking.payments.length > 0;
      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: 'PENDING_PARTNER' },
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
        `Rất tiếc, yêu cầu đặt vé ${bookingId.slice(0, 8).toUpperCase()} đã bị từ chối. Lý do: ${reason}.` +
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
    if (!booking) {
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
      if (!current || current.status !== 'CONFIRMED') throw bookingConflict();
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
        where: { id: bookingId, status: 'CONFIRMED' },
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
      message: `Đơn ${bookingId.slice(0, 8).toUpperCase()} đã bị đối tác hủy. Yêu cầu hoàn tiền 100% đang được xử lý tự động.`,
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

