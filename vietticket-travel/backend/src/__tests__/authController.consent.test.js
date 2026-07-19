'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
jest.mock('../utils/mailer', () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

const bcrypt = require('bcrypt');
const prisma = require('./helpers/mockPrisma');
const { sendVerificationEmail } = require('../utils/mailer');
const { register } = require('../controllers/authController');

function makeReqRes(body) {
  const req = {
    body,
    ip: '203.0.113.10',
    headers: { 'user-agent': 'consent-test' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

const VALID_REGISTRATION = {
  fullName: 'Nguyen Van A',
  email: 'customer@example.com',
  password: 'Password123',
  phoneNumber: '0901234567',
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(null);
  bcrypt.hash.mockResolvedValue('password-hash');
  prisma.user.create.mockResolvedValue({
    id: 'user-1',
    fullName: VALID_REGISTRATION.fullName,
    email: VALID_REGISTRATION.email,
    role: 'CUSTOMER',
    roleMemberships: [{ role: 'CUSTOMER' }],
    profile: { phoneNumber: VALID_REGISTRATION.phoneNumber },
  });
  prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
  prisma.emailVerificationToken.create.mockResolvedValue({});
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
});

describe('registration consent evidence', () => {
  test('rejects registration unless terms consent is an explicit boolean true', async () => {
    const { req, res, next } = makeReqRes({
      ...VALID_REGISTRATION,
      acceptedTerms: 'true',
    });

    await register(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'TERMS_CONSENT_REQUIRED',
    }));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('stores server-controlled policy versions, timestamp and trusted request IP', async () => {
    const { req, res, next } = makeReqRes({
      ...VALID_REGISTRATION,
      acceptedTerms: true,
    });

    await register(req, res, next);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        termsAcceptedAt: expect.any(Date),
        termsVersion: '2026-07-17-v1',
        privacyVersion: '2026-07-17-v1',
        consentIpAddress: '203.0.113.10',
      }),
    }));
    expect(sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: VALID_REGISTRATION.email,
      token: expect.any(String),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});
