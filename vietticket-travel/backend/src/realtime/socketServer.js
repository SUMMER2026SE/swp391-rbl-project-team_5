const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const prisma = require('../config/prisma');
const { corsOptions } = require('../config/cors');
const { isPlatformStaff } = require('../middleware/roleMiddleware');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');
const { getEffectiveRoles, hasRole } = require('../utils/userRoles');
const { setSocketServer } = require('./events');

let io = null;
const SUPPORT_JOIN_WINDOW_MS = 60 * 1000;
const SUPPORT_JOIN_LIMIT = 30;
const SOCKET_USER_SELECT = {
  id: true,
  role: true,
  status: true,
  tokenVersion: true,
  employerPartnerId: true,
  roleMemberships: { select: { role: true } },
  partnerProfile: {
    select: { id: true, status: true },
  },
};

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

async function loadSocketPrincipal({ userId, sessionId, tokenVersion }) {
  const [user, session] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: SOCKET_USER_SELECT,
    }),
    prisma.authSession.findUnique({
      where: { id: sessionId },
    }),
  ]);

  if (
    !user
    || user.status !== 'ACTIVE'
    || !session
    || session.userId !== user.id
    || session.revokedAt
    || new Date(session.expiresAt) <= new Date()
    || Number(tokenVersion || 0) !== Number(user.tokenVersion || 0)
  ) {
    return null;
  }

  const approvedPartner =
    hasRole(user, 'PARTNER') && user.partnerProfile?.status === 'APPROVED'
      ? user.partnerProfile
      : null;

  return {
    id: user.id,
    role: user.role,
    roles: getEffectiveRoles(user),
    employerPartnerId: user.employerPartnerId || null,
    partnerProfileId: approvedPartner?.id || null,
  };
}

async function authenticateSocket(socket, next) {
  try {
    const token = readSocketToken(socket);
    if (!token) return next(new Error('Unauthorized'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    if (!userId || !decoded.sessionId) return next(new Error('Unauthorized'));

    const authContext = {
      userId,
      sessionId: decoded.sessionId,
      tokenVersion: Number(decoded.tokenVersion || 0),
    };
    const principal = await loadSocketPrincipal(authContext);
    if (!principal) return next(new Error('Unauthorized'));

    socket.authContext = authContext;
    socket.user = principal;

    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
}

async function revalidateSocket(socket) {
  if (!socket?.authContext) return null;
  const principal = await loadSocketPrincipal(socket.authContext);
  if (!principal) {
    socket.emit?.('AUTHORIZATION_REVOKED', {
      message: 'Phiên đăng nhập đã hết hiệu lực.',
    });
    socket.disconnect?.(true);
    return null;
  }
  socket.user = principal;
  return principal;
}

function consumeSupportJoinAttempt(socket) {
  const now = Date.now();
  if (!socket.data) socket.data = {};
  const current = socket.data.supportJoinRate;
  if (!current || now - current.startedAt >= SUPPORT_JOIN_WINDOW_MS) {
    socket.data.supportJoinRate = { startedAt: now, count: 1 };
    return true;
  }
  current.count += 1;
  return current.count <= SUPPORT_JOIN_LIMIT;
}

async function canJoinSupportTicket(user, ticketId) {
  if (!ticketId || typeof ticketId !== 'string') return false;
  if (isPlatformStaff(user)) return true;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { userId: true },
  });

  return Boolean(ticket && ticket.userId === user?.id);
}

function initializeSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: corsOptions,
  });

  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    if (hasRole(socket.user, 'PARTNER') && socket.user.partnerProfileId) {
      socket.join(`partner:${socket.user.partnerProfileId}`);
    }

    // Support ticket (Module 5): chỉ cho vào phòng chat khi là chủ ticket
    // hoặc platform staff (ADMIN / platform STAFF). Partner staff bị chặn
    // vì canJoinSupportTicket kiểm tra isPlatformStaff(user) — hàm này
    // trả false khi user.employerPartnerId != null.
    socket.on('JOIN_SUPPORT_TICKET', async (ticketId) => {
      try {
        if (!consumeSupportJoinAttempt(socket)) {
          socket.emit('SUPPORT_JOIN_RATE_LIMITED', {
            message: 'Bạn đã yêu cầu tham gia phòng hỗ trợ quá thường xuyên.',
          });
          return;
        }
        const freshUser = await revalidateSocket(socket);
        if (freshUser && await canJoinSupportTicket(freshUser, ticketId)) {
          socket.join(`ticket:${ticketId}`);
        }
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
  canJoinSupportTicket,
  consumeSupportJoinAttempt,
  closeSocketServer,
  initializeSocketServer,
  loadSocketPrincipal,
  parseCookies,
  readSocketToken,
  revalidateSocket,
};
