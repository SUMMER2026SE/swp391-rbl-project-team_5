'use strict';

const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');

function readBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  return scheme === 'Bearer' && token ? token : '';
}

async function optionalAuth(req, _res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || readBearerToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    const sessionId = decoded.sessionId;
    if (!userId || !sessionId) return next();

    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      }),
      prisma.authSession.findUnique({
        where: { id: sessionId },
      }),
    ]);

    const validSession =
      user &&
      user.status === 'ACTIVE' &&
      session &&
      session.userId === user.id &&
      !session.revokedAt &&
      new Date(session.expiresAt) > new Date() &&
      Number(decoded.tokenVersion || 0) === Number(user.tokenVersion || 0);

    if (!validSession) return next();

    req.user = user;
    req.authSession = session;

    const lastSeenAt = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (Date.now() - lastSeenAt > 5 * 60 * 1000) {
      await prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: new Date() },
      });
    }

    return next();
  } catch {
    return next();
  }
}

module.exports = optionalAuth;
