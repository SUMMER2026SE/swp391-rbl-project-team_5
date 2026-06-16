const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const { validateKyc } = require('../utils/partnerValidators');
const { isValidPhoneNumber } = require('../utils/validators');
const { emitBookingStatusUpdated } = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');
const { sendBookingRejectedEmail } = require('../utils/mailer');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('./bookingController');
const { releaseInventory } = require('../utils/refundService');
const { isDocumentOwnedByUser } = require('../middleware/uploadMiddleware');
const {
  buildTimeline,
  getPeriodStart,
  normalizePeriod,
} = require('../services/analyticsService');

function toNullable(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
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

    const isResubmission = existing && ['REJECTED', 'SUSPENDED'].includes(existing.status);

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
      include: { profile: true },
    });

    return res.status(isResubmission ? 200 : 201).json({
      success: true,
      data: toPartnerResponse(partner, refreshedUser),
      message: 'Nộp hồ sơ đối tác thành công. Hồ sơ của bạn đang được xét duyệt.',
      partner: toPartnerResponse(partner, refreshedUser),
      user: sanitizeUser(refreshedUser),
    });
  } catch (error) {
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
      include: { profile: true },
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
      include: { profile: true },
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
        include: { profile: true },
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
    const commissionRate = req.partner.commissionRate ? Number(req.partner.commissionRate) : 0.10;

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
    let totalTicketsSold = 0;
    let pendingBookings = 0;
    let occupancyRate = 0;
    let recentBookings = [];

    // Doanh thu tính theo partner và KHÔNG lọc archived để KHỚP với getReports
    // (tránh lệch số liệu khi partner đã lưu trữ địa điểm/vé từng có đơn đã thanh toán).
    {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const revenueBookings = await prisma.booking.findMany({
        where: {
          status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
          payments: { some: { status: 'SUCCESS' } },
          reservation: { ticketProduct: { attraction: { partnerId } } },
        },
        select: {
          createdAt: true,
          payments: { where: { status: 'SUCCESS' }, select: { amount: true } },
          reservation: { select: { quantity: true } },
        },
      });
      revenueBookings.forEach((b) => {
        const amount = b.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const qty = b.reservation ? b.reservation.quantity : 0;
        totalRevenue += amount;
        totalTicketsSold += qty;
        const createdAtDate = b.createdAt ? new Date(b.createdAt) : now;
        if (createdAtDate >= startOfMonth) {
          revenueThisMonth += amount;
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
              status: 'PENDING_PAYMENT',
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
      netRevenueThisMonth: revenueThisMonth * (1 - commissionRate),
      netTotalRevenue: totalRevenue * (1 - commissionRate),
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
    const commissionRate = Number(req.partner.commissionRate || 0.1);

    const bookings = await prisma.booking.findMany({
      where: {
        createdAt: { gte: startDate },
        status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
        payments: { some: { status: 'SUCCESS' } },
        reservation: {
          ticketProduct: {
            attraction: { partnerId: req.partner.id },
          },
        },
      },
      select: {
        createdAt: true,
        payments: {
          where: { status: 'SUCCESS' },
          select: { amount: true },
        },
        reservation: {
          select: {
            quantity: true,
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

    const revenueOf = (booking) => booking.payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );
    const byAttraction = new Map();
    let grossRevenue = 0;
    let ticketsSold = 0;

    for (const booking of bookings) {
      const revenue = revenueOf(booking);
      const quantity = Number(booking.reservation.quantity || 0);
      const attraction = booking.reservation.ticketProduct.attraction;
      grossRevenue += revenue;
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
          bookings: bookings.length,
          ticketsSold,
          grossRevenue,
          commission: grossRevenue * commissionRate,
          netRevenue: grossRevenue * (1 - commissionRate),
        },
        timeline: buildTimeline(bookings, period, revenueOf),
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
        ticketInstances: { select: { id: true } },
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

    await prisma.$transaction(async (tx) => {
      // Re-read TRONG transaction: guard bằng dữ liệu mới nhất để hai request
      // duyệt đồng thời không trừ kho / tạo vé hai lần.
      const current = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { reservation: true },
      });
      if (!current || current.status !== 'PENDING_PARTNER') {
        const err = new Error('Đơn đặt vé đã được xử lý trước đó.');
        err.statusCode = 409;
        throw err;
      }
      const reservation = current.reservation;

      if (reservation.status !== 'CONFIRMED') {
        await confirmReservationAndStock(tx, reservation);
      }

      // 4. Cập nhật Booking -> CONFIRMED
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED' },
      });

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
        payments: { where: { status: 'SUCCESS' }, select: { id: true } },
        refundRequests: { select: { id: true } },
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

    const reservation = booking.reservation;
    const hasPaid = booking.payments.length > 0;

    await prisma.$transaction(async (tx) => {
      // 1. Hoàn trả DailyStock: bookedQuantity -> giảm, giải phóng lại slot
      //    Chỉ hoàn nếu reservation đã CONFIRMED (tức đã từng chuyển held -> booked)
      if (reservation.status === 'CONFIRMED') {
        await releaseInventory(tx, booking);
      } else if (reservation.status === 'HELD') {
        // Nếu còn HELD thì hoàn lại heldQuantity
        await tx.dailyStock.updateMany({
          where: {
            ticketProductId: reservation.ticketProductId,
            date: reservation.date,
          },
          data: {
            heldQuantity: { decrement: reservation.quantity },
          },
        });
        await tx.attractionDailyStock.updateMany({
          where: {
            attractionId: reservation.ticketProduct.attractionId,
            date: reservation.date,
            heldQty: { gte: reservation.quantity },
          },
          data: { heldQty: { decrement: reservation.quantity } },
        });

        if (reservation.timeSlotId) {
          await tx.timeSlotStock.updateMany({
            where: {
              timeSlotId: reservation.timeSlotId,
              date: reservation.date,
            },
            data: {
              heldQty: { decrement: reservation.quantity },
            },
          });
        }
      }

      // 3. Cập nhật Reservation -> CANCELLED
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'CANCELLED' },
      });

      // 4. Cập nhật Booking -> CANCELLED. Đơn đã thu tiền -> gắn refundRequired.
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', refundRequired: hasPaid },
      });

      // 5. Đơn đã thu tiền -> tạo RefundRequest hoàn 100% (partner từ chối thì
      //    khách không chịu phí hủy) để Staff duyệt hoàn qua luồng sẵn có.
      if (hasPaid && booking.refundRequests.length === 0) {
        await tx.refundRequest.create({
          data: {
            bookingId,
            requestedById: booking.userId,
            reason: `Đối tác từ chối đơn đặt vé. Lý do: ${reason}`,
            amount: booking.totalAmount,
            status: 'PENDING',
          },
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
  // Aliases để tương thích với MPhu
  registerPartner: submitKyc,
  getMyPartnerProfile: getMyPartner,
};

