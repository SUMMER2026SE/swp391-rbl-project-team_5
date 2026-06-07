const express = require('express');
const { changeUserStatus, getUsers, getPartners, reviewPartner, reviewAttraction, hideAttraction } = require('../controllers/adminController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/users', getUsers);
router.patch('/users/:id/status', changeUserStatus);
router.get('/partners', getPartners);
router.put('/partners/:id/review', reviewPartner);
router.put('/attractions/:id/review', reviewAttraction);
router.put('/attractions/:id/hide', hideAttraction);

module.exports = router;
