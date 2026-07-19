const crypto = require('crypto');

const DEFAULT_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

function getSecret() {
  const secret = String(
    process.env.NEWSLETTER_TOKEN_SECRET || process.env.JWT_SECRET || '',
  );
  if (secret.length < 32) {
    throw new Error('Newsletter token secret must contain at least 32 characters.');
  }
  return secret;
}

function sign(encodedPayload) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createNewsletterUnsubscribeToken(
  email,
  { now = Date.now(), ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS } = {},
) {
  const payload = Buffer.from(
    JSON.stringify({
      email: normalizeEmail(email),
      exp: Math.floor(now / 1000) + ttlSeconds,
      purpose: 'newsletter-unsubscribe',
    }),
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function verifyNewsletterUnsubscribeToken(token, { now = Date.now() } = {}) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const email = normalizeEmail(decoded.email);
    if (
      decoded.purpose !== 'newsletter-unsubscribe'
      || !email
      || !Number.isFinite(decoded.exp)
      || decoded.exp < Math.floor(now / 1000)
    ) {
      return null;
    }
    return { email, expiresAt: new Date(decoded.exp * 1000) };
  } catch {
    return null;
  }
}

module.exports = {
  createNewsletterUnsubscribeToken,
  verifyNewsletterUnsubscribeToken,
};
