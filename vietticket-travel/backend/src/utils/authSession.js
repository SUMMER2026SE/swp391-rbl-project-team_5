'use strict';

const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const generateToken = require('./generateToken');
const { hashToken } = require('./tokenUtils');

function getRequestIp(req) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (forwardedFor) return String(forwardedFor).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || null;
}

async function createAuthSession(req, user) {
  const sessionId = randomUUID();
  const token = generateToken(user, sessionId);
  const decoded = jwt.decode(token);
  if (!decoded?.exp) {
    throw new Error('Generated JWT does not contain an expiration time');
  }

  const session = await prisma.authSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500) || null,
      ipAddress: getRequestIp(req),
      expiresAt: new Date(decoded.exp * 1000),
      lastSeenAt: new Date(),
    },
  });

  return { session, token };
}

module.exports = {
  createAuthSession,
  getRequestIp,
};
