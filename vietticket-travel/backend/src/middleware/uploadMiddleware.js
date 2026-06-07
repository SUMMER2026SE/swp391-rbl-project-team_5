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
    const safeName = `${req.user.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${extension}`;
    callback(null, safeName);
  },
});

// Bộ lọc chỉ cho phép ảnh
function imageFileFilter(req, file, callback) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    const error = new Error('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WEBP.');
    error.statusCode = 400;
    return callback(error);
  }

  return callback(null, true);
}

// Bộ lọc cho tài liệu KYC (ảnh hoặc PDF)
function documentFileFilter(req, file, callback) {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) {
    const error = new Error('Chỉ hỗ trợ ảnh JPEG, PNG hoặc file PDF.');
    error.statusCode = 400;
    return callback(error);
  }

  return callback(null, true);
}

// Ảnh đại diện người dùng (2MB) — giữ nguyên cho userController
const uploadAvatar = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      const error = new Error('Chỉ hỗ trợ ảnh JPEG hoặc PNG.');
      error.statusCode = 400;
      return callback(error);
    }

    return callback(null, true);
  },
});

// Ảnh điểm tham quan — tối đa 10 ảnh, mỗi ảnh 5MB
const uploadAttractionImages = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

// Tài liệu KYC (giấy phép kinh doanh) — 1 file, 5MB
const uploadDocument = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: documentFileFilter,
});

// Tạo URL tuyệt đối cho file đã upload
function buildUploadUrl(req, filename) {
  const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${filename}`;
}

module.exports = {
  uploadAvatar,
  uploadAttractionImages,
  uploadDocument,
  buildUploadUrl,
};
