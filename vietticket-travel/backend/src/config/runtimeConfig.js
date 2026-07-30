const { parseExchangeRates } = require('../utils/payoutCurrency');

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

function getTrustProxySetting(value = process.env.TRUST_PROXY) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(false|off|no|0)$/i.test(raw)) return false;
  // Express boolean `true` trusts every proxy. Preserve the old env value but
  // map it to exactly one trusted hop instead.
  if (/^(true|on|yes)$/i.test(raw)) return 1;
  if (/^[1-9]\d{0,2}$/u.test(raw)) return Number(raw);

  const trustedNames = new Set(['loopback', 'linklocal', 'uniquelocal']);
  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (
    entries.length > 0
    && entries.every((entry) => trustedNames.has(entry.toLowerCase())
      || /^[a-f0-9:.]+(?:\/\d{1,3})?$/iu.test(entry))
  ) {
    return entries;
  }

  throw new Error(
    'TRUST_PROXY must be false, true/number of trusted hops, or a comma-separated trusted IP/subnet list.',
  );
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
    'VNP_API',
    'VNP_RETURNURL',
    'VNP_IPNURL',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'MAIL_FROM',
    'ML_SERVICE_URL',
    'ML_SERVICE_API_KEY',
    'TRUST_PROXY',
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

  if (String(process.env.ML_SERVICE_API_KEY || '').trim().length < 32) {
    throw new Error('ML_SERVICE_API_KEY must be at least 32 characters in production.');
  }

  const sepayWebhook = getSepayWebhookConfig();
  if (sepayWebhook.enabled) {
    if (sepayWebhook.secret.length < 32) {
      throw new Error(
        'SEPAY_WEBHOOK_SECRET must be at least 32 characters when SePay automation is enabled.',
      );
    }
    if (!getBankTransferConfig().configured) {
      throw new Error(
        'BANK_BIN, BANK_ACCOUNT_NUMBER, and BANK_ACCOUNT_NAME are required when SePay automation is enabled.',
      );
    }
  }

  getTrustProxySetting();
  parseExchangeRates();

  const localhostVars = [
    'FRONTEND_URL',
    'BACKEND_URL',
    'VNP_RETURNURL',
    'VNP_IPNURL',
    'ML_SERVICE_URL',
  ];
  const localOnly = localhostVars.filter((name) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(process.env[name] || '')),
  );

  if (localOnly.length > 0) {
    throw new Error(
      `Production URLs must not point to localhost: ${localOnly.join(', ')}.`,
    );
  }
}

// --- Tài khoản ngân hàng nhận tiền của nền tảng (thanh toán chuyển khoản) ---
// Đặt trong .env, KHÔNG commit vào mã nguồn. Nếu chưa cấu hình đủ,
// phương thức chuyển khoản sẽ tự động bị ẩn khỏi trang thanh toán.
function getBankTransferConfig() {
  const bankBin = String(process.env.BANK_BIN || '').trim();
  const accountNumber = String(process.env.BANK_ACCOUNT_NUMBER || '').trim();
  const accountName = String(process.env.BANK_ACCOUNT_NAME || '').trim().toUpperCase();
  const bankName = String(process.env.BANK_NAME || '').trim();

  const configured =
    /^\d{6}$/u.test(bankBin)
    && /^\d{6,19}$/u.test(accountNumber)
    && accountName.length > 0;

  return { bankBin, accountNumber, accountName, bankName, configured };
}

function getSepayWebhookConfig() {
  const enabled = String(process.env.SEPAY_WEBHOOK_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
  const secret = String(process.env.SEPAY_WEBHOOK_SECRET || '').trim();
  const rawTolerance = Number(process.env.SEPAY_WEBHOOK_TOLERANCE_SECONDS);
  const toleranceSeconds = Number.isFinite(rawTolerance)
    ? Math.min(Math.max(Math.round(rawTolerance), 60), 900)
    : 300;

  return { enabled, secret, toleranceSeconds };
}

module.exports = {
  getBankTransferConfig,
  getFrontendUrl,
  getSepayWebhookConfig,
  getTrustProxySetting,
  isProduction,
  normalizeUrl,
  parseOriginList,
  unique,
  validateProductionEnv,
};
