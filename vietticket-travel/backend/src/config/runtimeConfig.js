function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function parseOriginList(value) {
  return String(value || '')
    .split(',')
    .map((origin) => normalizeUrl(origin))
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getFrontendUrl() {
  const configuredUrl = normalizeUrl(process.env.FRONTEND_URL);
  if (configuredUrl) return configuredUrl;

  if (isProduction()) {
    throw new Error('FRONTEND_URL is required in production.');
  }

  return 'http://localhost:5173';
}

function isWeakJwtSecret(value) {
  const secret = String(value || '').trim();
  return (
    secret.length < 32 ||
    secret === 'vietticket_secret_key' ||
    secret.includes('doi-thanh-mot-chuoi-bi-mat') ||
    secret.includes('replace-with-a-long-random-secret')
  );
}

function validateProductionEnv() {
  if (!isProduction()) return;

  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'FRONTEND_URL',
    'BACKEND_URL',
    'VNP_TMNCODE',
    'VNP_HASHSECRET',
    'VNP_URL',
    'VNP_RETURNURL',
    'VNP_IPNURL',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'MAIL_FROM',
  ];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(', ')}.`,
    );
  }

  if (isWeakJwtSecret(process.env.JWT_SECRET)) {
    throw new Error('JWT_SECRET must be a strong random secret in production.');
  }

  const localhostVars = ['FRONTEND_URL', 'BACKEND_URL', 'VNP_RETURNURL', 'VNP_IPNURL'];
  const localOnly = localhostVars.filter((name) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(process.env[name] || '')),
  );

  if (localOnly.length > 0) {
    throw new Error(
      `Production URLs must not point to localhost: ${localOnly.join(', ')}.`,
    );
  }
}

module.exports = {
  getFrontendUrl,
  isProduction,
  normalizeUrl,
  parseOriginList,
  unique,
  validateProductionEnv,
};
