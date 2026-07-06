const multer = require('multer');

function isServerError(statusCode) {
  return Number(statusCode) >= 500;
}

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
  if (isServerError(statusCode)) {
    console.error('[error]', error);
  }

  return res.status(statusCode).json({
    message: isServerError(statusCode)
      ? 'Máy chủ đang gặp lỗi. Vui lòng thử lại sau.'
      : error.message || 'Máy chủ đang gặp lỗi. Vui lòng thử lại sau.',
  });
}

module.exports = {
  notFound,
  errorHandler,
};
