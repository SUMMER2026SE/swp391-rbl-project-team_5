const express = require('express');
const {
  changeUserStatus,
  getUsers,
  getPartners,
  getAttractions,
  reviewPartner,
  reviewAttraction,
  hideAttraction,
} = require('../controllers/adminController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const reviewController = require('../controllers/reviewController');

const router = express.Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/users', getUsers);
router.patch('/users/:id/status', changeUserStatus);
router.get('/partners', getPartners);
router.get('/attractions', getAttractions);
router.put('/partners/:id/review', reviewPartner);
router.put('/attractions/:id/review', reviewAttraction);
router.put('/attractions/:id/hide', hideAttraction);

// Kiểm duyệt Đánh giá
router.get('/reviews', reviewController.listAdminReviews);

module.exports = router;
