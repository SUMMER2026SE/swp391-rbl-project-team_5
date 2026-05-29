const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const {
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
  limit: 5,
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
router.post('/google', googleLogin);
router.post('/logout', logout);
router.post('/forgot-password', authRateLimit, forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);

module.exports = router;
