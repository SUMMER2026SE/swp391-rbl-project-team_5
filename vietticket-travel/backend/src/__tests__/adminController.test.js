jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../utils/mailer', () => ({
  sendAccountStatusEmail: jest.fn(),
  sendPartnerReviewEmail: jest.fn(),
  sendAttractionReviewEmail: jest.fn(),
  sendAttractionViolationEmail: jest.fn(),
}));

const mockPrisma = require('./helpers/mockPrisma');
const { getAttractions } = require('../controllers/adminController');

afterEach(() => jest.clearAllMocks());

describe('getAttractions', () => {
  test('trả danh sách attraction cho trang Admin với dữ liệu đã map', async () => {
    mockPrisma.attraction.findMany.mockResolvedValue([
      {
        id: 'attr-001',
        title: 'Suối Tiên',
        description: 'Khu vui chơi',
        address: '120 Xa lộ Hà Nội',
        city: 'TP. HCM',
        status: 'PENDING',
        rejectionReason: null,
        averageRating: 4.5,
        totalReviews: 10,
        createdAt: new Date('2026-06-07T00:00:00.000Z'),
        partner: { id: 'partner-001', businessName: 'VietTicket Partner' },
        images: [{ imageUrl: 'https://example.com/image.jpg' }],
        categories: [{ category: { id: 'cat-001', name: 'Theme Park' } }],
        ticketProducts: [{ sellingPrice: 120000 }],
      },
    ]);
    mockPrisma.attraction.count.mockResolvedValue(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((operations) => Promise.all(operations));

    const req = { query: { status: 'PENDING' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAttractions(req, res, next);

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', archivedAt: null },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [
        expect.objectContaining({
          id: 'attr-001',
          primaryImage: 'https://example.com/image.jpg',
          minPrice: 120000,
        }),
      ],
      pagination: expect.objectContaining({ total: 1 }),
    }));
  });

  test('từ chối status không hợp lệ', async () => {
    const req = { query: { status: 'HIDDEN' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAttractions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.attraction.findMany).not.toHaveBeenCalled();
  });
});
