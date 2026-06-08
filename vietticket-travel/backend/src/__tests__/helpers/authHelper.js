const jwt = require('jsonwebtoken');

function generateTestToken(userId = 'user-001', role = 'CUSTOMER') {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

module.exports = { generateTestToken };
