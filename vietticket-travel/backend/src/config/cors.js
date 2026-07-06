const {
  isProduction,
  normalizeUrl,
  parseOriginList,
  unique,
} = require('./runtimeConfig');

const configuredOrigins = unique([
  ...parseOriginList(process.env.FRONTEND_URL),
  ...parseOriginList(process.env.CORS_ALLOWED_ORIGINS),
]);

const developmentOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
];

const allowedOrigins = isProduction()
  ? configuredOrigins
  : unique([...configuredOrigins, ...developmentOrigins]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalizedOrigin = normalizeUrl(origin);
  if (allowedOrigins.includes(normalizedOrigin)) return true;

  if (!isProduction()) {
    return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(normalizedOrigin);
  }

  return false;
}

function originCallback(origin, callback) {
  if (isAllowedOrigin(origin)) {
    return callback(null, true);
  }

  return callback(new Error('CORS origin is not allowed.'));
}

const corsOptions = {
  origin: originCallback,
  credentials: true,
};

module.exports = {
  corsOptions,
  isAllowedOrigin,
};
