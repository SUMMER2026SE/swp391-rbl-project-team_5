const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { sanitizeUser } = require('./authController');
const {
  isValidAvatarUrl,
  isValidGender,
  isValidPhoneNumber,
  validateDateOfBirth,
  validateFullName,
  validatePassword,
} = require('../utils/validators');

const SALT_ROUNDS = 10;

function toNullableString(value) {
  if (value === undefined) return undefined;
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function toNullableDate(value) {
  if (value === undefined || value === null || value === '') return value === undefined ? undefined : null;

  const dateError = validateDateOfBirth(value);

  if (dateError) {
    const error = new Error(dateError);
    error.statusCode = 400;
    throw error;
  }

  return new Date(value);
}

async function getProfile(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });

    return res.json({ user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const userUpdate = {};
    const profileUpdate = {};

    if (req.body.fullName !== undefined) {
      const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
      const fullNameError = validateFullName(fullName);

      if (fullNameError) {
        return res.status(400).json({ message: fullNameError });
      }

      userUpdate.fullName = fullName;
    }

    if (req.body.phoneNumber !== undefined) {
      profileUpdate.phoneNumber = toNullableString(req.body.phoneNumber);

      if (!isValidPhoneNumber(profileUpdate.phoneNumber)) {
        return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
      }
    }

    if (req.body.avatarUrl !== undefined) {
      profileUpdate.avatarUrl = toNullableString(req.body.avatarUrl);

      if (!isValidAvatarUrl(profileUpdate.avatarUrl)) {
        return res.status(400).json({ message: 'Ảnh đại diện phải là URL hợp lệ.' });
      }
    }

    if (req.body.gender !== undefined) {
      profileUpdate.gender = toNullableString(req.body.gender);

      if (!isValidGender(profileUpdate.gender)) {
        return res.status(400).json({ message: 'Giới tính không hợp lệ.' });
      }
    }

    if (req.body.address !== undefined) profileUpdate.address = toNullableString(req.body.address);
    if (req.body.dateOfBirth !== undefined) profileUpdate.dateOfBirth = toNullableDate(req.body.dateOfBirth);

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...userUpdate,
        profile: {
          upsert: {
            create: profileUpdate,
            update: profileUpdate,
          },
        },
      },
      include: { profile: true },
    });

    return res.json({
      message: 'Cập nhật hồ sơ thành công.',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Vui lòng chọn ảnh đại diện.' });
    }

    const avatarUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        profile: {
          upsert: {
            create: { avatarUrl },
            update: { avatarUrl },
          },
        },
      },
      include: { profile: true },
    });

    return res.json({
      avatarUrl,
      message: 'Tải ảnh đại diện thành công.',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.' });
    }

    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user || user.provider !== 'LOCAL' || !user.passwordHash) {
      return res.status(400).json({
        message: 'Tài khoản của bạn được liên kết với Google nên không cần đổi mật khẩu tại đây.',
      });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!passwordMatches) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng.' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);

    if (isSamePassword) {
      return res.status(400).json({ message: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return res.json({ message: 'Cập nhật mật khẩu thành công.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  changePassword,
  getProfile,
  updateProfile,
  uploadAvatar,
};
