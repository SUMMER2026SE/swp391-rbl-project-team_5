const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  uploadAttractionImages,
  uploadDocument,
  buildDocumentUrl,
  getPrivateDocumentPath,
  validateUploadedFiles,
} = require('../middleware/uploadMiddleware');

const router = express.Router();

// POST /api/upload/attraction-images
router.post('/attraction-images', protect, restrictTo('PARTNER', 'ADMIN'), uploadAttractionImages.array('images', 10), validateUploadedFiles, (req, res, next) => {
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

// POST /api/upload/document
router.post('/document', protect, uploadDocument.single('document'), validateUploadedFiles, (req, res) => {
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
});

router.get('/documents/:filename', protect, (req, res) => {
  const filename = String(req.params.filename || '');
  const canRead =
    ['ADMIN', 'STAFF'].includes(req.user.role)
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
