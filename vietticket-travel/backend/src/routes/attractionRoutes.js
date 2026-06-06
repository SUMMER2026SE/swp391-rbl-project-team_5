const express = require('express');
const { createAttraction, submitAttraction, searchAttractions, getAttractionDetail } = require('../controllers/attractionController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router();

// Public
router.get('/', searchAttractions);
router.get('/:id', getAttractionDetail);

// Partner routes
router.post('/', protect, restrictTo('PARTNER'), createAttraction);
router.put('/:id/submit', protect, restrictTo('PARTNER'), submitAttraction);

module.exports = router;
