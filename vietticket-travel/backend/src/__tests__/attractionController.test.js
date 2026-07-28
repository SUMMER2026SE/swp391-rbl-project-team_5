jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/availabilityService', () => ({
  getTicketAvailabilityBatch: jest.fn(),
}));
const mockPrisma = require('./helpers/mockPrisma');
const { getTicketAvailabilityBatch } = require('../services/availabilityService');
const { createAttraction, searchAttractions, getAttractionDetail } = require('../controllers/attractionController');

afterEach(() => jest.clearAllMocks());

describe('createAttraction', () => {
  test('✅ Luôn tạo địa điểm ở trạng thái DRAFT', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'attr-001' });
    mockPrisma.$transaction.mockImplementation((callback) => callback({
      attraction: { create },
    }));
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Suối Tiên',
      description: '',
      address: '120 Xa lộ Hà Nội',
      city: 'TP. HCM',
      status: 'DRAFT',
      images: [],
      categories: [],
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
    });

    const req = {
      body: {
        name: 'Suối Tiên',
        address: '120 Xa lộ Hà Nội',
        province: 'TP. HCM',
        status: 'active',
      },
      partner: { id: 'partner-001' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createAttraction(req, res, next);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerId: 'partner-001',
        status: 'DRAFT',
      }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('searchAttractions', () => {
  test('✅ Trả về danh sách + pagination đúng format', async () => {
    const fakeAttractions = [{ id: 'attr-001', title: 'Suối Tiên', city: 'Ho Chi Minh', images: [], ticketProducts: [] }];
    mockPrisma.$transaction.mockResolvedValue([fakeAttractions, 1]);

    const req = { query: { page: '1', limit: '10' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await searchAttractions(req, res, next);

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishedAt: { not: null },
          operationalStatus: 'ACTIVE',
          publicationStatus: 'ACTIVE',
          archivedAt: null,
          partner: { status: 'APPROVED' },
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('✅ Lọc theo city', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);
    const req = { query: { city: 'Hanoi', page: '1', limit: '10' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await searchAttractions(req, res, next);
    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { locationTextNormalized: { contains: ' ha ' } },
            { locationTextNormalized: { contains: ' noi' } },
          ]),
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('tìm không dấu trên tên, địa chỉ, quận và thành phố', async () => {
    mockPrisma.$transaction
      .mockResolvedValueOnce([0, 0])
      .mockResolvedValueOnce([[], 0]);
    const req = { query: { search: 'bao tang q1 ho chi minh' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await searchAttractions(req, res, next);

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { searchTextNormalized: { contains: ' bao ' } },
            { searchTextNormalized: { contains: ' tang ' } },
            { searchTextNormalized: { contains: ' quan ' } },
            { searchTextNormalized: { contains: ' 1 ' } },
            { searchTextNormalized: { contains: ' ho ' } },
            { searchTextNormalized: { contains: ' chi ' } },
            { searchTextNormalized: { contains: ' minh' } },
          ]),
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('ưu tiên cụm vị trí chính xác thay vì nội dung mô tả nhắc thoáng qua', async () => {
    mockPrisma.$transaction
      .mockResolvedValueOnce([10, 15])
      .mockResolvedValueOnce([[], 0]);
    const req = { query: { search: 'ho chi minh' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await searchAttractions(req, res, next);

    expect(mockPrisma.attraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { locationTextNormalized: { contains: ' ho chi minh ' } },
          ]),
        }),
      }),
    );
  });
  test('lọc đúng khả dụng theo ngày và số khách trước khi phân trang', async () => {
    const candidates = [
      { id: 'attr-full', ticketProducts: [{ id: 'ticket-full' }] },
      { id: 'attr-open', ticketProducts: [{ id: 'ticket-open' }] },
    ];
    mockPrisma.attraction.findMany
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce([{
        id: 'attr-open',
        title: 'Điểm còn chỗ',
        city: 'Đà Nẵng',
        images: [],
        minTicketPrice: 200000,
      }]);
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['ticket-full', { availableGuests: 1, availableTickets: 1, admissionCount: 1 }],
      ['ticket-open', { availableGuests: 6, availableTickets: 6, admissionCount: 1 }],
    ]));

    const req = {
      query: {
        date: '2099-08-10',
        guests: '4',
        page: '1',
        limit: '10',
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await searchAttractions(req, res, jest.fn());

    expect(getTicketAvailabilityBatch).toHaveBeenCalledWith(
      mockPrisma,
      ['ticket-full', 'ticket-open'],
      new Date('2099-08-10T00:00:00.000Z'),
    );
    expect(mockPrisma.attraction.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['attr-open'] } }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        attractions: [
          expect.objectContaining({
            id: 'attr-open',
            availability: {
              date: '2099-08-10',
              requestedGuests: 4,
              availableGuests: 6,
              availableTickets: 6,
            },
          }),
        ],
        pagination: expect.objectContaining({ totalItems: 1 }),
        searchContext: {
          availabilityFiltered: true,
          date: '2099-08-10',
          guests: 4,
          capacityUnit: 'GUEST',
        },
      }),
    }));
  });

  test('không báo đủ chỗ cho nhóm gia đình nếu phải mua tròn gói vượt sức chứa', async () => {
    mockPrisma.attraction.findMany.mockResolvedValueOnce([
      { id: 'attr-family', ticketProducts: [{ id: 'ticket-family' }] },
    ]);
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['ticket-family', {
        admissionCount: 4,
        availableGuests: 7,
        availableTickets: 1,
      }],
    ]));

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await searchAttractions({
      query: { date: '2099-08-10', guests: '5' },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        attractions: [],
        pagination: expect.objectContaining({ totalItems: 0 }),
      }),
    }));
    expect(mockPrisma.attraction.findMany).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ date: '2099-02-31' }, 'Ngày tham quan'],
    [{ date: '2099-08-10', guests: '0' }, 'Số khách'],
    [{ date: '2099-08-10', guests: '2.5' }, 'Số khách'],
    [{ date: '2099-08-10', guests: '21' }, 'Số khách'],
  ])('từ chối bộ lọc khả dụng không hợp lệ %#', async (query, message) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await searchAttractions({ query }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining(message),
      }),
    }));
    expect(mockPrisma.attraction.findMany).not.toHaveBeenCalled();
  });
});

describe('getAttractionDetail', () => {
  test('✅ Trả về chi tiết nếu tìm thấy và status APPROVED', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', title: 'Suối Tiên', status: 'APPROVED', publicationStatus: 'ACTIVE', publishedAt: new Date('2026-06-01T00:00:00.000Z'), archivedAt: null, partner: { status: 'APPROVED' }, images: [], categories: [], ticketProducts: [] });
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
