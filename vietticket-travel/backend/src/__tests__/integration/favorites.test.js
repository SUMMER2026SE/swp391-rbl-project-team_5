const request = require('supertest');
const app = require('../../app');
const { generateTestToken, mockValidSession } = require('../helpers/authHelper');

jest.mock('../../config/prisma', () => require('../helpers/mockPrisma'));
const mockPrisma = require('../helpers/mockPrisma');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

afterEach(() => jest.clearAllMocks());

function mockAuthenticatedUser(role = 'CUSTOMER', overrides = {}) {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-001',
    role,
    status: 'ACTIVE',
    tokenVersion: 0,
    profile: {},
    ...overrides,
  });
  mockValidSession(mockPrisma, 'user-001');
}

describe('Favorites API', () => {
  test('GET /api/favorites returns 401 when not authenticated', async () => {
    const response = await request(app).get('/api/favorites');

    expect(response.status).toBe(401);
  });

  test('GET /api/favorites returns favorites for the current customer', async () => {
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

  test.each([
    ['PARTNER'],
    ['ADMIN'],
    ['STAFF'],
  ])('GET /api/favorites blocks %s because favorites are customer-only', async (role) => {
    mockAuthenticatedUser(role);
    const token = generateTestToken('user-001', role);

    const response = await request(app)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(mockPrisma.favoriteAttraction.findMany).not.toHaveBeenCalled();
  });

  test('POST /api/attractions/:id/favorite saves an approved attraction', async () => {
    mockAuthenticatedUser();
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      archivedAt: null,
      partner: { status: 'APPROVED' },
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

  test.each([
    ['PARTNER'],
    ['ADMIN'],
    ['STAFF'],
  ])('POST /api/attractions/:id/favorite blocks %s before touching wishlist data', async (role) => {
    mockAuthenticatedUser(role);
    const token = generateTestToken('user-001', role);

    const response = await request(app)
      .post('/api/attractions/attr-001/favorite')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(mockPrisma.attraction.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.favoriteAttraction.create).not.toHaveBeenCalled();
  });
});
