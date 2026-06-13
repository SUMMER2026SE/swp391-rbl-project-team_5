const jwt = require('jsonwebtoken');

function generateToken(user, sessionId) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  return jwt.sign({
    userId: user.id,
    sessionId,
    tokenVersion: Number(user.tokenVersion || 0),
  }, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
}

module.exports = generateToken;
