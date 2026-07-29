jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('../config/prisma');
const { pruneExpiredAuthSessions } = require('../utils/authSessionCleanupWorker');

describe('authSessionCleanupWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('xóa theo lô các phiên hết hạn hoặc đã thu hồi', async () => {
    prisma.authSession.findMany
      .mockResolvedValueOnce([{ id: 'session-1' }, { id: 'session-2' }])
      .mockResolvedValueOnce([]);
    prisma.authSession.deleteMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-07-29T00:00:00.000Z');

    await expect(pruneExpiredAuthSessions({
      now,
      batchSize: 2,
      maxBatches: 2,
    })).resolves.toBe(2);

    expect(prisma.authSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { revokedAt: { not: null, lte: now } },
        ],
      },
      take: 2,
    }));
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['session-1', 'session-2'] } },
    });
  });
});
