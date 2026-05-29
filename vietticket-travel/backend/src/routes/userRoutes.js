const express = require('express');
const { changePassword, getProfile, updateProfile, uploadAvatar } = require('../controllers/userController');
const protect = require('../middleware/authMiddleware');
const { uploadAvatar: uploadAvatarMiddleware } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.post('/upload-avatar', protect, uploadAvatarMiddleware.single('avatar'), uploadAvatar);
router.put('/change-password', protect, changePassword);

module.exports = router;
