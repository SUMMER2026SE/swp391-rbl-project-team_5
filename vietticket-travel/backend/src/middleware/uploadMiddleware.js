'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const publicUploadDir = path.join(__dirname, '../../public/uploads');
const privateDocumentDir = path.join(__dirname, '../../private/documents');

fs.mkdirSync(publicUploadDir, { recursive: true });
fs.mkdirSync(privateDocumentDir, { recursive: true });

const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

function createStorage(destination) {
  return multer.diskStorage({
    destination(req, file, callback) {
      callback(null, destination);
    },
    filename(req, file, callback) {
      const extension = EXTENSION_BY_MIME[file.mimetype];
      const safeName =
        `${req.user.id}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
      callback(null, safeName);
    },
  });
}

function allowMimeTypes(allowed, message) {
  return (req, file, callback) => {
    if (!allowed.includes(file.mimetype)) {
      const error = new Error(message);
      error.statusCode = 400;
      return callback(error);
    }
    return callback(null, true);
  };
}

const uploadAvatar = multer({
  storage: createStorage(publicUploadDir),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: allowMimeTypes(
    ['image/jpeg', 'image/png'],
    'Chỉ hỗ trợ ảnh JPEG hoặc PNG.',
  ),
});

const uploadAttractionImages = multer({
  storage: createStorage(publicUploadDir),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: allowMimeTypes(
    ['image/jpeg', 'image/png', 'image/webp'],
    'Chỉ hỗ trợ ảnh JPEG, PNG hoặc WEBP.',
  ),
});

const uploadDocument = multer({
  storage: createStorage(privateDocumentDir),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: allowMimeTypes(
    ['image/jpeg', 'image/png', 'application/pdf'],
    'Chỉ hỗ trợ ảnh JPEG, PNG hoặc file PDF.',
  ),
});

function hasExpectedSignature(buffer, mimetype) {
  if (mimetype === 'image/jpeg') {
    return buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
  }
  if (mimetype === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimetype === 'application/pdf') {
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

async function removeFiles(files) {
  await Promise.all(
    files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)),
  );
}

function validateUploadedFiles(req, res, next) {
  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) return next();

  Promise.all(
    files.map(async (file) => {
      const handle = await fs.promises.open(file.path, 'r');
      try {
        const buffer = Buffer.alloc(16);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (!hasExpectedSignature(buffer.subarray(0, bytesRead), file.mimetype)) {
          const error = new Error('Nội dung file không đúng với định dạng đã khai báo.');
          error.statusCode = 400;
          throw error;
        }
      } finally {
        await handle.close();
      }
    }),
  )
    .then(() => next())
    .catch(async (error) => {
      await removeFiles(files);
      next(error);
    });
}

function buildUploadUrl(req, filename) {
  const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${filename}`;
}

function buildDocumentUrl(req, filename) {
  const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/api/upload/documents/${filename}`;
}

function getPrivateDocumentPath(filename) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName || safeName !== filename) return null;
  const resolved = path.resolve(privateDocumentDir, safeName);
  if (!resolved.startsWith(`${path.resolve(privateDocumentDir)}${path.sep}`)) return null;
  return resolved;
}

function getTrustedDocumentOrigin(req) {
  const configuredBaseUrl = String(process.env.BACKEND_URL || '').trim();
  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl).origin;
    } catch {
      return '';
    }
  }

  const host = req?.get?.('host');
  const protocol = req?.protocol;
  if (!host || !protocol) return '';

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return '';
  }
}

function getDocumentFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.search || parsed.hash || parsed.username || parsed.password) return '';
    const prefix = '/api/upload/documents/';
    if (!parsed.pathname.startsWith(prefix)) return '';
    const filename = parsed.pathname.slice(prefix.length);
    if (!filename || filename.includes('/') || path.basename(filename) !== filename) return '';
    return filename;
  } catch {
    return '';
  }
}

function isDocumentOwnedByUser(url, userId, req) {
  const trustedOrigin = getTrustedDocumentOrigin(req);
  if (!trustedOrigin) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== trustedOrigin) return false;

  const filename = getDocumentFilenameFromUrl(url);
  if (!filename.startsWith(`${userId}-`)) return false;

  const documentPath = getPrivateDocumentPath(filename);
  if (!documentPath) return false;
  try {
    return fs.statSync(documentPath).isFile();
  } catch {
    return false;
  }
}

function createUserUploadQuota(directory, { maxFiles, maxBytes }) {
  return async (req, res, next) => {
    try {
      const prefix = `${req.user.id}-`;
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      const ownedFiles = entries.filter(
        (entry) => entry.isFile() && entry.name.startsWith(prefix),
      );
      const stats = await Promise.all(
        ownedFiles.map((entry) => fs.promises.stat(path.join(directory, entry.name))),
      );
      const totalBytes = stats.reduce((sum, stat) => sum + stat.size, 0);

      if (ownedFiles.length >= maxFiles || totalBytes >= maxBytes) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'UPLOAD_QUOTA_EXCEEDED',
            message: 'Bạn đã đạt giới hạn lưu trữ tệp. Vui lòng dùng lại hoặc xóa tệp cũ.',
          },
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function removeUnreferencedDocumentsForUser(userId, retainedUrls = []) {
  const retainedNames = new Set(
    retainedUrls.map(getDocumentFilenameFromUrl).filter(Boolean),
  );
  const entries = await fs.promises.readdir(privateDocumentDir, { withFileTypes: true });
  const prefix = `${userId}-`;
  const orphanPaths = entries
    .filter(
      (entry) => entry.isFile()
        && entry.name.startsWith(prefix)
        && !retainedNames.has(entry.name),
    )
    .map((entry) => path.join(privateDocumentDir, entry.name));

  await Promise.all(orphanPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined)));
}

const enforcePublicUploadQuota = createUserUploadQuota(publicUploadDir, {
  maxFiles: 500,
  maxBytes: 1024 * 1024 * 1024,
});
const enforceDocumentUploadQuota = createUserUploadQuota(privateDocumentDir, {
  maxFiles: 5,
  maxBytes: 25 * 1024 * 1024,
});

module.exports = {
  uploadAvatar,
  uploadAttractionImages,
  uploadDocument,
  validateUploadedFiles,
  buildUploadUrl,
  buildDocumentUrl,
  getPrivateDocumentPath,
  getTrustedDocumentOrigin,
  getDocumentFilenameFromUrl,
  isDocumentOwnedByUser,
  enforcePublicUploadQuota,
  enforceDocumentUploadQuota,
  removeUnreferencedDocumentsForUser,
};
