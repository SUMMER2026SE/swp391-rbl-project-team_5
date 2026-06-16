const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const {
  sendAccountStatusEmail,
  sendPartnerReviewEmail,
  sendAttractionReviewEmail,
  sendAttractionViolationEmail,
} = require('../utils/mailer');
const { writeAuditLog } = require('../utils/auditLog');
const {
  applyApprovedSnapshot,
  clearJsonField,
  validateSubmissionSnapshot,
} = require('../services/attractionWorkflowService');
const {
  buildTimeline,
  getPeriodStart,
  normalizePeriod,
} = require('../services/analyticsService');

const ALLOWED_ROLES = ['CUSTOMER', 'PARTNER', 'ADMIN', 'STAFF'];
const ALLOWED_STATUSES = ['ACTIVE', 'LOCKED'];
const ALLOWED_PARTNER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const ALLOWED_ATTRACTION_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';

  return Boolean(value);
}

function buildUserWhere({ search, role, status }) {
  const where = {};
  const normalizedSearch = String(search || '').trim();

  if (normalizedSearch) {
    where.OR = [
      { fullName: { contains: normalizedSearch, mode: 'insensitive' } },
      { email: { contains: normalizedSearch, mode: 'insensitive' } },
    ];
  }

  if (role) {
    where.role = role;
  }

  if (status) {
    where.status = status;
  }

  return where;
}

async function getUsers(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const requestedLimit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT);
    const limit = Math.min(requestedLimit, MAX_LIMIT);
    const skip = (page - 1) * limit;
    const role = String(req.query.role || '').trim().toUpperCase();
    const status = String(req.query.status || '').trim().toUpperCase();

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Vai trò lọc không hợp lệ.' });
    }

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái lọc không hợp lệ.' });
    }

    const where = buildUserWhere({
      search: req.query.search,
      role,
      status,
    });

    const [
      totalAccounts,
      activeCustomers,
      attractionPartners,
      lockedAccounts,
      users,
      total,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({
        where: {
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      }),
      prisma.user.count({
        where: {
          role: 'PARTNER',
        },
      }),
      prisma.user.count({
        where: {
          status: 'LOCKED',
        },
      }),
      prisma.user.findMany({
        where,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({
      users: users.map(sanitizeUser),
      pagination: {
        total,
        page,
        limit,
      },
      stats: {
        totalAccounts,
        activeCustomers,
        attractionPartners,
        lockedAccounts,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function changeUserStatus(req, res, next) {
  try {
    const userId = req.params.id;
    const status = String(req.body.status || '').trim().toUpperCase();
    const reason = String(req.body.reason || '').trim();
    const sendEmail = parseBoolean(req.body.sendEmail);

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái tài khoản không hợp lệ.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản người dùng.' });
    }

    if (status === 'LOCKED' && user.id === req.user.id) {
      return res.status(400).json({
        message: 'Bạn không thể tự khóa tài khoản của chính mình.',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { status },
      include: { profile: true },
    });

    if (sendEmail) {
      sendAccountStatusEmail({
        to: user.email,
        fullName: user.fullName,
        status,
        reason,
      }).catch((error) => {
        console.error('[Admin] Không thể gửi email cập nhật trạng thái tài khoản:', error);
      });
    }

    return res.status(200).json({
      message: 'Trạng thái tài khoản đã được cập nhật thành công.',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    return next(error);
  }
}

// ---------- New admin functions for Partner/Attraction review ----------

async function getPartners(req, res, next) {
  try {
    const status = String(req.query.status || '').trim().toUpperCase();
    const where = {};

    if (status && !ALLOWED_PARTNER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Partner status is invalid' },
      });
    }

    if (status) where.status = status;

    const partners = await prisma.partnerProfile.findMany({
      where,
      select: {
        id: true,
        businessName: true,
        businessLicenseUrl: true,
        taxCode: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            fullName: true,
            profile: { select: { phoneNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: partners });
  } catch (error) {
    return next(error);
  }
}

function mapModerationAttraction(attraction, auditLogs, reviewerNames) {
  const snapshot = attraction.status === 'PENDING' && attraction.submittedData
    ? attraction.submittedData
    : null;
  const images = snapshot?.images || (attraction.images || []).map((image) => ({
    id: image.id,
    url: image.imageUrl,
    isPrimary: image.isPrimary,
  }));
  const category = snapshot?.category || attraction.categories?.[0]?.category || null;

  return {
    id: attraction.id,
    title: snapshot?.title ?? attraction.title,
    description: snapshot?.description ?? attraction.description,
    address: snapshot?.address ?? attraction.address,
    city: snapshot?.city ?? attraction.city,
    district: snapshot?.district ?? attraction.district,
    openTime: snapshot?.openTime ?? attraction.openTime,
    closeTime: snapshot?.closeTime ?? attraction.closeTime,
    latitude: snapshot?.latitude ?? attraction.latitude,
    longitude: snapshot?.longitude ?? attraction.longitude,
    status: attraction.status,
    publicationStatus: attraction.publicationStatus,
    rejectionReason: attraction.rejectionReason,
    revision: attraction.revision,
    submittedAt: attraction.submittedAt,
    reviewedAt: attraction.reviewedAt,
    reviewedById: attraction.reviewedById,
    reviewedByName: reviewerNames.get(attraction.reviewedById) || null,
    publishedAt: attraction.publishedAt,
    averageRating: attraction.averageRating,
    totalReviews: attraction.totalReviews,
    createdAt: attraction.createdAt,
    partner: attraction.partner,
    images,
    primaryImage: images.find((image) => image.isPrimary)?.url || images[0]?.url || null,
    category,
    minPrice: attraction.ticketProducts?.[0]
      ? Number(attraction.ticketProducts[0].sellingPrice)
      : null,
    ticketProducts: (attraction.ticketProducts || []).map((ticket) => ({
      ...ticket,
      originalPrice: Number(ticket.originalPrice),
      sellingPrice: Number(ticket.sellingPrice),
      refundFeeRate: Number(ticket.refundFeeRate),
    })),
    schedule: {
      openDays: attraction.openDays,
      defaultCapacity: attraction.defaultCapacity,
      timeSlots: attraction.timeSlots || [],
      specialDates: attraction.specialDates || [],
    },
    reviewHistory: auditLogs,
  };
}

async function getAttractions(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;
    const status = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim();
    const where = { archivedAt: null };

    if (status && !ALLOWED_ATTRACTION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Attraction status is invalid' },
      });
    }
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { partner: { businessName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const include = {
      partner: {
        select: {
          id: true,
          businessName: true,
          user: { select: { email: true, fullName: true } },
        },
      },
      images: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      categories: { include: { category: true } },
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        orderBy: { sellingPrice: 'asc' },
      },
      timeSlots: {
        where: { ticketProductId: null, isActive: true },
        orderBy: { startTime: 'asc' },
      },
      specialDates: { orderBy: { date: 'asc' } },
    };

    const [attractions, total] = await prisma.$transaction([
      prisma.attraction.findMany({
        where,
        include,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.attraction.count({ where }),
    ]);

    const ids = attractions.map((attraction) => attraction.id);
    const reviewerIds = attractions
      .map((attraction) => attraction.reviewedById)
      .filter(Boolean);
    const [logs = [], reviewers = []] = await Promise.all([
      ids.length
        ? prisma.auditLog.findMany({
            where: { entityType: 'ATTRACTION', entityId: { in: ids } },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      reviewerIds.length
        ? prisma.user.findMany({
            where: { id: { in: [...new Set(reviewerIds)] } },
            select: { id: true, fullName: true },
          })
        : [],
    ]);
    const logsByAttraction = new Map();
    for (const log of logs) {
      const current = logsByAttraction.get(log.entityId) || [];
      current.push(log);
      logsByAttraction.set(log.entityId, current);
    }
    const reviewerNames = new Map(reviewers.map((user) => [user.id, user.fullName]));
    const data = attractions.map((attraction) => mapModerationAttraction(
      attraction,
      logsByAttraction.get(attraction.id) || [],
      reviewerNames,
    ));

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function reviewPartner(req, res, next) {
  try {
    const id = req.params.id;
    const { action, rejectionReason } = req.body || {};
    if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'action must be APPROVED or REJECTED' } });
    if (action === 'REJECTED' && (!rejectionReason || String(rejectionReason).trim() === '')) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'rejectionReason is required when rejecting' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { id }, include: { user: true } });
    if (!partner) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Partner profile not found' } });

    // Chỉ xét duyệt hồ sơ đang chờ; tránh REJECTED lặp lại làm hạ role partner đã được duyệt.
    if (partner.status !== 'PENDING') {
      return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Chỉ có thể xét duyệt hồ sơ đang ở trạng thái chờ duyệt.' } });
    }

    if (action === 'APPROVED') {
      await prisma.$transaction([
        prisma.partnerProfile.update({ where: { id }, data: { status: 'APPROVED', rejectionReason: null } }),
        prisma.user.update({ where: { id: partner.userId }, data: { role: 'PARTNER' } }),
      ]);

      // send email async
      sendPartnerReviewEmail({ to: partner.user.email, businessName: partner.businessName, action: 'APPROVED' }).catch((err) => console.error('[Admin] sendPartnerReviewEmail error:', err));

      return res.status(200).json({ success: true, message: `Trạng thái đối tác đã được cập nhật thành ${action}` });
    }

    // REJECTED
    await prisma.$transaction([
      prisma.partnerProfile.update({
        where: { id },
        data: { status: 'REJECTED', rejectionReason },
      }),
      prisma.user.update({
        where: { id: partner.userId },
        data: { role: 'CUSTOMER' },
      }),
    ]);
    sendPartnerReviewEmail({ to: partner.user.email, businessName: partner.businessName, action: 'REJECTED', rejectionReason }).catch((err) => console.error('[Admin] sendPartnerReviewEmail error:', err));

    return res.status(200).json({ success: true, message: `Trạng thái đối tác đã được cập nhật thành ${action}` });
  } catch (error) {
    return next(error);
  }
}

async function reviewAttraction(req, res, next) {
  try {
    const id = req.params.id;
    const { action, rejectionReason } = req.body || {};
    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'action must be APPROVED or REJECTED' },
      });
    }
    const reason = String(rejectionReason || '').trim();
    if (action === 'REJECTED' && !reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'rejectionReason is required when rejecting',
        },
      });
    }

    const attraction = await prisma.attraction.findUnique({
      where: { id },
      include: { partner: { include: { user: true } } },
    });
    if (!attraction || attraction.archivedAt) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Attraction not found' },
      });
    }
    if (attraction.status !== 'PENDING' || !attraction.submittedData) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: 'Chỉ có thể duyệt một phiên bản đang ở trạng thái PENDING.',
        },
      });
    }

    const snapshot = attraction.submittedData;
    const missing = validateSubmissionSnapshot(snapshot);
    if (action === 'APPROVED' && missing.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INCOMPLETE_SUBMISSION',
          message: `Phiên bản gửi duyệt không còn hợp lệ: ${missing.join(', ')}.`,
        },
      });
    }
    if (action === 'APPROVED' && snapshot.category?.id) {
      const category = await prisma.category.findUnique({
        where: { id: snapshot.category.id },
      });
      if (!category?.isActive) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'CATEGORY_UNAVAILABLE',
            message: 'Danh mục của địa điểm đã ngừng hoạt động. Vui lòng từ chối để partner chọn lại.',
          },
        });
      }
    }

    const reviewedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const lock = await tx.attraction.updateMany({
        where: {
          id,
          status: 'PENDING',
          revision: attraction.revision,
          archivedAt: null,
        },
        data: { reviewedAt, reviewedById: req.user?.id || null },
      });
      if (lock.count !== 1) {
        const error = new Error('Phiên bản này đã được xử lý bởi một admin khác.');
        error.statusCode = 409;
        throw error;
      }

      if (action === 'APPROVED') {
        await applyApprovedSnapshot(tx, id, snapshot);
        await tx.attraction.update({
          where: { id },
          data: {
            status: 'APPROVED',
            publicationStatus: 'ACTIVE',
            rejectionReason: null,
            draftData: clearJsonField(),
            submittedData: clearJsonField(),
            reviewedAt,
            reviewedById: req.user?.id || null,
            publishedAt: reviewedAt,
          },
        });
      } else {
        await tx.attraction.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectionReason: reason,
            draftData: snapshot,
            submittedData: clearJsonField(),
            reviewedAt,
            reviewedById: req.user?.id || null,
          },
        });
      }

      await writeAuditLog({
        client: tx,
        req,
        action: action === 'APPROVED'
          ? 'ATTRACTION_APPROVED'
          : 'ATTRACTION_REJECTED',
        entityType: 'ATTRACTION',
        entityId: id,
        metadata: {
          revision: attraction.revision,
          rejectionReason: action === 'REJECTED' ? reason : null,
          snapshot,
        },
      });
    });

    const recipient = attraction.partner?.user?.email;
    if (recipient) {
      sendAttractionReviewEmail({
        to: recipient,
        partnerName: attraction.partner.businessName,
        attractionTitle: snapshot.title || attraction.title,
        action,
        rejectionReason: reason,
      }).catch((error) => {
        console.error('[Admin] sendAttractionReviewEmail error:', error);
      });
    }

    return res.status(200).json({
      success: true,
      message: action === 'APPROVED'
        ? 'Đã phê duyệt và công khai phiên bản địa điểm.'
        : 'Đã từ chối phiên bản và gửi lý do cho đối tác.',
    });
  } catch (error) {
    return next(error);
  }
}

async function hideAttraction(req, res, next) {
  try {
    const id = req.params.id;
    const { reason } = req.body || {};
    if (!reason || String(reason).trim() === '') return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'reason is required' } });

    const attraction = await prisma.attraction.findUnique({ where: { id }, include: { partner: { include: { user: true } } } });
    if (!attraction) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });

    await prisma.attraction.update({
      where: { id },
      data: {
        status: 'SUSPENDED',
        publicationStatus: 'PAUSED',
        rejectionReason: String(reason).trim(),
        reviewedAt: new Date(),
        reviewedById: req.user?.id || null,
      },
    });
    await writeAuditLog({
      req,
      action: 'ATTRACTION_SUSPENDED',
      entityType: 'ATTRACTION',
      entityId: id,
      metadata: { reason: String(reason).trim() },
    });

    // send email but don't block
    if (attraction.partner && attraction.partner.user && attraction.partner.user.email) {
      sendAttractionViolationEmail({ to: attraction.partner.user.email, partnerName: attraction.partner.businessName, attractionTitle: attraction.title, reason }).catch((err) => console.error('[Admin] Lỗi gửi email vi phạm:', err));
    }

    return res.status(200).json({ success: true, message: 'Địa điểm đã bị ẩn thành công và email cảnh báo đã gửi tới đối tác.' });
  } catch (error) {
    return next(error);
  }
}

// ─── Quản lý booking & payment toàn hệ thống ────────────────────────────────

const ALLOWED_BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_PARTNER',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'REFUND_REQUESTED',
  'REFUNDED',
];

// GET /api/admin/bookings — danh sách đặt vé toàn sàn cho admin.
// Hỗ trợ: ?status= ?search= (mã đơn / tên KH / email / địa điểm) ?refundRequired=true
//         ?page= ?limit=. Kèm thống kê tổng quan để vẽ thẻ trên dashboard.
async function getAdminBookings(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const status = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim();
    const onlyRefundRequired = String(req.query.refundRequired || '') === 'true';

    if (status && !ALLOWED_BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái đặt vé không hợp lệ.' });
    }

    const where = {};
    if (status) where.status = status;
    if (onlyRefundRequired) where.refundRequired = true;
    if (search) {
      where.OR = [
        { id: { contains: search } },
        { fullName: { contains: search } },
        { email: { contains: search } },
        {
          reservation: {
            ticketProduct: { attraction: { title: { contains: search } } },
          },
        },
      ];
    }

    const [total, bookings, statusGroups, refundRequiredCount, revenueAgg] =
      await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
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
                  include: {
                    attraction: {
                      select: {
                        title: true,
                        partner: { select: { businessName: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.booking.count({ where: { refundRequired: true } }),
        prisma.payment.aggregate({
          where: {
            status: 'SUCCESS',
            booking: { status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
          },
          _sum: { amount: true },
        }),
      ]);

    const data = bookings.map((b) => {
      const latestPayment = b.payments[0] || null;
      const timeSlot = b.reservation.timeSlot;
      return {
        id: b.id,
        customer: b.fullName,
        email: b.email,
        phone: b.phone,
        note: b.note,
        attraction: b.reservation.ticketProduct.attraction.title,
        partner: b.reservation.ticketProduct.attraction.partner?.businessName || null,
        ticketName: b.reservation.ticketProduct.name,
        quantity: b.reservation.quantity,
        visitDate: new Date(b.reservation.date).toISOString().slice(0, 10),
        timeSlot: timeSlot ? `${timeSlot.startTime} - ${timeSlot.endTime}` : null,
        totalAmount: Number(b.totalAmount),
        subtotalAmount: Number(b.subtotalAmount),
        discountAmount: Number(b.discountAmount),
        snapshotTicketType: b.snapshotTicketType,
        snapshotUnitPrice: Number(b.snapshotUnitPrice),
        status: b.status,
        refundRequired: b.refundRequired,
        refundStatus: b.refundRequests[0]?.status || null,
        paymentGateway: latestPayment?.paymentGateway || null,
        paymentStatus: latestPayment?.status || null,
        transactionId: latestPayment?.transactionId || null,
        paidAt: latestPayment?.paidAt || null,
        ticketInstances: b.ticketInstances || [],
        createdAt: b.createdAt,
      };
    });

    const countsByStatus = Object.fromEntries(
      statusGroups.map((g) => [g.status, g._count._all]),
    );

    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: {
        countsByStatus,
        refundRequired: refundRequiredCount,
        grossRevenue: Number(revenueAgg._sum.amount || 0),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const period = normalizePeriod(String(req.query.period || '').trim());
    const startDate = getPeriodStart(period);

    const [
      totalUsers,
      totalAttractions,
      activeAttractions,
      pendingPartnersCount,
      newPartners,
      periodBookings,
      successfulPayments,
      pendingPartners,
      pendingAttractions,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.attraction.count({ where: { archivedAt: null } }),
      prisma.attraction.count({
        where: {
          archivedAt: null,
          publicationStatus: 'ACTIVE',
          status: { not: 'SUSPENDED' },
        },
      }),
      prisma.partnerProfile.count({ where: { status: 'PENDING' } }),
      prisma.partnerProfile.count({ where: { createdAt: { gte: startDate } } }),
      prisma.booking.count({ where: { createdAt: { gte: startDate } } }),
      prisma.payment.findMany({
        where: {
          status: 'SUCCESS',
          createdAt: { gte: startDate },
          booking: { status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
        },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.partnerProfile.findMany({
        where: { status: 'PENDING' },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          businessName: true,
          createdAt: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
      prisma.attraction.findMany({
        where: { status: 'PENDING', archivedAt: null },
        take: 6,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          city: true,
          minTicketPrice: true,
          createdAt: true,
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 1,
            select: { imageUrl: true },
          },
          partner: { select: { businessName: true } },
        },
      }),
    ]);

    const revenue = successfulPayments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    return res.json({
      success: true,
      data: {
        period,
        stats: {
          revenue,
          totalUsers,
          totalAttractions,
          activeAttractions,
          pendingPartners: pendingPartnersCount,
          newPartners,
          bookings: periodBookings,
        },
        trend: buildTimeline(successfulPayments, period, (payment) => payment.amount),
        pendingPartners,
        pendingAttractions: pendingAttractions.map((attraction) => ({
          ...attraction,
          minTicketPrice: attraction.minTicketPrice == null
            ? null
            : Number(attraction.minTicketPrice),
          primaryImage: attraction.images[0]?.imageUrl || null,
          images: undefined,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listCategories(req, res, next) {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            attractions: {
              where: { attraction: { archivedAt: null } },
            },
          },
        },
      },
    });

    return res.json({
      success: true,
      data: categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description || '',
        icon: category.icon || 'category',
        isActive: category.isActive,
        attractionCount: category._count.attractions,
        createdAt: category.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

function categoryPayload(body, { partial = false } = {}) {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 80) {
      return { error: 'Tên danh mục phải có từ 2 đến 80 ký tự.' };
    }
    data.name = name;
  }
  if (body.description !== undefined) {
    const description = String(body.description || '').trim();
    if (description.length > 300) {
      return { error: 'Mô tả danh mục không được vượt quá 300 ký tự.' };
    }
    data.description = description || null;
  }
  if (body.icon !== undefined) {
    const icon = String(body.icon || '').trim();
    if (icon.length > 50) return { error: 'Tên biểu tượng không hợp lệ.' };
    data.icon = icon || null;
  }
  if (body.isActive !== undefined) data.isActive = parseBoolean(body.isActive);
  return { data };
}

async function createCategory(req, res, next) {
  try {
    const payload = categoryPayload(req.body);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const category = await prisma.category.create({ data: payload.data });
    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Tên danh mục đã tồn tại.' });
    }
    return next(error);
  }
}

async function updateCategory(req, res, next) {
  try {
    const payload = categoryPayload(req.body, { partial: true });
    if (payload.error) return res.status(400).json({ message: payload.error });
    if (Object.keys(payload.data).length === 0) {
      return res.status(400).json({ message: 'Không có dữ liệu cần cập nhật.' });
    }
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: payload.data,
    });
    return res.json({ success: true, data: category });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Tên danh mục đã tồn tại.' });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
    }
    return next(error);
  }
}

async function deleteCategory(req, res, next) {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { attractions: true } } },
    });
    if (!category) return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
    if (category._count.attractions > 0) {
      return res.status(409).json({
        message: 'Danh mục đang được sử dụng. Hãy chuyển sang trạng thái ẩn thay vì xóa.',
      });
    }
    await prisma.category.delete({ where: { id: category.id } });
    return res.json({ message: 'Đã xóa danh mục.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  changeUserStatus,
  getUsers,
  getPartners,
  getAttractions,
  reviewPartner,
  reviewAttraction,
  hideAttraction,
  getAdminBookings,
  getDashboard,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};

