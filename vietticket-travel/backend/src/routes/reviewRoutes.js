'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requirePartner, requireApprovedPartner } = require('../middleware/partnerMiddleware');
const reviewController = require('../controllers/reviewController');

const router = express.Router();

// Public routes
router.get('/', reviewController.listPublicReviews);

// Protected customer routes
router.post('/', protect, restrictTo('CUSTOMER'), reviewController.createReview);

// Partner routes — chỉ đối tác ĐÃ ĐƯỢC DUYỆT mới được phản hồi đánh giá.
router.post(
  '/:reviewId/reply',
  protect,
  restrictTo('PARTNER'),
  requirePartner,
  requireApprovedPartner,
  reviewController.replyReview,
);

// Admin/Staff moderation routes
router.patch('/:reviewId/moderate', protect, restrictTo('ADMIN', 'STAFF'), reviewController.moderateReview);

module.exports = router;
