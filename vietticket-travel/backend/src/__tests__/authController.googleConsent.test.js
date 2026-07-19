'use strict';

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'google-client-test';

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));
jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
jest.mock('../utils/mailer', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
}));
jest.mock('../utils/authSession', () => ({
  createAuthSession: jest.fn(),
}));
jest.mock('../utils/authCookie', () => ({
  clearAuthCookie: jest.fn(),
  setAuthCookie: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
const { createAuthSession } = require('../utils/authSession');
const { setAuthCookie } = require('../utils/authCookie');
const { googleLogin } = require('../controllers/authController');

const GOOGLE_PAYLOAD = {
  email: 'google-user@example.com',
  email_verified: true,
  name: 'Google User',
  picture: 'https://images.example.com/avatar.jpg',
  sub: 'google-subject-1',
};

function makeReqRes(body) {
  const req = {
    body,
    ip: '203.0.113.20',
    headers: { 'user-agent': 'google-consent-test' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

function googleUser(overrides = {}) {
  return {
    id: 'google-user-1',
    email: GOOGLE_PAYLOAD.email,
    fullName: GOOGLE_PAYLOAD.name,
    role: 'CUSTOMER',
    provider: 'GOOGLE',
    status: 'ACTIVE',
    isEmailVerified: true,
    tokenVersion: 0,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyVersion: null,
    profile: { avatarUrl: GOOGLE_PAYLOAD.picture },
    roleMemberships: [{ role: 'CUSTOMER' }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ ...GOOGLE_PAYLOAD }),
  });
  createAuthSession.mockResolvedValue({
    session: { id: 'session-1' },
    token: 'google-session-token',
  });
});

describe('first-time Google account consent', () => {
  test('rejects creation of a new Google account without explicit consent', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const { req, res, next } = makeReqRes({
      credential: 'valid-google-credential',
    });

    await googleLogin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'TERMS_CONSENT_REQUIRED',
    }));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(createAuthSession).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('stores server-controlled consent evidence for a new Google account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const createdUser = googleUser({
      termsAcceptedAt: new Date(),
      termsVersion: '2026-07-17-v1',
      privacyVersion: '2026-07-17-v1',
    });
    prisma.user.create.mockResolvedValue(createdUser);
    const { req, res, next } = makeReqRes({
      credential: 'valid-google-credential',
      acceptedTerms: true,
    });

    await googleLogin(req, res, next);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provider: 'GOOGLE',
        termsAcceptedAt: expect.any(Date),
        termsVersion: '2026-07-17-v1',
        privacyVersion: '2026-07-17-v1',
        consentIpAddress: '203.0.113.20',
      }),
    }));
    expect(createAuthSession).toHaveBeenCalledWith(req, createdUser);
    expect(setAuthCookie).toHaveBeenCalledWith(res, 'google-session-token');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ id: createdUser.id }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('keeps existing legacy Google accounts login-compatible without retroactive consent', async () => {
    const existingUser = googleUser();
    const updatedUser = googleUser();
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.user.update.mockResolvedValue(updatedUser);
    prisma.oAuthAccount.upsert.mockResolvedValue({});
    const { req, res, next } = makeReqRes({
      credential: 'valid-google-credential',
    });

    await googleLogin(req, res, next);

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: existingUser.id },
      data: expect.not.objectContaining({
        termsAcceptedAt: expect.anything(),
        termsVersion: expect.anything(),
        privacyVersion: expect.anything(),
      }),
    }));
    expect(prisma.oAuthAccount.upsert).toHaveBeenCalled();
    expect(createAuthSession).toHaveBeenCalledWith(req, updatedUser);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Đăng nhập Google thành công.',
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
