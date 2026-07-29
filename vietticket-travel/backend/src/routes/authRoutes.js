const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const {
  acceptCurrentPolicies,
  forgotPassword,
  getMe,
  googleLogin,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} = require('../controllers/authController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Nới lỏng khi chạy local/dev để tránh khóa đăng nhập khi thao tác/chụp màn hình.
  // Production giữ nguyên 5 lần/15 phút để chống dò mật khẩu.
  limit: process.env.NODE_ENV === 'production' ? 5 : 100,
  keyGenerator(req) {
    return `${ipKeyGenerator(req.ip)}:${req.path}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau 15 phút.',
  },
});

router.post('/register', authRateLimit, register);
router.post('/verify-email', authRateLimit, verifyEmail);
router.post('/resend-verification', authRateLimit, resendVerification);
router.post('/login', authRateLimit, login);
router.post('/google', authRateLimit, googleLogin);
router.post('/logout', protect, logout);
router.post('/forgot-password', authRateLimit, forgotPassword);
router.post('/reset-password', authRateLimit, resetPassword);
router.get('/me', protect, getMe);
router.post('/accept-policies', protect, acceptCurrentPolicies);

module.exports = router;
