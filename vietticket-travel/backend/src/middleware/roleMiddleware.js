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
  return hasRole(user, 'ADMIN') || (
    hasRole(user, 'STAFF')
    && !user?.employerPartnerId
    && (user.staffAccessLevel || 'MANAGER') === 'MANAGER'
  );
}

function getStaffAccessLevel(user) {
  if (hasRole(user, 'ADMIN')) return 'MANAGER';
  if (!hasRole(user, 'STAFF')) return null;
  return user.staffAccessLevel || (user.employerPartnerId ? 'SCANNER' : 'MANAGER');
}

function requireStaffAccess(...levels) {
  return (req, res, next) => {
    const level = getStaffAccessLevel(req.user);
    if (!level || !levels.includes(level)) {
      return res.status(403).json({
        message: 'Cấp quyền nhân viên không đủ cho thao tác này.',
        code: 'STAFF_ACCESS_LEVEL_REQUIRED',
        requiredLevels: levels,
      });
    }
    return next();
  };
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
  getStaffAccessLevel,
  isPlatformStaff,
  requirePlatformStaff,
  requireStaffAccess,
  restrictTo,
};
