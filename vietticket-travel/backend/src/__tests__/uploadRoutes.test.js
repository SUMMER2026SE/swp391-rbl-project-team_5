const request = require('supertest');
const app = require('../app');
const { generateTestToken, mockValidSession } = require('./helpers/authHelper');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');

afterEach(() => jest.clearAllMocks());

describe('Upload document routes', () => {
  test('blocks partner staff from reading another user private document', async () => {
    const token = generateTestToken('partner-staff-01', 'STAFF');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'partner-staff-01',
      role: 'STAFF',
      status: 'ACTIVE',
      tokenVersion: 0,
      employerPartnerId: 'partner-01',
    });
    mockValidSession(mockPrisma, 'partner-staff-01');

    const res = await request(app)
      .get('/api/upload/documents/customer-01-license.pdf')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('Kh');
  });
});
