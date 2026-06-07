const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const { sendAccountStatusEmail } = require('../utils/mailer');

const ALLOWED_ROLES = ['CUSTOMER', 'PARTNER', 'ADMIN', 'STAFF'];
const ALLOWED_STATUSES = ['ACTIVE', 'LOCKED'];
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

module.exports = {
  changeUserStatus,
  getUsers,
};
