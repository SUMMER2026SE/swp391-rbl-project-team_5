const express = require('express');
const { registerPartner, getMyPartnerProfile } = require('../controllers/partnerController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();

// POST /api/partners/  -> register partner (authenticated users)
router.post('/', protect, registerPartner);

// GET /api/partners/profile -> get current user's partner profile
router.get('/profile', protect, getMyPartnerProfile);

module.exports = router;
