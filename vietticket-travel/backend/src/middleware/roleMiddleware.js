const { hasAnyRole, hasRole } = require('../utils/userRoles');

function restrictTo(...roles) {
  return (req, res, next) => {
    if (!req.user || !hasAnyRole(req.user, roles)) {
      return res.status(403).json({
        message: 'Bạn không có quyền thực hiện hành động này.',
      });
    }

    return next();
  };
}

function isPlatformStaff(user) {
  return hasRole(user, 'ADMIN') || (hasRole(user, 'STAFF') && !user?.employerPartnerId);
}

function requirePlatformStaff(req, res, next) {
  if (!isPlatformStaff(req.user)) {
    return res.status(403).json({
      message: 'Chỉ nhân viên nội bộ của nền tảng mới có quyền thực hiện hành động này.',
      code: 'PLATFORM_STAFF_REQUIRED',
    });
  }

  return next();
}

module.exports = {
  isPlatformStaff,
  requirePlatformStaff,
  restrictTo,
};
