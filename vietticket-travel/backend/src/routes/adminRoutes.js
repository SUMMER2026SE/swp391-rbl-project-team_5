const express = require('express');
const { changeUserStatus, getUsers } = require('../controllers/adminController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect, restrictTo('ADMIN'));

router.get('/users', getUsers);
router.patch('/users/:id/status', changeUserStatus);

module.exports = router;
