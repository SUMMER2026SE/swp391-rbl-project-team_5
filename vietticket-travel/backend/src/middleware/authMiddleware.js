'use strict';

const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');

function readBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  return scheme === 'Bearer' && token ? token : '';
}

async function protect(req, res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || readBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Bạn cần đăng nhập để tiếp tục.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    const sessionId = decoded.sessionId;
    if (!userId || !sessionId) {
      return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    }

    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true, roleMemberships: true },
      }),
      prisma.authSession.findUnique({
        where: { id: sessionId },
      }),
    ]);

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ message: 'Tài khoản không hợp lệ hoặc đã bị khóa.' });
    }
    if (
      !session
      || session.userId !== user.id
      || session.revokedAt
      || new Date(session.expiresAt) <= new Date()
      || Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)
    ) {
      return res.status(401).json({ message: 'Phiên đăng nhập đã bị thu hồi hoặc hết hạn.' });
    }

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
    return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}

module.exports = protect;
