const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const prisma = require('../config/prisma');
const { corsOptions } = require('../config/cors');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');
const { setSocketServer } = require('./events');

let io = null;

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex < 0) return cookies;

    const key = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();
    if (!key) return cookies;

    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }

    return cookies;
  }, {});
}

function readBearerToken(authorization = '') {
  const [scheme, token] = String(authorization).trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token ? token : '';
}

function readSocketToken(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  return (
    cookies[AUTH_COOKIE_NAME] ||
    readBearerToken(socket.handshake.headers.authorization) ||
    String(socket.handshake.auth?.token || '').trim()
  );
}

async function authenticateSocket(socket, next) {
  try {
    const token = readSocketToken(socket);
    if (!token) return next(new Error('Unauthorized'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    if (!userId || !decoded.sessionId) return next(new Error('Unauthorized'));

    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          partnerProfile: {
            select: { id: true, status: true },
          },
        },
      }),
      prisma.authSession.findUnique({
        where: { id: decoded.sessionId },
      }),
    ]);

    if (
      !user
      || user.status !== 'ACTIVE'
      || !session
      || session.userId !== user.id
      || session.revokedAt
      || new Date(session.expiresAt) <= new Date()
      || Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)
    ) {
      return next(new Error('Unauthorized'));
    }

    const approvedPartner =
      user.role === 'PARTNER' && user.partnerProfile?.status === 'APPROVED'
        ? user.partnerProfile
        : null;

    socket.user = {
      id: user.id,
      role: user.role,
      partnerProfileId: approvedPartner?.id || null,
    };

    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
}

function initializeSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: corsOptions,
  });

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    if (socket.user.role === 'PARTNER' && socket.user.partnerProfileId) {
      socket.join(`partner:${socket.user.partnerProfileId}`);
    }

    // Support ticket (Module 5): chỉ cho vào phòng chat khi là chủ ticket
    // hoặc nhân viên (STAFF/ADMIN). Tránh nghe lén hội thoại của người khác.
    socket.on('JOIN_SUPPORT_TICKET', async (ticketId) => {
      try {
        if (!ticketId || typeof ticketId !== 'string') return;

        const isStaff = socket.user.role === 'STAFF' || socket.user.role === 'ADMIN';
        if (!isStaff) {
          const ticket = await prisma.supportTicket.findUnique({
            where: { id: ticketId },
            select: { userId: true },
          });
          if (!ticket || ticket.userId !== socket.user.id) return;
        }

        socket.join(`ticket:${ticketId}`);
      } catch (error) {
        console.error('[socket] JOIN_SUPPORT_TICKET lỗi:', error.message);
      }
    });

    socket.on('LEAVE_SUPPORT_TICKET', (ticketId) => {
      if (typeof ticketId === 'string' && ticketId) {
        socket.leave(`ticket:${ticketId}`);
      }
    });
  });

  setSocketServer(io);
  return io;
}

async function closeSocketServer() {
  if (!io) return;

  const activeServer = io;
  io = null;
  setSocketServer(null);

  await new Promise((resolve) => {
    activeServer.close(resolve);
  });
}

module.exports = {
  authenticateSocket,
  closeSocketServer,
  initializeSocketServer,
  parseCookies,
  readSocketToken,
};
