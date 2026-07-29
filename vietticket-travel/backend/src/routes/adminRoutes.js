const express = require('express');
const {
  changeUserStatus,
  createPlatformStaff,
  resendPlatformStaffInvite,
  getAuditLogs,
  getUsers,
  getPartners,
  getAttractions,
  reviewPartner,
  changePartnerOperationalStatus,
  reviewAttraction,
  hideAttraction,
  restoreAttraction,
  getAdminBookings,
  getDashboard,
  getFinancialReport,
  getFinancialTransactions,
  changePartnerCommissionRate,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listVouchers,
  createVoucher,
  updateVoucher,
} = require('../controllers/adminController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const reviewController = require('../controllers/reviewController');
const bankTransferController = require('../controllers/bankTransferController');
const settlementController = require('../controllers/settlementController');
const questionController = require('../controllers/questionController');
const kycChangeController = require('../controllers/kycChangeController');

const router = express.Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/users', getUsers);
router.post('/platform-staff', createPlatformStaff);
router.post('/platform-staff/:id/invite', resendPlatformStaffInvite);
router.get('/audit-logs', getAuditLogs);
router.get('/dashboard', getDashboard);
router.get('/financial-report', getFinancialReport);
router.get('/financial-transactions', getFinancialTransactions);
router.get('/settlements', settlementController.listSettlements);
router.post('/settlements', settlementController.createSettlement);
router.get('/settlements/:id', settlementController.getSettlement);
router.patch('/settlements/:id/status', settlementController.updateSettlementStatus);
router.get('/bookings', getAdminBookings);
router.get('/categories', listCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);
// Đối chiếu thanh toán chuyển khoản: xem hàng đợi và xác nhận đã nhận tiền.
router.get('/bank-transfers', bankTransferController.listBankTransferQueue);
router.post(
  '/bank-transfers/:bookingId/confirm',
  bankTransferController.confirmBankTransferPayment,
);

router.get('/vouchers', listVouchers);
router.post('/vouchers', createVoucher);
router.put('/vouchers/:id', updateVoucher);
router.patch('/users/:id/status', changeUserStatus);
router.get('/partners', getPartners);
router.get('/attractions', getAttractions);
router.put('/partners/:id/review', reviewPartner);
router.patch('/partners/:id/status', changePartnerOperationalStatus);
router.get('/kyc-change-requests', kycChangeController.listKycChangeRequests);
router.patch(
  '/kyc-change-requests/:id/review',
  kycChangeController.reviewKycChangeRequest,
);
router.patch('/partners/:id/commission', changePartnerCommissionRate);
router.put('/attractions/:id/review', reviewAttraction);
router.put('/attractions/:id/hide', hideAttraction);
router.put('/attractions/:id/restore', restoreAttraction);
router.patch('/questions/:questionId/moderate', questionController.moderateQuestion);

// Kiểm duyệt Đánh giá
router.get('/reviews', reviewController.listAdminReviews);

module.exports = router;
