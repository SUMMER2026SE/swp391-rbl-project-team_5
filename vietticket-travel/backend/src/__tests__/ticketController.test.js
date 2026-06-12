jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const { Prisma } = require('@prisma/client');
const mockPrisma = require('./helpers/mockPrisma');
const { reserveTickets, checkAvailability } = require('../controllers/ticketController');

afterEach(() => jest.clearAllMocks());

const attraction = {
  id: 'attr-001',
  status: 'APPROVED',
  archivedAt: null,
  openDays: '1,1,1,1,1,1,1',
  defaultCapacity: 100,
  openTime: '08:00',
  closeTime: '17:00',
  specialDates: [],
  timeSlots: [],
};

function productWithSlots(slots = []) {
  return {
    id: 'tkt-001',
    status: 'ACTIVE',
    archivedAt: null,
    attractionId: attraction.id,
    timeSlots: slots,
    attraction,
  };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('reserveTickets - chống overbooking', () => {
  const mockUser = { id: 'user-001' };

  function makeReq(body = {}) {
    return {
      params: { ticketProductId: 'tkt-001' },
      body: { date: '2026-06-15', quantity: 2, ...body },
      user: mockUser,
    };
  }

  function makeTx({ daily, attractionStock }) {
    return {
      ticketProduct: {
        findUnique: jest.fn().mockResolvedValue(productWithSlots()),
      },
      dailyStock: {
        findUnique: jest.fn().mockResolvedValue(daily),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          ...daily,
          capacity: data.capacity ?? daily.capacity,
        })),
        create: jest.fn(),
      },
      attractionDailyStock: {
        findUnique: jest.fn().mockResolvedValue(attractionStock),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          ...attractionStock,
          capacity: data.capacity ?? attractionStock.capacity,
        })),
        create: jest.fn(),
      },
      timeSlotStock: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      reservation: {
        create: jest.fn().mockResolvedValue({ id: 'res-001' }),
      },
    };
  }

  test('giữ vé trong transaction SERIALIZABLE khi còn đủ sức chứa', async () => {
    const tx = makeTx({
      daily: {
        id: 'daily-1',
        capacity: 100,
        bookedQuantity: 10,
        heldQuantity: 5,
      },
      attractionStock: {
        id: 'attr-stock-1',
        capacity: 100,
        bookedQty: 10,
        heldQty: 5,
      },
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.attractionDailyStock.update).toHaveBeenCalledWith({
      where: { id: 'attr-stock-1' },
      data: { heldQty: { increment: 2 } },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  test('trả 409 khi kho sản phẩm không còn đủ vé', async () => {
    const tx = makeTx({
      daily: {
        id: 'daily-2',
        capacity: 10,
        bookedQuantity: 8,
        heldQuantity: 1,
      },
      attractionStock: {
        id: 'attr-stock-2',
        capacity: 100,
        bookedQty: 8,
        heldQty: 1,
      },
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq({ quantity: 5 }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test.each([
    [{ quantity: 0 }, 400],
    [{ quantity: 1.5 }, 400],
    [{ date: 'ngay-sai' }, 400],
  ])('từ chối dữ liệu không hợp lệ %#', async (body, status) => {
    const res = makeRes();
    await reserveTickets(makeReq(body), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(status);
  });
});

describe('checkAvailability', () => {
  const slot = {
    id: 'slot-001',
    startTime: '08:00',
    endTime: '11:00',
    maxCapacity: 100,
  };

  beforeEach(() => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(productWithSlots([slot]));
    mockPrisma.dailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);
  });

  test('trả số vé còn lại theo slot, sản phẩm và toàn điểm tham quan', async () => {
    mockPrisma.timeSlotStock.findMany.mockResolvedValue([
      { timeSlotId: slot.id, bookedQty: 30, heldQty: 10 },
    ]);

    const res = makeRes();
    await checkAvailability(
      { params: { ticketProductId: 'tkt-001' }, query: { date: '2026-06-15' } },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ availableTickets: 60 }),
      ]),
    }));
  });

  test('availableTickets không âm', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(productWithSlots([
      { ...slot, maxCapacity: 10 },
    ]));
    mockPrisma.timeSlotStock.findMany.mockResolvedValue([
      { timeSlotId: slot.id, bookedQty: 8, heldQty: 5 },
    ]);

    const res = makeRes();
    await checkAvailability(
      { params: { ticketProductId: 'tkt-001' }, query: { date: '2026-06-15' } },
      res,
      jest.fn(),
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ availableTickets: 0 }),
      ]),
    }));
  });
});
