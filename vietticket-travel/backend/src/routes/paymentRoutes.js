const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  createVNPayUrl,
  vnpayIpn,
  vnpayReturn,
  createRefundRequest,
  getRefundPreview,
} = require('../controllers/paymentController');

const router = express.Router();

// Khách tạo URL thanh toán
router.post('/create-vnpay-url', protect, restrictTo('CUSTOMER'), createVNPayUrl);

// Khách xem trước số tiền hoàn + gửi yêu cầu hoàn tiền (modal "Yêu cầu hoàn tiền")
router.get('/refund-preview/:bookingId', protect, restrictTo('CUSTOMER'), getRefundPreview);
router.post('/refund-request', protect, restrictTo('CUSTOMER'), createRefundRequest);

// VNPay gọi về (không auth)
router.get('/vnpay-ipn', vnpayIpn);
router.get('/vnpay-return', vnpayReturn);

module.exports = router;
