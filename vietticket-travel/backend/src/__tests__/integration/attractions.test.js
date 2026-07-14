const request = require('supertest');
const app = require('../../app');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { generateTestToken, mockValidSession } = require('../helpers/authHelper');

jest.mock('../../config/prisma', () => require('../helpers/mockPrisma'));
const mockPrisma = require('../helpers/mockPrisma');

afterEach(() => jest.clearAllMocks());

describe('GET /api/attractions', () => {
  test('✅ Trả 200 và đúng format pagination', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);

    const res = await request(app).get('/api/attractions').query({ page: 1, limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('attractions');
    expect(res.body.data).toHaveProperty('pagination');
  });

  test('✅ Lọc theo city hoạt động', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);
    const res = await request(app).get('/api/attractions').query({ city: 'Ho Chi Minh' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/attractions/:id', () => {
  test('✅ Trả 200 khi tìm thấy', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', title: 'Test', status: 'APPROVED', publicationStatus: 'ACTIVE', publishedAt: new Date('2026-06-01T00:00:00.000Z'), archivedAt: null, partner: { status: 'APPROVED' }, images: [], categories: [], ticketProducts: [] });
    const res = await request(app).get('/api/attractions/attr-001');
    expect(res.status).toBe(200);
  });

  test('❌ Trả 404 khi không tìm thấy', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/attractions/not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/attractions (Partner only)', () => {
  test('❌ Trả 401 nếu không có token', async () => {
    const res = await request(app).post('/api/attractions').send({ title: 'Test' });
    expect(res.status).toBe(401);
  });

  test('❌ Trả 403 nếu role là CUSTOMER', async () => {
    const token = generateTestToken('user-001', 'CUSTOMER');
    // mock user lookup in protect middleware
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-001', role: 'CUSTOMER', status: 'ACTIVE', tokenVersion: 0, profile: {} });
    mockValidSession(mockPrisma, 'user-001');
    const res = await request(app).post('/api/attractions').set('Authorization', `Bearer ${token}`).send({ title: 'Test' });
    expect(res.status).toBe(403);
  });
});
