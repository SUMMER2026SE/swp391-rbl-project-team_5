const jwt = require('jsonwebtoken');

function generateToken(user) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign({ userId: user.id }, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
}

module.exports = generateToken;
