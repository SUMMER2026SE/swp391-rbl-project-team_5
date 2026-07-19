jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  createNewsletterUnsubscribeToken,
  subscribe,
  unsubscribe,
} = require('../controllers/newsletterController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('newsletterController.subscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalizes and stores a valid email', async () => {
    prisma.newsletterSubscription.upsert.mockResolvedValue({});
    const req = { body: { email: '  Guest@Example.com ' } };
    const res = response();
    const next = jest.fn();

    await subscribe(req, res, next);

    expect(prisma.newsletterSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'guest@example.com' } }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid email without touching the database', async () => {
    const req = { body: { email: 'not-an-email' } };
    const res = response();

    await subscribe(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.newsletterSubscription.upsert).not.toHaveBeenCalled();
  });
});

describe('newsletterController.unsubscribe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEWSLETTER_TOKEN_SECRET = 'newsletter-test-secret-that-is-long-enough';
  });

  it('deactivates only the subscription named by a valid signed token', async () => {
    prisma.newsletterSubscription.updateMany.mockResolvedValue({ count: 1 });
    const token = createNewsletterUnsubscribeToken('  Guest@Example.com ');
    const req = { body: { token } };
    const res = response();

    await unsubscribe(req, res, jest.fn());

    expect(prisma.newsletterSubscription.updateMany).toHaveBeenCalledWith({
      where: { email: 'guest@example.com', isActive: true },
      data: { isActive: false },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not disclose whether the signed email was subscribed', async () => {
    prisma.newsletterSubscription.updateMany.mockResolvedValue({ count: 0 });
    const token = createNewsletterUnsubscribeToken('unknown@example.com');
    const req = { body: { token } };
    const res = response();

    await unsubscribe(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Đã ghi nhận yêu cầu hủy nhận tin cho địa chỉ email này.',
    });
  });

  it('rejects an unsigned email-only request', async () => {
    const req = { body: { email: 'victim@example.com' } };
    const res = response();

    await unsubscribe(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.newsletterSubscription.updateMany).not.toHaveBeenCalled();
  });
});
