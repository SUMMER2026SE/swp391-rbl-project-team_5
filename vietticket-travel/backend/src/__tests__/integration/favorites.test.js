const request = require('supertest');
const app = require('../../app');
const { generateTestToken } = require('../helpers/authHelper');

jest.mock('../../config/prisma', () => require('../helpers/mockPrisma'));
const mockPrisma = require('../helpers/mockPrisma');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

afterEach(() => jest.clearAllMocks());

function mockAuthenticatedUser() {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-001',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    profile: {},
  });
}

describe('Favorites API', () => {
  test('GET /api/favorites trả 401 khi chưa đăng nhập', async () => {
    const response = await request(app).get('/api/favorites');

    expect(response.status).toBe(401);
  });

  test('GET /api/favorites trả danh sách của user hiện tại', async () => {
    mockAuthenticatedUser();
    mockPrisma.favoriteAttraction.findMany.mockResolvedValue([]);
    const token = generateTestToken('user-001');

    const response = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { favorites: [] },
    });
  });

  test('POST /api/attractions/:id/favorite lưu địa điểm đã duyệt', async () => {
    mockAuthenticatedUser();
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      status: 'APPROVED',
    });
    mockPrisma.favoriteAttraction.findUnique.mockResolvedValue(null);
    mockPrisma.favoriteAttraction.create.mockResolvedValue({
      userId: 'user-001',
      attractionId: 'attr-001',
    });
    const token = generateTestToken('user-001');

    const response = await request(app)
      .post('/api/attractions/attr-001/favorite')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      attractionId: 'attr-001',
      isFavorite: true,
    });
  });
});
