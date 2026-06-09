const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  createVNPayUrl,
  vnpayIpn,
  vnpayReturn,
} = require('../controllers/paymentController');

const router = express.Router();

// Khách tạo URL thanh toán
router.post('/create-vnpay-url', protect, restrictTo('CUSTOMER'), createVNPayUrl);

// VNPay gọi về (không auth)
router.get('/vnpay-ipn', vnpayIpn);
router.get('/vnpay-return', vnpayReturn);

module.exports = router;
