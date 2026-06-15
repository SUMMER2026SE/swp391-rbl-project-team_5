jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { listFavorites, toggleFavorite } = require('../controllers/favoriteController');

afterEach(() => jest.clearAllMocks());

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('listFavorites', () => {
  test('trả danh sách địa điểm yêu thích của user hiện tại', async () => {
    mockPrisma.favoriteAttraction.findMany.mockResolvedValue([
      {
        attractionId: 'attr-001',
        createdAt: new Date('2026-06-07T00:00:00.000Z'),
        attraction: {
          id: 'attr-001',
          title: 'Suối Tiên',
          address: '120 Xa lộ Hà Nội',
          city: 'TP. HCM',
          averageRating: 4.5,
          totalReviews: 12,
          images: [{ imageUrl: 'http://localhost/image.jpg' }],
          ticketProducts: [{ sellingPrice: 100000 }],
        },
      },
    ]);

    const req = { user: { id: 'user-001' } };
    const res = createResponse();
    const next = jest.fn();

    await listFavorites(req, res, next);

    expect(mockPrisma.favoriteAttraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-001',
          attraction: {
            publicationStatus: 'ACTIVE',
            status: { not: 'SUSPENDED' },
            archivedAt: null,
          },
        },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          favorites: [
            expect.objectContaining({
              attractionId: 'attr-001',
              attraction: expect.objectContaining({
                id: 'attr-001',
                primaryImage: 'http://localhost/image.jpg',
                minPrice: 100000,
              }),
            }),
          ],
        },
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('toggleFavorite', () => {
  test('lưu địa điểm khi chưa có trong danh sách yêu thích', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      archivedAt: null,
    });
    mockPrisma.favoriteAttraction.findUnique.mockResolvedValue(null);
    mockPrisma.favoriteAttraction.create.mockResolvedValue({
      userId: 'user-001',
      attractionId: 'attr-001',
    });

    const req = { user: { id: 'user-001' }, params: { id: 'attr-001' } };
    const res = createResponse();
    const next = jest.fn();

    await toggleFavorite(req, res, next);

    expect(mockPrisma.favoriteAttraction.create).toHaveBeenCalledWith({
      data: { userId: 'user-001', attractionId: 'attr-001' },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { attractionId: 'attr-001', isFavorite: true },
      }),
    );
  });

  test('bỏ lưu địa điểm khi đã có trong danh sách yêu thích', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      status: 'APPROVED',
      publicationStatus: 'ACTIVE',
      archivedAt: null,
    });
    mockPrisma.favoriteAttraction.findUnique.mockResolvedValue({
      userId: 'user-001',
      attractionId: 'attr-001',
    });

    const req = { user: { id: 'user-001' }, params: { id: 'attr-001' } };
    const res = createResponse();
    const next = jest.fn();

    await toggleFavorite(req, res, next);

    expect(mockPrisma.favoriteAttraction.delete).toHaveBeenCalledWith({
      where: {
        userId_attractionId: {
          userId: 'user-001',
          attractionId: 'attr-001',
        },
      },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { attractionId: 'attr-001', isFavorite: false },
      }),
    );
  });

  test('trả 404 khi địa điểm không tồn tại hoặc chưa được duyệt', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      status: 'PENDING',
      publicationStatus: 'PAUSED',
    });

    const req = { user: { id: 'user-001' }, params: { id: 'attr-001' } };
    const res = createResponse();
    const next = jest.fn();

    await toggleFavorite(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockPrisma.favoriteAttraction.findUnique).not.toHaveBeenCalled();
  });
});
