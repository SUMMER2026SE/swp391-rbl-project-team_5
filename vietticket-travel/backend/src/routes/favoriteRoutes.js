const express = require('express');
const { listFavorites } = require('../controllers/favoriteController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/', protect, restrictTo('CUSTOMER'), listFavorites);

module.exports = router;
