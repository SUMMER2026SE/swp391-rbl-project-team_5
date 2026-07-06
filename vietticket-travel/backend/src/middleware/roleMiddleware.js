function restrictTo(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Bạn không có quyền thực hiện hành động này.',
      });
    }

    return next();
  };
}

function isPlatformStaff(user) {
  return user?.role === 'ADMIN' || (user?.role === 'STAFF' && !user.employerPartnerId);
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
