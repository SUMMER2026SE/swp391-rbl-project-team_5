const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requireCurrentPolicyConsent } = require('../middleware/policyConsentMiddleware');
const {
  createVNPayUrl,
  vnpayIpn,
  vnpayReturn,
  createRefundRequest,
  getRefundPreview,
} = require('../controllers/paymentController');

const {
  getBankTransferInstruction,
  listPaymentMethods,
} = require('../controllers/bankTransferController');
const { sepayWebhook } = require('../controllers/sepayWebhookController');

const router = express.Router();

// SePay server-to-server callback (không dùng phiên đăng nhập của khách).
// Chữ ký HMAC-SHA256 trên raw body được kiểm tra trong controller.
router.post('/sepay/webhook', sepayWebhook);

// Danh sách phương thức thanh toán đang mở (VNPay luôn có; chuyển khoản chỉ
// xuất hiện khi nền tảng đã cấu hình tài khoản nhận tiền).
router.get('/methods', protect, restrictTo('CUSTOMER'), listPaymentMethods);

// Mã VietQR + hướng dẫn chuyển khoản cho một đơn (chỉ chủ đơn xem được).
router.get(
  '/bank-transfer/:bookingId',
  protect,
  restrictTo('CUSTOMER'),
  getBankTransferInstruction,
);

// Khách tạo URL thanh toán
router.post(
  '/create-vnpay-url',
  protect,
  restrictTo('CUSTOMER'),
  requireCurrentPolicyConsent,
  createVNPayUrl,
);

// Khách xem trước số tiền hoàn + gửi yêu cầu hoàn tiền (modal "Yêu cầu hoàn tiền")
router.get('/refund-preview/:bookingId', protect, restrictTo('CUSTOMER'), getRefundPreview);
router.post(
  '/refund-request',
  protect,
  restrictTo('CUSTOMER'),
  requireCurrentPolicyConsent,
  createRefundRequest,
);

// VNPay gọi về (không auth)
router.get('/vnpay-ipn', vnpayIpn);
router.get('/vnpay-return', vnpayReturn);

module.exports = router;
