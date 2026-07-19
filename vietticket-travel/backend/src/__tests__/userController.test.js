'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
jest.mock('../utils/authSession', () => ({
  createAuthSession: jest.fn(),
}));
jest.mock('../utils/authCookie', () => ({
  setAuthCookie: jest.fn(),
}));
jest.mock('../realtime/events', () => ({
  disconnectUserSockets: jest.fn(),
}));

const bcrypt = require('bcrypt');
const prisma = require('./helpers/mockPrisma');
const { createAuthSession } = require('../utils/authSession');
const { setAuthCookie } = require('../utils/authCookie');
const { disconnectUserSockets } = require('../realtime/events');
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
  prisma.user.update.mockResolvedValue({ id: 'user-1', tokenVersion: 1 });
  prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  createAuthSession.mockResolvedValue({
    token: 'rotated-session-token',
    session: { id: 'session-new' },
  });
  bcrypt.compare
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  bcrypt.hash.mockResolvedValue('new-hash');
});

describe('changePassword', () => {
  test('updates password, revokes every old session and issues a fresh session', async () => {
    const { req, res, next } = makeReqRes();

    await changePassword(req, res, next);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: 'new-hash',
        tokenVersion: { increment: 1 },
      },
      select: { id: true, tokenVersion: true },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(createAuthSession).toHaveBeenCalledWith(
      req,
      { id: 'user-1', tokenVersion: 1 },
    );
    expect(setAuthCookie).toHaveBeenCalledWith(res, 'rotated-session-token');
    expect(disconnectUserSockets).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith({
      message: 'Cập nhật mật khẩu thành công.',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
