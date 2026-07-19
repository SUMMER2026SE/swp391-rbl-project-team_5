const prisma = require('../config/prisma');
const { hasAnyRole, hasRole } = require('../utils/userRoles');

// Đảm bảo người dùng đã có hồ sơ đối tác (PartnerProfile).
// Nạp hồ sơ vào req.partner để các controller dùng partnerId.
async function requirePartner(req, res, next) {
  try {
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!partner) {
      return res.status(403).json({
        message: 'Bạn chưa hoàn tất đăng ký đối tác. Vui lòng nộp hồ sơ KYC.',
        code: 'PARTNER_PROFILE_REQUIRED',
      });
    }

    req.partner = partner;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireApprovedPartner(req, res, next) {
  if (!req.partner) {
    return res.status(403).json({
      message: 'Bạn chưa hoàn tất đăng ký đối tác.',
      code: 'PARTNER_PROFILE_REQUIRED',
    });
  }

  if (req.partner.status !== 'APPROVED') {
    return res.status(403).json({
      message: 'Hồ sơ đối tác chưa được phê duyệt.',
      code: 'PARTNER_APPROVAL_REQUIRED',
      partnerStatus: req.partner.status,
    });
  }

  return next();
}

async function requireApprovedPartnerOrAdmin(req, res, next) {
  try {
    if (hasRole(req.user, 'ADMIN')) return next();
    if (!hasRole(req.user, 'PARTNER')) {
      return res.status(403).json({
        message: 'Chỉ đối tác đã được duyệt hoặc quản trị viên mới có thể tải ảnh địa điểm.',
        code: 'APPROVED_PARTNER_OR_ADMIN_REQUIRED',
      });
    }

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });
    if (!partner || partner.status !== 'APPROVED') {
      return res.status(403).json({
        message: 'Hồ sơ đối tác chưa được phê duyệt.',
        code: 'PARTNER_APPROVAL_REQUIRED',
        partnerStatus: partner?.status || null,
      });
    }

    req.partner = partner;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireKycDocumentUploader(req, res, next) {
  const eligible = hasAnyRole(req.user, ['CUSTOMER', 'PARTNER'])
    && !hasAnyRole(req.user, ['ADMIN', 'STAFF']);
  if (!eligible) {
    return res.status(403).json({
      message: 'Tài liệu KYC chỉ dành cho tài khoản khách hàng hoặc đối tác.',
      code: 'KYC_DOCUMENT_ROLE_REQUIRED',
    });
  }
  return next();
}

async function requireOwnedAttraction(req, res, next) {
  try {
    const attraction = await prisma.attraction.findUnique({
      where: { id: String(req.params.id || '') },
      select: { id: true, partnerId: true, archivedAt: true },
    });
    if (
      !attraction
      || attraction.archivedAt
      || attraction.partnerId !== req.partner?.id
    ) {
      return res.status(404).json({
        message: 'Không tìm thấy điểm tham quan.',
        code: 'ATTRACTION_NOT_FOUND',
      });
    }

    req.ownedAttraction = attraction;
    return next();
  } catch (error) {
    return next(error);
  }
}

// Chặn nhân viên (STAFF) thao tác khi đối tác chủ quản không còn APPROVED
// (ví dụ bị admin đình chỉ - SUSPENDED). ADMIN không thuộc đối tác nào -> bỏ qua.
async function requireActiveEmployer(req, res, next) {
  try {
    if (hasRole(req.user, 'ADMIN')) return next();

    const employerId = req.user?.employerPartnerId;
    if (!employerId) {
      return res.status(403).json({
        message: 'Tài khoản nhân viên chưa thuộc đối tác nào.',
        code: 'EMPLOYER_REQUIRED',
      });
    }

    const employer = await prisma.partnerProfile.findUnique({
      where: { id: employerId },
      select: { status: true },
    });

    if (!employer || employer.status !== 'APPROVED') {
      return res.status(403).json({
        message: 'Đối tác chủ quản đang bị tạm ngưng. Vui lòng liên hệ quản trị viên.',
        code: 'EMPLOYER_NOT_ACTIVE',
        employerStatus: employer?.status || null,
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

// A suspended partner must stop selling and managing its catalogue, but its on-site
// staff still need to honour tickets that the platform already confirmed.
async function requireCheckInEmployer(req, res, next) {
  try {
    if (hasRole(req.user, 'ADMIN')) return next();

    const employerId = req.user?.employerPartnerId;
    if (!employerId) {
      return res.status(403).json({
        message: 'Tài khoản nhân viên chưa thuộc đối tác nào.',
        code: 'EMPLOYER_REQUIRED',
      });
    }

    const employer = await prisma.partnerProfile.findUnique({
      where: { id: employerId },
      select: { status: true },
    });

    if (!employer || !['APPROVED', 'SUSPENDED'].includes(employer.status)) {
      return res.status(403).json({
        message: 'Đối tác chủ quản không đủ điều kiện thực hiện check-in.',
        code: 'EMPLOYER_CHECKIN_UNAVAILABLE',
        employerStatus: employer?.status || null,
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requirePartner,
  requireApprovedPartner,
  requireApprovedPartnerOrAdmin,
  requireKycDocumentUploader,
  requireOwnedAttraction,
  requireActiveEmployer,
  requireCheckInEmployer,
};
