'use strict';

// ============================================================
// loyaltyRoutes.js — Mount tại /api/loyalty
// Ví điểm thưởng của khách hàng: xem số dư, sao kê, đổi điểm lấy voucher.
// ============================================================

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  getMySummary,
  getMyTransactions,
  getRedemptionCatalog,
  postRedeem,
  getMyVouchers,
} = require('../controllers/loyaltyController');

const router = express.Router();

// Giới hạn riêng cho đổi điểm để chống spam đổi/quét mã.
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Bạn thao tác đổi điểm quá nhanh. Vui lòng thử lại sau ít phút.' },
});

router.use(protect, restrictTo('CUSTOMER'));

router.get('/me', getMySummary);
router.get('/transactions', getMyTransactions);
router.get('/catalog', getRedemptionCatalog);
router.get('/vouchers', getMyVouchers);
router.post('/redeem', redeemLimiter, postRedeem);

module.exports = router;
