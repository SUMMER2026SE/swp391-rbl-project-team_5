const multer = require('multer');

function notFound(req, res, next) {
  const error = new Error(`Không tìm thấy đường dẫn ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, req, res, next) {
  void next;

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Ảnh đại diện không được vượt quá 2MB.'
        : 'Không thể tải ảnh lên. Vui lòng thử lại.';

    return res.status(400).json({ message });
  }

  const statusCode = error.statusCode || 500;

  return res.status(statusCode).json({
    message: error.message || 'Máy chủ đang gặp lỗi. Vui lòng thử lại sau.',
  });
}

module.exports = {
  notFound,
  errorHandler,
};
