const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { subscribe, unsubscribe } = require('../controllers/newsletterController');

const router = express.Router();
const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.path}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau 15 phút.',
  },
});

router.post('/subscribe', newsletterLimiter, subscribe);
router.post('/unsubscribe', newsletterLimiter, unsubscribe);

module.exports = router;
