const jwt = require('jsonwebtoken');

const TEST_SESSION_ID = 'test-session-001';

/**
 * Tạo JWT test tương thích với authMiddleware.js mới (cần userId, sessionId, tokenVersion).
 * @param {string} userId
 * @param {string} _role - Không dùng trong JWT payload mới (lấy từ DB), giữ để tương thích
 * @param {string} [sessionId]
 */
// eslint-disable-next-line no-unused-vars
function generateTestToken(userId = 'user-001', _role = 'CUSTOMER', sessionId = TEST_SESSION_ID) {
  return jwt.sign(
    { userId, sessionId, tokenVersion: 0 },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' },
  );
}

/**
 * Mock authSession trả về session hợp lệ cho test.
 * Phải gọi trước mỗi request cần auth trong integration tests.
 * @param {object} mockPrisma - mockPrisma instance
 * @param {string} userId
 * @param {string} [sessionId]
 */
function mockValidSession(mockPrisma, userId = 'user-001', sessionId = TEST_SESSION_ID) {
  mockPrisma.authSession.findUnique.mockResolvedValue({
    id: sessionId,
    userId,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 giờ
    lastSeenAt: new Date(Date.now() - 10 * 60 * 1000), // 10 phút trước
  });
}

module.exports = { generateTestToken, mockValidSession, TEST_SESSION_ID };
