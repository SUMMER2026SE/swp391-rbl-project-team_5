const express = require('express');
const {
  changeUserStatus,
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
} = require('../controllers/adminController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const reviewController = require('../controllers/reviewController');

const router = express.Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/users', getUsers);
router.get('/dashboard', getDashboard);
router.get('/financial-report', getFinancialReport);
router.get('/financial-transactions', getFinancialTransactions);
router.get('/bookings', getAdminBookings);
router.get('/categories', listCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);
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
