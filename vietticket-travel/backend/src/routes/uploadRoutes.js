const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const { isPlatformStaff, restrictTo } = require('../middleware/roleMiddleware');
const {
  requireApprovedPartnerOrAdmin,
  requireKycDocumentUploader,
} = require('../middleware/partnerMiddleware');
const {
  uploadAttractionImages,
  uploadDocument,
  buildDocumentUrl,
  enforceDocumentUploadQuota,
  enforcePublicUploadQuota,
  getPrivateDocumentPath,
  validateUploadedFiles,
} = require('../middleware/uploadMiddleware');

const router = express.Router();
const attractionImageUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'UPLOAD_RATE_LIMITED',
      message: 'Bạn đã tải ảnh quá thường xuyên. Vui lòng thử lại sau.',
    },
  },
});
const documentUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'UPLOAD_RATE_LIMITED',
      message: 'Bạn đã tải tài liệu quá thường xuyên. Vui lòng thử lại sau.',
    },
  },
});

// POST /api/upload/attraction-images
router.post(
  '/attraction-images',
  protect,
  restrictTo('PARTNER', 'ADMIN'),
  requireApprovedPartnerOrAdmin,
  attractionImageUploadLimiter,
  enforcePublicUploadQuota,
  uploadAttractionImages.array('images', 10),
  validateUploadedFiles,
  (req, res, next) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Vui lòng chọn ít nhất 1 ảnh' },
        });
      }

      const base = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      const urls = files.map((file) => `${base}/uploads/${file.filename}`);
      return res.status(200).json({ success: true, data: { urls } });
    } catch (error) {
      return next(error);
    }
  },
);

// POST /api/upload/document
router.post(
  '/document',
  protect,
  requireKycDocumentUploader,
  documentUploadLimiter,
  enforceDocumentUploadQuota,
  uploadDocument.single('document'),
  validateUploadedFiles,
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Vui lòng chọn một tài liệu.' },
      });
    }

    return res.status(200).json({
      success: true,
      data: { url: buildDocumentUrl(req, req.file.filename) },
    });
  },
);

router.get('/documents/:filename', protect, (req, res) => {
  const filename = String(req.params.filename || '');
  const canRead =
    isPlatformStaff(req.user)
    || filename.startsWith(`${req.user.id}-`);
  const documentPath = canRead ? getPrivateDocumentPath(filename) : null;

  if (!documentPath) {
    return res.status(404).json({ message: 'Không tìm thấy tài liệu.' });
  }

  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  return res.sendFile(documentPath, (error) => {
    if (error && !res.headersSent) {
      res.status(error.statusCode || 404).json({ message: 'Không tìm thấy tài liệu.' });
    }
  });
});

module.exports = router;
