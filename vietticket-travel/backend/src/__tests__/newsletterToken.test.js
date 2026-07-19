const {
  createNewsletterUnsubscribeToken,
  verifyNewsletterUnsubscribeToken,
} = require('../utils/newsletterToken');

describe('newsletter unsubscribe tokens', () => {
  const originalSecret = process.env.NEWSLETTER_TOKEN_SECRET;

  beforeEach(() => {
    process.env.NEWSLETTER_TOKEN_SECRET = 'newsletter-test-secret-that-is-long-enough';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.NEWSLETTER_TOKEN_SECRET;
    else process.env.NEWSLETTER_TOKEN_SECRET = originalSecret;
  });

  it('round-trips a normalized email', () => {
    const now = Date.UTC(2026, 6, 17);
    const token = createNewsletterUnsubscribeToken(' Guest@Example.com ', { now });

    expect(verifyNewsletterUnsubscribeToken(token, { now })).toMatchObject({
      email: 'guest@example.com',
    });
  });

  it('rejects tampered and expired tokens', () => {
    const now = Date.UTC(2026, 6, 17);
    const token = createNewsletterUnsubscribeToken('guest@example.com', {
      now,
      ttlSeconds: 60,
    });

    expect(verifyNewsletterUnsubscribeToken(`${token}x`, { now })).toBeNull();
    expect(verifyNewsletterUnsubscribeToken(token, { now: now + 61_000 })).toBeNull();
  });
});
