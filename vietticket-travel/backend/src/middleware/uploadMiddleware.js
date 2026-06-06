const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(__dirname, '../../public/uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, uploadDir);
  },
  filename(req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${req.user.id}-${Date.now()}${extension}`;
    callback(null, safeName);
  },
});

const uploadAvatar = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      const error = new Error('Chỉ hỗ trợ ảnh JPEG hoặc PNG.');
      error.statusCode = 400;
      return callback(error);
    }

    return callback(null, true);
  },
});

// Upload ảnh địa điểm (Partner)
const uploadAttractionImages = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.');
      error.statusCode = 400;
      return callback(error);
    }

    return callback(null, true);
  },
});

module.exports = {
  uploadAvatar,
  uploadAttractionImages,
};
