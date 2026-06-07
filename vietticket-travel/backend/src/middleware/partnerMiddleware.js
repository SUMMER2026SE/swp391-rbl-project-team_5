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

module.exports = { requirePartner };
