jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { createAttraction, submitAttraction, searchAttractions, getAttractionDetail } = require('../controllers/attractionController');

afterEach(() => jest.clearAllMocks());

describe('searchAttractions', () => {
  test('✅ Trả về danh sách + pagination đúng format', async () => {
    const fakeAttractions = [{ id: 'attr-001', title: 'Suối Tiên', city: 'Ho Chi Minh', images: [], ticketProducts: [] }];
    mockPrisma.$transaction.mockResolvedValue([fakeAttractions, 1]);

    const req = { query: { page: '1', limit: '10' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await searchAttractions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('✅ Lọc theo city', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);
    const req = { query: { city: 'Hanoi', page: '1', limit: '10' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await searchAttractions(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getAttractionDetail', () => {
  test('✅ Trả về chi tiết nếu tìm thấy và status APPROVED', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', title: 'Suối Tiên', status: 'APPROVED', images: [], categories: [], ticketProducts: [] });
    const req = { params: { id: 'attr-001' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await getAttractionDetail(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Trả 404 nếu không tìm thấy', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);
    const req = { params: { id: 'not-exist' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await getAttractionDetail(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
