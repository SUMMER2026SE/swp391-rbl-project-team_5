const express = require('express');
const { createAttraction, submitAttraction, searchAttractions, getAttractionDetail } = require('../controllers/attractionController');
const { toggleFavorite } = require('../controllers/favoriteController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requirePartner, requireApprovedPartner } = require('../middleware/partnerMiddleware');

const router = express.Router();

// Public
router.get('/', searchAttractions);
router.get('/:id', getAttractionDetail);
router.post('/:id/favorite', protect, toggleFavorite);

// Partner routes
router.post(
  '/',
  protect,
  restrictTo('PARTNER'),
  requirePartner,
  requireApprovedPartner,
  createAttraction,
);
router.put(
  '/:id/submit',
  protect,
  restrictTo('PARTNER'),
  requirePartner,
  requireApprovedPartner,
  submitAttraction,
);

module.exports = router;
