const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const { validateKyc } = require('../utils/partnerValidators');
const { isValidPhoneNumber } = require('../utils/validators');

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

// POST /api/partners/register — Nộp hồ sơ KYC, tạo PartnerProfile, nâng role lên PARTNER
async function submitKyc(req, res, next) {
  try {
    const validationError = validateKyc(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const existing = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (existing) {
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

    const [partner] = await prisma.$transaction([
      prisma.partnerProfile.create({ data }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { role: 'PARTNER' },
      }),
    ]);

    const refreshedUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });

    return res.status(201).json({
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
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });

    return res.json({ partner: toPartnerResponse(req.partner, user) });
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

// GET /api/partners/dashboard — Thống kê tổng quan (số liệu thật từ CRUD Module 2)
// Lưu ý: số liệu đặt vé/doanh thu thuộc module đặt vé (chưa có model Booking)
// nên tạm trả về 0; FE sẽ hiển thị "—" hoặc dữ liệu mẫu cho các ô đó.
async function getDashboard(req, res, next) {
  try {
    const partnerId = req.partner.id;

    const attractions = await prisma.attraction.findMany({
      where: { partnerId },
      select: { id: true, status: true },
    });

    const attractionIds = attractions.map((a) => a.id);

    const totalTickets = attractionIds.length
      ? await prisma.ticketProduct.count({ where: { attractionId: { in: attractionIds } } })
      : 0;

    const stats = {
      totalAttractions: attractions.length,
      activeAttractions: attractions.filter((a) => a.status === 'APPROVED').length,
      totalTickets,
      // Phần đặt vé — chờ module đặt vé cung cấp model Booking
      totalBookingsThisMonth: 0,
      revenueThisMonth: 0,
      pendingBookings: 0,
    };

    return res.json({
      stats,
      recentBookings: [], // chờ module đặt vé
      partnerStatus: req.partner.status,
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
  // Aliases để tương thích với MPhu
  registerPartner: submitKyc,
  getMyPartnerProfile: getMyPartner,
};

