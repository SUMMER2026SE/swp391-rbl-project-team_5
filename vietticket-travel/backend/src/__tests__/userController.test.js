'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const bcrypt = require('bcrypt');
const prisma = require('./helpers/mockPrisma');
const { changePassword } = require('../controllers/userController');

function makeReqRes(overrides = {}) {
  const req = {
    user: { id: 'user-1' },
    authSession: { id: 'session-current' },
    body: {
      currentPassword: 'OldPass123',
      newPassword: 'NewPass123',
    },
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    provider: 'LOCAL',
    passwordHash: 'old-hash',
  });
  prisma.user.update.mockResolvedValue({});
  prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
  prisma.$transaction.mockImplementation((operations) => Promise.all(operations));
  bcrypt.compare
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  bcrypt.hash.mockResolvedValue('new-hash');
});

describe('changePassword', () => {
  test('updates password and revokes other active sessions', async () => {
    const { req, res, next } = makeReqRes();

    await changePassword(req, res, next);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        id: { not: 'session-current' },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res.json).toHaveBeenCalledWith({
      message: 'Cập nhật mật khẩu thành công.',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
