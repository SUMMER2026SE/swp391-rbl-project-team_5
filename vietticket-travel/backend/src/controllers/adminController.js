const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const { sendAccountStatusEmail, sendPartnerReviewEmail, sendAttractionViolationEmail } = require('../utils/mailer');

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

async function getAttractions(req, res, next) {
  try {
    const status = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim();
    const where = {};

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
        {
          partner: {
            businessName: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const attractions = await prisma.attraction.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        address: true,
        city: true,
        status: true,
        rejectionReason: true,
        averageRating: true,
        totalReviews: true,
        createdAt: true,
        partner: {
          select: {
            id: true,
            businessName: true,
          },
        },
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: 1,
          select: { imageUrl: true },
        },
        categories: {
          take: 1,
          select: {
            category: { select: { id: true, name: true } },
          },
        },
        ticketProducts: {
          where: { status: 'ACTIVE' },
          orderBy: { sellingPrice: 'asc' },
          take: 1,
          select: { sellingPrice: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = attractions.map((attraction) => ({
      id: attraction.id,
      title: attraction.title,
      description: attraction.description,
      address: attraction.address,
      city: attraction.city,
      status: attraction.status,
      rejectionReason: attraction.rejectionReason,
      averageRating: attraction.averageRating,
      totalReviews: attraction.totalReviews,
      createdAt: attraction.createdAt,
      partner: attraction.partner,
      primaryImage: attraction.images[0]?.imageUrl || null,
      category: attraction.categories[0]?.category || null,
      minPrice: attraction.ticketProducts[0]
        ? Number(attraction.ticketProducts[0].sellingPrice)
        : null,
    }));

    return res.status(200).json({ success: true, data });
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
    if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'action must be APPROVED or REJECTED' } });
    if (action === 'REJECTED' && (!rejectionReason || String(rejectionReason).trim() === '')) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'rejectionReason is required when rejecting' } });

    const attraction = await prisma.attraction.findUnique({ where: { id } });
    if (!attraction) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });

    const status = action === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    await prisma.attraction.update({ where: { id }, data: { status, rejectionReason: action === 'REJECTED' ? rejectionReason : null } });

    return res.status(200).json({ success: true, message: `Trạng thái địa điểm được cập nhật thành ${action}` });
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

    await prisma.attraction.update({ where: { id }, data: { status: 'SUSPENDED' } });

    // send email but don't block
    if (attraction.partner && attraction.partner.user && attraction.partner.user.email) {
      sendAttractionViolationEmail({ to: attraction.partner.user.email, partnerName: attraction.partner.businessName, attractionTitle: attraction.title, reason }).catch((err) => console.error('[Admin] Lỗi gửi email vi phạm:', err));
    }

    return res.status(200).json({ success: true, message: 'Địa điểm đã bị ẩn thành công và email cảnh báo đã gửi tới đối tác.' });
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
};

