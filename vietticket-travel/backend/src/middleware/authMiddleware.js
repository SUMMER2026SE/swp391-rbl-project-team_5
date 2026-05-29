const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');

function readBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme === 'Bearer' && token) {
    return token;
  }

  return '';
}

async function protect(req, res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || readBearerToken(req);

    if (!token) {
      return res.status(401).json({ message: 'Bạn cần đăng nhập để tiếp tục.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ message: 'Tài khoản không hợp lệ hoặc đã bị khóa.' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}

module.exports = protect;
