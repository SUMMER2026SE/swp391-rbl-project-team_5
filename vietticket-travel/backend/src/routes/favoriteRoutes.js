const express = require('express');
const { listFavorites } = require('../controllers/favoriteController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', protect, listFavorites);

module.exports = router;
