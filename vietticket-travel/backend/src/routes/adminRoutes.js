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
const settlementController = require('../controllers/settlementController');

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
router.get('/vouchers', listVouchers);
router.post('/vouchers', createVoucher);
router.put('/vouchers/:id', updateVoucher);
router.patch('/users/:id/status', changeUserStatus);
router.get('/partners', getPartners);
router.get('/attractions', getAttractions);
router.put('/partners/:id/review', reviewPartner);
router.patch('/partners/:id/status', changePartnerOperationalStatus);
router.patch('/partners/:id/commission', changePartnerCommissionRate);
router.put('/attractions/:id/review', reviewAttraction);
router.put('/attractions/:id/hide', hideAttraction);
router.put('/attractions/:id/restore', restoreAttraction);

// Kiểm duyệt Đánh giá
router.get('/reviews', reviewController.listAdminReviews);

module.exports = router;
