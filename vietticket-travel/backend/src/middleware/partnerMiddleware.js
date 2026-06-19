const prisma = require('../config/prisma');

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

// Chặn nhân viên (STAFF) thao tác khi đối tác chủ quản không còn APPROVED
// (ví dụ bị admin đình chỉ - SUSPENDED). ADMIN không thuộc đối tác nào -> bỏ qua.
async function requireActiveEmployer(req, res, next) {
  try {
    if (req.user?.role === 'ADMIN') return next();

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

module.exports = { requirePartner, requireApprovedPartner, requireActiveEmployer };
