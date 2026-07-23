const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const {
  sendAccountStatusEmail,
  sendPartnerReviewEmail,
  sendPartnerOperationalStatusEmail,
  sendAttractionReviewEmail,
  sendAttractionViolationEmail,
  sendAttractionRestoredEmail,
  sendStaffInviteEmail,
} = require('../utils/mailer');
const { writeAuditLog } = require('../utils/auditLog');
const {
  applyApprovedSnapshot,
  clearJsonField,
  validateSubmissionSnapshot,
} = require('../services/attractionWorkflowService');
const {
  getPeriodStart,
  normalizePeriod,
} = require('../services/analyticsService');
const {
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  TRANSACTION_TYPES,
  getPlatformFinancialReport,
  listPlatformFinancialTransactions,
} = require('../services/financialReportService');
const { refreshAttractionMinPrice } = require('../services/catalogService');
const { disconnectPartnerSockets, disconnectUserSockets } = require('../realtime/events');
const { grantRole, hasRole, revokeRole } = require('../utils/userRoles');
const { MAX_VND_AMOUNT } = require('../utils/money');
const { validateKyc } = require('../utils/partnerValidators');
const { isDocumentOwnedByUser } = require('../middleware/uploadMiddleware');
const { selectBookingPayment } = require('./bookingController');
const { addMinutes, createRandomToken, hashToken } = require('../utils/tokenUtils');
const {
  isValidEmail,
  isValidPhoneNumber,
  validateFullName,
} = require('../utils/validators');

const ALLOWED_ROLES = ['CUSTOMER', 'PARTNER', 'ADMIN', 'STAFF'];
const ALLOWED_STATUSES = ['ACTIVE', 'LOCKED'];
const ALLOWED_PARTNER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const ALLOWED_ATTRACTION_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'];
const ALLOWED_ATTRACTION_PUBLICATION_STATUSES = ['PAUSED', 'ACTIVE', 'ARCHIVED'];
const ALLOWED_ATTRACTION_OPERATIONAL_STATUSES = ['ACTIVE', 'SUSPENDED'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const FINANCIAL_TRANSACTION_STATUSES = new Set([
  ...PAYMENT_STATUSES,
  ...REFUND_STATUSES,
]);
const VOUCHER_DISCOUNT_TYPES = ['FIXED', 'PERCENTAGE'];
const VOUCHER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const MAX_VOUCHER_USAGE_LIMIT = 1_000_000;
const PLATFORM_STAFF_INVITE_EXPIRY_MINUTES = 60 * 48;

function nextPublicationStatusAfterApproval(attraction) {
  if (
    attraction?.publishedAt
    && ['ACTIVE', 'PAUSED'].includes(attraction.publicationStatus)
  ) {
    return attraction.publicationStatus;
  }
  return 'ACTIVE';
}

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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function createPlatformStaffInviteToken(tx, userId) {
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  const rawToken = createRandomToken();
  await tx.passwordResetToken.create({
    data: {
      userId,
      token: hashToken(rawToken),
      expiresAt: addMinutes(PLATFORM_STAFF_INVITE_EXPIRY_MINUTES),
    },
  });
  return rawToken;
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
    where.roleMemberships = { some: { role } };
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
          roleMemberships: { some: { role: 'CUSTOMER' } },
          status: 'ACTIVE',
        },
      }),
      prisma.user.count({
        where: {
          roleMemberships: { some: { role: 'PARTNER' } },
        },
      }),
      prisma.user.count({
        where: {
          status: 'LOCKED',
        },
      }),
      prisma.user.findMany({
        where,
        include: { profile: true, roleMemberships: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({
      users: users.map((user) => ({
        ...sanitizeUser(user),
        activated: Boolean(user.passwordHash),
      })),
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
    if (status === 'LOCKED' && (reason.length < 10 || reason.length > 500)) {
      return res.status(400).json({
        message: 'Lý do khóa tài khoản phải có từ 10 đến 500 ký tự.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, roleMemberships: true },
    });

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản người dùng.' });
    }

    if (status === 'LOCKED' && user.id === req.user.id) {
      return res.status(400).json({
        message: 'Bạn không thể tự khóa tài khoản của chính mình.',
      });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      if (status === 'LOCKED' && hasRole(user, 'ADMIN')) {
        const activeAdminCount = await tx.user.count({
          where: {
            status: 'ACTIVE',
            roleMemberships: { some: { role: 'ADMIN' } },
          },
        });
        if (activeAdminCount <= 1) {
          const error = new Error('Không thể khóa quản trị viên hoạt động cuối cùng.');
          error.statusCode = 409;
          throw error;
        }
      }

      const nextUser = await tx.user.update({
        where: { id: userId },
        data: {
          status,
          tokenVersion: { increment: 1 },
        },
        include: { profile: true, roleMemberships: true },
      });

      if (status === 'LOCKED') {
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await writeAuditLog({
        client: tx,
        req,
        action: status === 'LOCKED' ? 'USER_ACCOUNT_LOCKED' : 'USER_ACCOUNT_UNLOCKED',
        entityType: 'USER',
        entityId: userId,
        metadata: { reason: reason || null, previousStatus: user.status, status },
      });

      return nextUser;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (status === 'LOCKED') disconnectUserSockets(userId);

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

async function createPlatformStaff(req, res, next) {
  try {
    const fullName = String(req.body?.fullName || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(req.body?.email);
    const phoneNumber = req.body?.phoneNumber
      ? String(req.body.phoneNumber).trim()
      : null;
    const fullNameError = validateFullName(fullName);

    if (fullNameError) return res.status(400).json({ message: fullNameError });
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        message: 'Email này đã được sử dụng cho một tài khoản khác.',
      });
    }

    let rawInviteToken;
    const staff = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName,
          email,
          role: 'STAFF',
          provider: 'LOCAL',
          isEmailVerified: true,
          passwordHash: null,
          employerPartnerId: null,
          profile: { create: { phoneNumber } },
          roleMemberships: { create: { role: 'STAFF' } },
        },
        include: { profile: true, roleMemberships: true },
      });
      rawInviteToken = await createPlatformStaffInviteToken(tx, created.id);
      await writeAuditLog({
        client: tx,
        req,
        action: 'PLATFORM_STAFF_CREATED',
        entityType: 'USER',
        entityId: created.id,
        metadata: { email },
      });
      return created;
    });

    let emailDelivered = true;
    try {
      await sendStaffInviteEmail({
        to: email,
        fullName,
        businessName: 'VietTicket Operations',
        token: rawInviteToken,
      });
    } catch (error) {
      emailDelivered = false;
      console.error('[Admin] Không thể gửi lời mời nhân viên nền tảng:', error.message);
    }

    return res.status(201).json({
      success: true,
      message: emailDelivered
        ? 'Đã tạo nhân viên nền tảng và gửi email kích hoạt.'
        : 'Đã tạo tài khoản nhưng chưa gửi được email. Hãy dùng chức năng gửi lại lời mời.',
      emailDelivered,
      user: { ...sanitizeUser(staff), activated: false },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        message: 'Email này đã được sử dụng cho một tài khoản khác.',
      });
    }
    return next(error);
  }
}

async function resendPlatformStaffInvite(req, res, next) {
  try {
    const staff = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { roleMemberships: true },
    });
    if (!staff || staff.employerPartnerId || !hasRole(staff, 'STAFF')) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên nền tảng.' });
    }
    if (staff.passwordHash) {
      return res.status(409).json({ message: 'Tài khoản này đã được kích hoạt.' });
    }
    if (staff.status !== 'ACTIVE') {
      return res.status(409).json({
        message: 'Hãy mở khóa tài khoản trước khi gửi lại lời mời.',
      });
    }

    let rawInviteToken;
    await prisma.$transaction(async (tx) => {
      rawInviteToken = await createPlatformStaffInviteToken(tx, staff.id);
      await writeAuditLog({
        client: tx,
        req,
        action: 'PLATFORM_STAFF_INVITE_RESENT',
        entityType: 'USER',
        entityId: staff.id,
        metadata: { email: staff.email },
      });
    });
    await sendStaffInviteEmail({
      to: staff.email,
      fullName: staff.fullName,
      businessName: 'VietTicket Operations',
      token: rawInviteToken,
    });

    return res.json({ success: true, message: 'Đã gửi lại email kích hoạt.' });
  } catch (error) {
    return next(error);
  }
}

async function getAuditLogs(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, 25), MAX_LIMIT);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim().slice(0, 200);
    const action = String(req.query.action || '').trim().toUpperCase().slice(0, 100);
    const entityType = String(req.query.entityType || '').trim().toUpperCase().slice(0, 100);
    const actorId = String(req.query.actorId || '').trim();
    const where = {};

    if (action) where.action = action;
    if (entityType) {
      const aliases = {
        USER: ['USER', 'User'],
        BOOKING: ['BOOKING', 'Booking'],
        REFUND_REQUEST: ['REFUND_REQUEST', 'RefundRequest'],
        REVIEW: ['REVIEW', 'Review'],
        SUPPORT_TICKET: ['SUPPORT_TICKET', 'SupportTicket'],
        TICKET: ['TICKET', 'Ticket'],
      };
      where.entityType = { in: aliases[entityType] || [entityType] };
    }
    if (actorId) where.actorId = actorId;
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { actor: { fullName: { contains: search, mode: 'insensitive' } } },
        { actor: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [logs, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

// ---------- New admin functions for Partner/Attraction review ----------

async function getPartners(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;
    const status = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim().slice(0, 200);
    const where = {};

    if (status && !ALLOWED_PARTNER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Partner status is invalid' },
      });
    }

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { businessName: { contains: search, mode: 'insensitive' } },
        { taxCode: { contains: search, mode: 'insensitive' } },
        { representativeName: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const partnerSelect = {
        id: true,
        businessName: true,
        businessLicenseUrl: true,
        taxCode: true,
        registrationDate: true,
        representativeName: true,
        representativePhone: true,
        businessAddress: true,
        bankName: true,
        branchName: true,
        bankAccountNumber: true,
        bankAccountName: true,
        swiftCode: true,
        payoutCurrency: true,
        website: true,
        description: true,
        kycConsentAccepted: true,
        kycConsentVersion: true,
        kycConsentAcceptedAt: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            profile: { select: { phoneNumber: true } },
          },
        },
      };
    const [partners, total, statusGroups] = await prisma.$transaction([
      prisma.partnerProfile.findMany({
        where,
        select: partnerSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.partnerProfile.count({ where }),
      prisma.partnerProfile.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const data = partners.map((partner) => {
      const documentIsValid = isDocumentOwnedByUser(
        partner.businessLicenseUrl,
        partner.user?.id,
        req,
      );
      return {
        ...partner,
        businessLicenseUrl: documentIsValid ? partner.businessLicenseUrl : '',
        documentValidationStatus: documentIsValid ? 'VALID' : 'MISSING_OR_UNTRUSTED',
      };
    });

    const byStatus = Object.fromEntries(
      ALLOWED_PARTNER_STATUSES.map((value) => [value, 0]),
    );
    for (const group of statusGroups || []) {
      if (Object.hasOwn(byStatus, group.status)) {
        byStatus[group.status] = Number(group?._count?._all || 0);
      }
    }

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
      },
    });
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
    operationalStatus: attraction.operationalStatus,
    suspensionReason: attraction.suspensionReason,
    suspendedAt: attraction.suspendedAt,
    suspendedById: attraction.suspendedById,
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
    const statuses = String(req.query.statuses || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const uniqueStatuses = [...new Set(statuses)];
    const publicationStatus = String(req.query.publicationStatus || '').trim().toUpperCase();
    const operationalStatus = String(req.query.operationalStatus || '').trim().toUpperCase();
    const published = String(req.query.published || '').trim().toLowerCase();
    const partnerId = String(req.query.partnerId || '').trim();
    const categoryId = String(req.query.categoryId || '').trim();
    const search = String(req.query.search || '').trim();
    const where = { archivedAt: null };

    if (status && uniqueStatuses.length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Use either status or statuses, not both' },
      });
    }
    if (status && !ALLOWED_ATTRACTION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Attraction status is invalid' },
      });
    }
    if (uniqueStatuses.some((value) => !ALLOWED_ATTRACTION_STATUSES.includes(value))) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'One or more attraction statuses are invalid' },
      });
    }
    if (
      publicationStatus
      && !ALLOWED_ATTRACTION_PUBLICATION_STATUSES.includes(publicationStatus)
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Publication status is invalid' },
      });
    }
    if (
      operationalStatus
      && !ALLOWED_ATTRACTION_OPERATIONAL_STATUSES.includes(operationalStatus)
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Operational status is invalid' },
      });
    }
    if (published && !['true', 'false'].includes(published)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Published filter must be true or false' },
      });
    }
    if (status) where.status = status;
    if (uniqueStatuses.length > 0) where.status = { in: uniqueStatuses };
    if (publicationStatus) where.publicationStatus = publicationStatus;
    if (operationalStatus) where.operationalStatus = operationalStatus;
    if (published === 'true') where.publishedAt = { not: null };
    if (published === 'false') where.publishedAt = null;
    if (partnerId) where.partnerId = partnerId;
    if (categoryId) where.categories = { some: { categoryId } };
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
          status: true,
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

    const [attractions, total, statusGroups = [], operationalGroups = []] = await prisma.$transaction([
      prisma.attraction.findMany({
        where,
        include,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.attraction.count({ where }),
      prisma.attraction.groupBy({
        by: ['status'],
        where: { archivedAt: null },
        _count: { _all: true },
      }),
      prisma.attraction.groupBy({
        by: ['publicationStatus', 'operationalStatus'],
        where: { archivedAt: null, publishedAt: { not: null } },
        _count: { _all: true },
      }),
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
    const byStatus = Object.fromEntries(
      ALLOWED_ATTRACTION_STATUSES.map((value) => [value, 0]),
    );
    const operational = { active: 0, paused: 0, hidden: 0 };
    for (const group of statusGroups || []) {
      const count = Number(group?._count?._all || 0);
      if (Object.hasOwn(byStatus, group.status)) byStatus[group.status] += count;
    }
    for (const group of operationalGroups || []) {
      const count = Number(group?._count?._all || 0);
      if (group.operationalStatus === 'SUSPENDED') {
        operational.hidden += count;
      } else if (group.publicationStatus === 'ACTIVE') {
        operational.active += count;
      } else if (group.publicationStatus === 'PAUSED') {
        operational.paused += count;
      }
    }

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
        operational,
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

    const partner = await prisma.partnerProfile.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!partner) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Partner profile not found' } });
    if (partner.userId === req.user?.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SELF_REVIEW_FORBIDDEN',
          message: 'Quản trị viên không được tự xét duyệt hồ sơ đối tác của chính mình.',
        },
      });
    }

    // Chỉ xét duyệt hồ sơ đang chờ; tránh REJECTED lặp lại làm hạ role partner đã được duyệt.
    if (partner.status !== 'PENDING') {
      return res.status(409).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Chỉ có thể xét duyệt hồ sơ đang ở trạng thái chờ duyệt.' } });
    }

    if (action === 'APPROVED') {
      const registrationDate = partner.registrationDate instanceof Date
        && !Number.isNaN(partner.registrationDate.getTime())
        ? partner.registrationDate.toISOString().slice(0, 10)
        : String(partner.registrationDate || '').slice(0, 10);
      const kycValidationError = validateKyc({
        businessName: partner.businessName,
        businessLicenseUrl: partner.businessLicenseUrl,
        taxCode: partner.taxCode,
        registrationDate,
        representativeName: partner.representativeName,
        representativePhone: partner.representativePhone,
        businessAddress: partner.businessAddress,
        bankName: partner.bankName,
        branchName: partner.branchName,
        bankAccountNumber: partner.bankAccountNumber,
        bankAccountName: partner.bankAccountName,
        swiftCode: partner.swiftCode,
        payoutCurrency: partner.payoutCurrency,
        kycConsentAccepted: partner.kycConsentAccepted,
      });
      if (kycValidationError) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PARTNER_KYC_INCOMPLETE',
            message: `Không thể phê duyệt hồ sơ KYC chưa đầy đủ: ${kycValidationError}`,
          },
        });
      }
      if (!isDocumentOwnedByUser(partner.businessLicenseUrl, partner.userId, req)) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PARTNER_KYC_DOCUMENT_INVALID',
            message: 'Không thể phê duyệt vì tài liệu pháp lý bị thiếu hoặc không còn đáng tin cậy.',
          },
        });
      }
    }

    const normalizedRejectionReason =
      action === 'REJECTED' ? String(rejectionReason).trim() : null;
    let reviewCommitted;

    try {
      reviewCommitted = await prisma.$transaction(async (tx) => {
        // Claim the pending profile and apply every role/audit side effect in
        // one transaction. A competing reviewer acts on a stale PENDING row
        // and therefore cannot update any row.
        const claimed = await tx.partnerProfile.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: action,
            rejectionReason: normalizedRejectionReason,
          },
        });
        if (claimed.count !== 1) return false;

        if (action === 'APPROVED') {
          await tx.user.update({ where: { id: partner.userId }, data: { role: 'PARTNER' } });
          await grantRole(tx, partner.userId, 'CUSTOMER');
          await grantRole(tx, partner.userId, 'PARTNER');
        } else {
          await tx.user.update({
            where: { id: partner.userId },
            data: { role: 'CUSTOMER' },
          });
          await grantRole(tx, partner.userId, 'CUSTOMER');
          await revokeRole(tx, partner.userId, 'PARTNER');
        }

        await writeAuditLog({
          client: tx,
          req,
          action: action === 'APPROVED'
            ? 'PARTNER_KYC_APPROVED'
            : 'PARTNER_KYC_REJECTED',
          entityType: 'PARTNER',
          entityId: id,
          metadata: {
            previousStatus: partner.status,
            ...(normalizedRejectionReason
              ? { rejectionReason: normalizedRejectionReason }
              : {}),
          },
        });

        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // PostgreSQL can surface a serialization conflict instead of a zero-row
      // conditional update when both reviewers commit at nearly the same time.
      if (error?.code === 'P2034') {
        reviewCommitted = false;
      } else {
        throw error;
      }
    }

    if (!reviewCommitted) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'PARTNER_REVIEW_CONFLICT',
          message: 'Hồ sơ vừa được quản trị viên khác xử lý. Vui lòng tải lại danh sách.',
        },
      });
    }

    // Notify only after the state, role memberships, and audit log commit.
    sendPartnerReviewEmail({
      to: partner.user.email,
      businessName: partner.businessName,
      action,
      ...(normalizedRejectionReason
        ? { rejectionReason: normalizedRejectionReason }
        : {}),
    }).catch((err) => console.error('[Admin] sendPartnerReviewEmail error:', err));

    return res.status(200).json({ success: true, message: `Trạng thái đối tác đã được cập nhật thành ${action}` });
  } catch (error) {
    return next(error);
  }
}

async function changePartnerOperationalStatus(req, res, next) {
  try {
    const id = req.params.id;
    const status = String(req.body?.status || '').trim().toUpperCase();
    const reason = String(req.body?.reason || '').trim();

    if (!['APPROVED', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'status must be APPROVED or SUSPENDED',
        },
      });
    }
    if (status === 'SUSPENDED' && !reason) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'reason is required when suspending' },
      });
    }
    if (reason.length > 1000) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'reason must not exceed 1000 characters' },
      });
    }

    const partner = await prisma.partnerProfile.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Partner profile not found' },
      });
    }

    const expectedStatus = status === 'SUSPENDED' ? 'APPROVED' : 'SUSPENDED';
    if (partner.status !== expectedStatus) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Partner must be ${expectedStatus} before changing to ${status}.`,
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.partnerProfile.updateMany({
        where: { id, status: expectedStatus },
        data: {
          status,
          rejectionReason: status === 'SUSPENDED' ? reason : null,
        },
      });
      if (updated.count !== 1) {
        const error = new Error('Partner status was changed by another administrator.');
        error.statusCode = 409;
        throw error;
      }

      await writeAuditLog({
        client: tx,
        req,
        action: status === 'SUSPENDED' ? 'PARTNER_SUSPENDED' : 'PARTNER_RESTORED',
        entityType: 'PARTNER',
        entityId: id,
        metadata: {
          previousStatus: expectedStatus,
          status,
          reason: status === 'SUSPENDED' ? reason : null,
        },
      });
    });

    if (status === 'SUSPENDED') disconnectPartnerSockets(id);

    if (partner.user?.email) {
      sendPartnerOperationalStatusEmail({
        to: partner.user.email,
        businessName: partner.businessName,
        status,
        reason,
      }).catch((error) => {
        console.error('[Admin] sendPartnerOperationalStatusEmail error:', error);
      });
    }

    return res.status(200).json({
      success: true,
      message: status === 'SUSPENDED'
        ? 'Đã đình chỉ đối tác và dừng toàn bộ lượt bán mới.'
        : 'Đã khôi phục đối tác. Các địa điểm vẫn giữ nguyên trạng thái mở hoặc tạm dừng trước đó.',
      data: {
        ...Object.fromEntries(Object.entries(partner).filter(([key]) => key !== 'user')),
        user: partner.user,
        status,
        rejectionReason: status === 'SUSPENDED' ? reason : null,
      },
    });
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
      include: { partner: { include: { user: { select: { email: true } } } } },
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
        await refreshAttractionMinPrice(tx, id);
        await tx.attraction.update({
          where: { id },
          data: {
            status: 'APPROVED',
            publicationStatus: nextPublicationStatusAfterApproval(attraction),
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

    const attraction = await prisma.attraction.findUnique({
      where: { id },
      include: { partner: { include: { user: { select: { email: true } } } } },
    });
    if (!attraction || attraction.archivedAt) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });
    if (!attraction.publishedAt || attraction.operationalStatus === 'SUSPENDED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: 'Chỉ có thể đình chỉ địa điểm đã được phê duyệt và phát hành.',
        },
      });
    }

    const suspensionReason = String(reason).trim();
    const suspendedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const updated = await tx.attraction.updateMany({
        where: {
          id,
          publishedAt: { not: null },
          operationalStatus: 'ACTIVE',
          archivedAt: null,
        },
        data: {
          operationalStatus: 'SUSPENDED',
          publicationStatus: 'PAUSED',
          suspensionReason,
          suspendedAt,
          suspendedById: req.user?.id || null,
        },
      });
      if (updated.count !== 1) {
        const error = new Error('Attraction status was changed by another administrator.');
        error.statusCode = 409;
        throw error;
      }
      await writeAuditLog({
        client: tx,
        req,
        action: 'ATTRACTION_SUSPENDED',
        entityType: 'ATTRACTION',
        entityId: id,
        metadata: {
          reason: suspensionReason,
          previousReviewStatus: attraction.status,
          previousPublicationStatus: attraction.publicationStatus,
        },
      });
    });

    // send email but don't block
    if (attraction.partner && attraction.partner.user && attraction.partner.user.email) {
      sendAttractionViolationEmail({ to: attraction.partner.user.email, partnerName: attraction.partner.businessName, attractionTitle: attraction.title, reason: suspensionReason }).catch((err) => console.error('[Admin] Lỗi gửi email vi phạm:', err));
    }

    return res.status(200).json({ success: true, message: 'Địa điểm đã bị ẩn thành công và email cảnh báo đã gửi tới đối tác.' });
  } catch (error) {
    return next(error);
  }
}

async function restoreAttraction(req, res, next) {
  try {
    const id = req.params.id;
    const attraction = await prisma.attraction.findUnique({
      where: { id },
      include: { partner: { include: { user: { select: { email: true } } } } },
    });
    if (!attraction || attraction.archivedAt) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Attraction not found' },
      });
    }
    if (attraction.operationalStatus !== 'SUSPENDED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: 'Chỉ có thể khôi phục địa điểm đang bị đình chỉ.',
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.attraction.updateMany({
        where: { id, operationalStatus: 'SUSPENDED', archivedAt: null },
        data: {
          operationalStatus: 'ACTIVE',
          publicationStatus: 'PAUSED',
          suspensionReason: null,
          suspendedAt: null,
          suspendedById: null,
        },
      });
      if (updated.count !== 1) {
        const error = new Error('Attraction status was changed by another administrator.');
        error.statusCode = 409;
        throw error;
      }
      await writeAuditLog({
        client: tx,
        req,
        action: 'ATTRACTION_RESTORED',
        entityType: 'ATTRACTION',
        entityId: id,
        metadata: {
          reviewStatus: attraction.status,
          previousOperationalStatus: 'SUSPENDED',
          publicationStatus: 'PAUSED',
          previousReason: attraction.suspensionReason || null,
        },
      });
    });

    const recipient = attraction.partner?.user?.email;
    if (recipient) {
      sendAttractionRestoredEmail({
        to: recipient,
        partnerName: attraction.partner.businessName,
        attractionTitle: attraction.title,
      }).catch((error) => {
        console.error('[Admin] sendAttractionRestoredEmail error:', error);
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Đã khôi phục địa điểm ở trạng thái tạm dừng. Đối tác phải chủ động mở bán lại.',
      data: {
        ...attraction,
        operationalStatus: 'ACTIVE',
        publicationStatus: 'PAUSED',
        suspensionReason: null,
        suspendedAt: null,
        suspendedById: null,
      },
    });
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

    const where = { isForecastTrainingSample: false };
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
        prisma.booking.groupBy({
          by: ['status'],
          where: { isForecastTrainingSample: false },
          _count: { _all: true },
        }),
        prisma.booking.count({
          where: { refundRequired: true, isForecastTrainingSample: false },
        }),
        prisma.payment.aggregate({
          where: {
            status: 'SUCCESS',
            isDuplicate: false,
            booking: {
              status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
              isForecastTrainingSample: false,
            },
          },
          _sum: { amount: true },
        }),
      ]);

    const data = bookings.map((b) => {
      const latestPayment = selectBookingPayment(b.payments);
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
      financialReport,
      pendingPartners,
      pendingAttractions,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.attraction.count({ where: { archivedAt: null } }),
      prisma.attraction.count({
        where: {
          archivedAt: null,
          publishedAt: { not: null },
          publicationStatus: 'ACTIVE',
          operationalStatus: 'ACTIVE',
          partner: { status: 'APPROVED' },
        },
      }),
      prisma.partnerProfile.count({ where: { status: 'PENDING' } }),
      prisma.partnerProfile.count({ where: { createdAt: { gte: startDate } } }),
      prisma.booking.count({
        where: {
          createdAt: { gte: startDate },
          isForecastTrainingSample: false,
        },
      }),
      getPlatformFinancialReport(period),
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

    return res.json({
      success: true,
      data: {
        period,
        stats: {
          // Compatibility: revenue now means net gateway cash flow, not GMV.
          revenue: financialReport.summary.netCashAmount,
          ...financialReport.summary,
          totalUsers,
          totalAttractions,
          activeAttractions,
          pendingPartners: pendingPartnersCount,
          newPartners,
          bookings: periodBookings,
        },
        trend: financialReport.timeline,
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

async function getFinancialReport(req, res, next) {
  try {
    const period = normalizePeriod(String(req.query.period || '').trim());
    const report = await getPlatformFinancialReport(period);

    return res.json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
}

async function getFinancialTransactions(req, res, next) {
  try {
    const type = String(req.query.type || 'ALL').trim().toUpperCase();
    const status = String(req.query.status || '').trim().toUpperCase();

    if (!TRANSACTION_TYPES.has(type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TRANSACTION_TYPE', message: 'Loại giao dịch không hợp lệ.' },
      });
    }
    if (status && !FINANCIAL_TRANSACTION_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TRANSACTION_STATUS', message: 'Trạng thái giao dịch không hợp lệ.' },
      });
    }

    const result = await listPlatformFinancialTransactions({
      period: String(req.query.period || '').trim(),
      type,
      status,
      search: req.query.search,
      limit: req.query.limit,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function changePartnerCommissionRate(req, res, next) {
  try {
    const rawCommissionRate = req.body?.commissionRatePercent;
    const commissionRatePercent = Number(rawCommissionRate);
    if (
      rawCommissionRate == null
      || String(rawCommissionRate).trim() === ''
      || !Number.isInteger(commissionRatePercent)
      || commissionRatePercent < 0
      || commissionRatePercent > 100
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_COMMISSION_RATE',
          message: 'Tỷ lệ hoa hồng phải là số nguyên từ 0 đến 100.',
        },
      });
    }

    const partner = await prisma.partnerProfile.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        businessName: true,
        status: true,
        commissionRate: true,
      },
    });
    if (!partner) {
      return res.status(404).json({
        success: false,
        error: { code: 'PARTNER_NOT_FOUND', message: 'Không tìm thấy đối tác.' },
      });
    }
    if (partner.status !== 'APPROVED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'PARTNER_NOT_APPROVED',
          message: 'Chỉ có thể thiết lập hoa hồng cho đối tác đang hoạt động.',
        },
      });
    }

    const previousRate = Number(partner.commissionRate);
    const commissionRate = commissionRatePercent / 100;
    const updated = await prisma.$transaction(async (tx) => {
      const profile = await tx.partnerProfile.update({
        where: { id: partner.id },
        data: { commissionRate },
        select: {
          id: true,
          businessName: true,
          status: true,
          commissionRate: true,
        },
      });

      await writeAuditLog({
        client: tx,
        req,
        action: 'PARTNER_COMMISSION_RATE_CHANGED',
        entityType: 'PARTNER',
        entityId: partner.id,
        metadata: {
          previousRate,
          commissionRate,
          appliesTo: 'FUTURE_BOOKINGS_ONLY',
        },
      });

      return profile;
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật tỷ lệ hoa hồng cho các booking tạo mới.',
      data: {
        ...updated,
        commissionRate: Number(updated.commissionRate),
        commissionRatePercent: Number(updated.commissionRate) * 100,
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
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({ data: payload.data });
      await writeAuditLog({
        client: tx,
        req,
        action: 'CATEGORY_CREATED',
        entityType: 'CATEGORY',
        entityId: created.id,
        metadata: { name: created.name },
      });
      return created;
    });
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
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
    }
    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id: req.params.id },
        data: payload.data,
      });
      await writeAuditLog({
        client: tx,
        req,
        action: 'CATEGORY_UPDATED',
        entityType: 'CATEGORY',
        entityId: updated.id,
        metadata: {
          before: {
            name: existing.name,
            description: existing.description,
            icon: existing.icon,
            isActive: existing.isActive,
          },
          changes: payload.data,
        },
      });
      return updated;
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
    await prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id: category.id } });
      await writeAuditLog({
        client: tx,
        req,
        action: 'CATEGORY_DELETED',
        entityType: 'CATEGORY',
        entityId: category.id,
        metadata: { name: category.name },
      });
    });
    return res.json({ message: 'Đã xóa danh mục.' });
  } catch (error) {
    return next(error);
  }
}

function serializeVoucher(voucher, now = new Date()) {
  const expired = voucher.expiryDate <= now;
  const exhausted = voucher.usageLimit != null && voucher.usedCount >= voucher.usageLimit;

  return {
    ...voucher,
    discountValue: Number(voucher.discountValue),
    maxDiscount: voucher.maxDiscount == null ? null : Number(voucher.maxDiscount),
    minSpend: voucher.minSpend == null ? null : Number(voucher.minSpend),
    operationalStatus: !voucher.isActive
      ? 'INACTIVE'
      : expired
        ? 'EXPIRED'
        : exhausted
          ? 'EXHAUSTED'
          : 'ACTIVE',
  };
}

function parseVoucherMoney(value, fieldName, { nullable = false, allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') {
    return nullable ? { value: null } : { error: `${fieldName} là bắt buộc.` };
  }

  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > MAX_VND_AMOUNT) {
    return {
      error: `${fieldName} phải là số nguyên từ ${minimum.toLocaleString('vi-VN')} đến ${MAX_VND_AMOUNT.toLocaleString('vi-VN')} VND.`,
    };
  }

  return { value: parsed };
}

function parseVoucherUsageLimit(value) {
  if (value === null || value === undefined || value === '') return { value: null };

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_VOUCHER_USAGE_LIMIT) {
    return {
      error: `Giới hạn sử dụng phải là số nguyên từ 1 đến ${MAX_VOUCHER_USAGE_LIMIT.toLocaleString('vi-VN')}.`,
    };
  }

  return { value: parsed };
}

function voucherPayload(body, { partial = false, currentVoucher = null } = {}) {
  const data = {};

  if (partial && body.discountType !== undefined && body.discountValue === undefined) {
    return { error: 'Cần nhập lại giá trị giảm khi thay đổi loại voucher.' };
  }

  if (!partial || body.code !== undefined) {
    const code = String(body.code || '').trim().toUpperCase();
    if (!VOUCHER_CODE_PATTERN.test(code)) {
      return {
        error: 'Mã voucher phải có 3-32 ký tự, chỉ gồm chữ in hoa, số, dấu gạch ngang hoặc gạch dưới.',
      };
    }
    data.code = code;
  }

  if (!partial || body.discountType !== undefined) {
    const discountType = String(body.discountType || '').trim().toUpperCase();
    if (!VOUCHER_DISCOUNT_TYPES.includes(discountType)) {
      return { error: 'Loại giảm giá không hợp lệ.' };
    }
    data.discountType = discountType;
  }

  const effectiveType = data.discountType || currentVoucher?.discountType;
  if (!partial || body.discountValue !== undefined) {
    const parsed = parseVoucherMoney(body.discountValue, 'Giá trị giảm');
    if (parsed.error) return parsed;
    if (effectiveType === 'PERCENTAGE' && parsed.value > 100) {
      return { error: 'Voucher phần trăm phải có giá trị từ 1 đến 100.' };
    }
    data.discountValue = parsed.value;
  }

  if (!partial || body.maxDiscount !== undefined || body.discountType !== undefined) {
    if (effectiveType === 'FIXED') {
      data.maxDiscount = null;
    } else {
      const parsed = parseVoucherMoney(body.maxDiscount, 'Mức giảm tối đa', { nullable: true });
      if (parsed.error) return parsed;
      data.maxDiscount = parsed.value;
    }
  }

  if (!partial || body.minSpend !== undefined) {
    const parsed = parseVoucherMoney(body.minSpend, 'Giá trị đơn tối thiểu', {
      nullable: true,
      allowZero: true,
    });
    if (parsed.error) return parsed;
    data.minSpend = parsed.value;
  }

  if (!partial || body.expiryDate !== undefined) {
    const expiryDate = new Date(body.expiryDate);
    if (Number.isNaN(expiryDate.getTime()) || (!partial && expiryDate <= new Date())) {
      return {
        error: partial
          ? 'Thời hạn voucher không hợp lệ.'
          : 'Thời hạn voucher phải là một thời điểm hợp lệ trong tương lai.',
      };
    }
    data.expiryDate = expiryDate;
  }

  if (!partial || body.usageLimit !== undefined) {
    const parsed = parseVoucherUsageLimit(body.usageLimit);
    if (parsed.error) return parsed;
    if (currentVoucher && parsed.value != null && parsed.value < currentVoucher.usedCount) {
      return { error: 'Giới hạn sử dụng không thể nhỏ hơn số lượt đã dùng.' };
    }
    data.usageLimit = parsed.value;
  }

  if (body.isActive !== undefined) data.isActive = parseBoolean(body.isActive);

  return { data };
}

async function listVouchers(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const requestedLimit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT);
    const limit = Math.min(requestedLimit, MAX_LIMIT);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim().toUpperCase();
    const activeFilter = String(req.query.isActive || '').trim().toLowerCase();
    const where = {};

    if (search) where.code = { contains: search, mode: 'insensitive' };
    if (activeFilter === 'true' || activeFilter === 'false') {
      where.isActive = activeFilter === 'true';
    }

    const [vouchers, total] = await prisma.$transaction([
      prisma.voucher.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.voucher.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: vouchers.map((voucher) => serializeVoucher(voucher)),
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

async function createVoucher(req, res, next) {
  try {
    const payload = voucherPayload(req.body);
    if (payload.error) return res.status(400).json({ message: payload.error });

    const voucher = await prisma.$transaction(async (tx) => {
      const created = await tx.voucher.create({ data: payload.data });
      await writeAuditLog({
        client: tx,
        req,
        action: 'VOUCHER_CREATED',
        entityType: 'VOUCHER',
        entityId: created.id,
        metadata: { code: created.code },
      });
      return created;
    });

    return res.status(201).json({
      success: true,
      data: serializeVoucher(voucher),
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Mã voucher đã tồn tại.' });
    }
    return next(error);
  }
}

async function updateVoucher(req, res, next) {
  try {
    const currentVoucher = await prisma.voucher.findUnique({
      where: { id: req.params.id },
    });
    if (!currentVoucher) {
      return res.status(404).json({ message: 'Không tìm thấy voucher.' });
    }

    const payload = voucherPayload(req.body, { partial: true, currentVoucher });
    if (payload.error) return res.status(400).json({ message: payload.error });
    if (Object.keys(payload.data).length === 0) {
      return res.status(400).json({ message: 'Không có dữ liệu cần cập nhật.' });
    }

    const protectedFields = [
      'code',
      'discountType',
      'discountValue',
      'maxDiscount',
      'minSpend',
    ];
    const changesFinancialTerms = protectedFields.some(
      (field) => Object.prototype.hasOwnProperty.call(payload.data, field),
    );
    if (currentVoucher.usedCount > 0 && changesFinancialTerms) {
      return res.status(409).json({
        message: 'Voucher đã được sử dụng. Chỉ có thể đổi thời hạn, giới hạn lượt dùng hoặc trạng thái.',
      });
    }

    const voucher = await prisma.$transaction(async (tx) => {
      const updated = await tx.voucher.update({
        where: { id: currentVoucher.id },
        data: payload.data,
      });
      await writeAuditLog({
        client: tx,
        req,
        action: 'VOUCHER_UPDATED',
        entityType: 'VOUCHER',
        entityId: updated.id,
        metadata: {
          code: updated.code,
          changedFields: Object.keys(payload.data),
        },
      });
      return updated;
    });

    return res.status(200).json({
      success: true,
      data: serializeVoucher(voucher),
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Mã voucher đã tồn tại.' });
    }
    return next(error);
  }
}

module.exports = {
  changeUserStatus,
  createPlatformStaff,
  resendPlatformStaffInvite,
  getAuditLogs,
  getUsers,
  getPartners,
  getAttractions,
  reviewPartner,
  changePartnerOperationalStatus,
  reviewAttraction,
  hideAttraction,
  restoreAttraction,
  getAdminBookings,
  getDashboard,
  getFinancialReport,
  getFinancialTransactions,
  changePartnerCommissionRate,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listVouchers,
  createVoucher,
  updateVoucher,
};

