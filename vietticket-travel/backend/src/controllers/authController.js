const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookie');
const { createAuthSession } = require('../utils/authSession');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/mailer');
const {
  addMinutes,
  createRandomToken,
  hashToken,
  isExpired,
} = require('../utils/tokenUtils');
const {
  isValidAvatarUrl,
  isValidEmail,
  isValidPhoneNumber,
  validateFullName,
  validatePassword,
} = require('../utils/validators');
const { getEffectiveRoles } = require('../utils/userRoles');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY_MINUTES = 30;
const SAFE_FORGOT_PASSWORD_MESSAGE =
  'Nếu email tồn tại trên hệ thống, mã đặt lại mật khẩu đã được tạo.';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    roles: getEffectiveRoles(user),
    employerPartnerId: user.employerPartnerId || null,
    provider: user.provider,
    isEmailVerified: user.isEmailVerified,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profile: user.profile || null,
  };
}

async function findUserForResponse(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, roleMemberships: true },
  });
}

async function issueAuthSession(req, res, user) {
  const { token } = await createAuthSession(req, user);
  setAuthCookie(res, token);
}

async function createVerificationToken(tx, userId) {
  await tx.emailVerificationToken.deleteMany({ where: { userId } });

  const verificationToken = createRandomToken();

  await tx.emailVerificationToken.create({
    data: {
      userId,
      token: hashToken(verificationToken),
      expiresAt: addMinutes(TOKEN_EXPIRY_MINUTES),
    },
  });

  return verificationToken;
}

async function register(req, res, next) {
  try {
    const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const phoneNumber = req.body.phoneNumber ? String(req.body.phoneNumber).trim() : null;

    const fullNameError = validateFullName(fullName);

    if (fullNameError) {
      return res.status(400).json({ message: fullNameError });
    }

    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }

    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return res.status(409).json({ message: 'Email này đã được sử dụng.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    let verificationToken = '';

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          fullName,
          email,
          passwordHash,
          provider: 'LOCAL',
          isEmailVerified: false,
          profile: {
            create: {
              phoneNumber,
            },
          },
          roleMemberships: { create: { role: 'CUSTOMER' } },
        },
        include: { profile: true, roleMemberships: true },
      });

      verificationToken = await createVerificationToken(tx, createdUser.id);

      return createdUser;
    });

    await sendVerificationEmail({ to: email, token: verificationToken });

    return res.status(201).json({
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác minh tài khoản.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
}

async function resendVerification(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ message: 'Vui lòng nhập email.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.json({
        message: 'Nếu email tồn tại và chưa được xác minh, link kích hoạt mới đã được tạo.',
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email này đã được xác minh.' });
    }

    const verificationToken = await prisma.$transaction((tx) =>
      createVerificationToken(tx, user.id),
    );

    await sendVerificationEmail({ to: email, token: verificationToken });

    return res.json({
      message: 'Link xác minh mới đã được gửi. Vui lòng kiểm tra email của bạn.',
    });
  } catch (error) {
    next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const token = String(req.body.token || '').trim();

    if (!token) {
      return res.status(400).json({ message: 'Vui lòng nhập mã xác minh email.' });
    }

    const verificationToken = await prisma.emailVerificationToken.findUnique({
      where: { token: hashToken(token) },
      include: { user: true },
    });

    if (!verificationToken) {
      return res.status(400).json({ message: 'Mã xác minh không hợp lệ hoặc đã được sử dụng.' });
    }

    if (isExpired(verificationToken.expiresAt)) {
      await prisma.emailVerificationToken.delete({ where: { id: verificationToken.id } });
      return res.status(400).json({
        message: 'Mã xác minh đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.',
      });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: verificationToken.userId },
        data: { isEmailVerified: true },
        include: { profile: true, roleMemberships: true },
      });

      await tx.emailVerificationToken.deleteMany({
        where: { userId: verificationToken.userId },
      });

      return user;
    });

    return res.json({
      message: 'Xác minh email thành công. Bạn có thể đăng nhập ngay bây giờ.',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true, roleMemberships: true },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'Tài khoản của bạn đang bị khóa.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: 'Vui lòng xác minh email trước khi đăng nhập.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    await issueAuthSession(req, res, user);

    return res.json({
      message: 'Đăng nhập thành công.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
}

async function verifyGoogleCredential(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error('GOOGLE_CLIENT_ID chưa được cấu hình.');
    error.statusCode = 500;
    throw error;
  }

  try {
    const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || payload.email_verified === false) {
      const error = new Error('Google token không chứa email đã xác minh hợp lệ.');
      error.statusCode = 401;
      throw error;
    }

    return {
      email: normalizeEmail(payload.email),
      fullName: payload.name || payload.email.split('@')[0],
      avatarUrl: payload.picture || null,
      providerAccountId: payload.sub,
    };
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 401;
      error.message = 'Google credential không hợp lệ hoặc đã hết hạn.';
    }

    throw error;
  }
}

async function googleLogin(req, res, next) {
  try {
    const credential = String(req.body.credential || '').trim();
    if (!credential) {
      return res.status(400).json({ message: 'Thiếu Google credential hợp lệ.' });
    }
    const googlePayload = await verifyGoogleCredential(credential);

    if (!isValidEmail(googlePayload.email)) {
      return res.status(400).json({ message: 'Email Google không hợp lệ.' });
    }

    if (!isValidAvatarUrl(googlePayload.avatarUrl)) {
      return res.status(400).json({ message: 'Ảnh đại diện Google phải là URL hợp lệ.' });
    }

    let user = await prisma.user.findUnique({
      where: { email: googlePayload.email },
      include: { profile: true, roleMemberships: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: googlePayload.email,
          fullName: googlePayload.fullName,
          provider: 'GOOGLE',
          isEmailVerified: true,
          passwordHash: null,
          profile: {
            create: {
              avatarUrl: googlePayload.avatarUrl,
            },
          },
          oauthAccounts: {
            create: {
              provider: 'GOOGLE',
              providerAccountId: googlePayload.providerAccountId,
            },
          },
          roleMemberships: { create: { role: 'CUSTOMER' } },
        },
        include: { profile: true, roleMemberships: true },
      });
    } else {
      if (user.status !== 'ACTIVE') {
        return res.status(403).json({ message: 'Tài khoản của bạn đang bị khóa.' });
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          isEmailVerified: true,
          provider: user.provider === 'LOCAL' ? user.provider : 'GOOGLE',
          profile: {
            upsert: {
              create: { avatarUrl: googlePayload.avatarUrl },
              update: googlePayload.avatarUrl ? { avatarUrl: googlePayload.avatarUrl } : {},
            },
          },
        },
        include: { profile: true, roleMemberships: true },
      });

      await prisma.oAuthAccount.upsert({
        where: {
          provider_providerAccountId: {
            provider: 'GOOGLE',
            providerAccountId: googlePayload.providerAccountId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          provider: 'GOOGLE',
          providerAccountId: googlePayload.providerAccountId,
        },
      });
    }

    await issueAuthSession(req, res, user);

    return res.json({
      message: 'Đăng nhập Google thành công.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ message: 'Vui lòng nhập email.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.provider === 'LOCAL') {
      const resetToken = createRandomToken();

      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });

        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            token: hashToken(resetToken),
            expiresAt: addMinutes(TOKEN_EXPIRY_MINUTES),
          },
        });
      });

      await sendPasswordResetEmail({ to: email, token: resetToken });
    }

    return res.json({ message: SAFE_FORGOT_PASSWORD_MESSAGE });
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.newPassword || '');

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Vui lòng nhập mã đặt lại và mật khẩu mới.' });
    }

    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: hashToken(token) },
    });

    if (!resetToken) {
      return res.status(400).json({ message: 'Mã đặt lại mật khẩu không hợp lệ.' });
    }

    if (isExpired(resetToken.expiresAt)) {
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
      return res.status(400).json({ message: 'Mã đặt lại mật khẩu đã hết hạn.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      });

      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId },
      });
      await tx.authSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return res.json({ message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' });
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await findUserForResponse(req.user.id);

    return res.json({
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    if (req.authSession?.id) {
      await prisma.authSession.updateMany({
        where: { id: req.authSession.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    clearAuthCookie(res);
    return res.json({ message: 'Đăng xuất thành công.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  forgotPassword,
  getMe,
  googleLogin,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  sanitizeUser,
  verifyEmail,
};
