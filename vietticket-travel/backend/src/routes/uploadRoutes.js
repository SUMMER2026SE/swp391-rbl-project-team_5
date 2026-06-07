const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { uploadAttractionImages } = require('../middleware/uploadMiddleware');

const router = express.Router();

// POST /api/upload/attraction-images
router.post('/attraction-images', protect, restrictTo('PARTNER', 'ADMIN'), uploadAttractionImages.array('images', 10), (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Vui lòng chọn ít nhất 1 ảnh' } });

    const base = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const urls = files.map((f) => `${base}/uploads/${f.filename}`);

    return res.status(200).json({ success: true, data: { urls } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
