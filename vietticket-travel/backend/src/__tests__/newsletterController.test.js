jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const { subscribe } = require('../controllers/newsletterController');

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
