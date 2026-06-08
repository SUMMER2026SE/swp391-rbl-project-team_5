jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { reserveTickets, checkAvailability } = require('../controllers/ticketController');

afterEach(() => jest.clearAllMocks());

describe('reserveTickets - Chống Overbooking', () => {
  const mockUser = { id: 'user-001' };
  const mockTicket = { id: 'tkt-001', status: 'ACTIVE', attractionId: 'attr-001' };

  function makeReq(body = {}) {
    return {
      params: { ticketProductId: 'tkt-001' },
      body: { date: '2026-06-15', quantity: 2, ...body },
      user: mockUser,
    };
  }

  test('✅ Giữ vé thành công khi còn đủ slot', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        ticketProduct: { findUnique: jest.fn().mockResolvedValue(mockTicket) },
        dailyStock: {
          findUnique: jest.fn().mockResolvedValue({ id: 'daily-1', capacity: 100, bookedQuantity: 10, heldQuantity: 5 }),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({ id: 'daily-1' }),
        },
        reservation: { create: jest.fn().mockResolvedValue({ id: 'res-001', expiresAt: new Date(Date.now() + 10 * 60 * 1000) }) },
        timeSlot: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        timeSlotStock: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      });
    });

    const req = makeReq({ quantity: 2 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Trả 409 khi không đủ vé (overbooking)', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        ticketProduct: { findUnique: jest.fn().mockResolvedValue(mockTicket) },
        dailyStock: { findUnique: jest.fn().mockResolvedValue({ id: 'daily-2', capacity: 10, bookedQuantity: 8, heldQuantity: 1 }), create: jest.fn(), update: jest.fn() },
        reservation: { create: jest.fn() },
        timeSlot: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        timeSlotStock: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      });
    });

    const req = makeReq({ quantity: 5 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('❌ Trả 400 nếu quantity <= 0', async () => {
    const req = makeReq({ quantity: 0 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 nếu quantity không phải số nguyên', async () => {
    const req = makeReq({ quantity: 1.5 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 nếu date sai format', async () => {
    const req = makeReq({ date: 'ngay-sai' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('checkAvailability', () => {
  test('✅ Trả về danh sách slot với availableTickets đúng', async () => {
    mockPrisma.timeSlot.findMany.mockResolvedValue([{ id: 'slot-001', startTime: '08:00', endTime: '11:00', maxCapacity: 100 }]);
    mockPrisma.timeSlotStock.findUnique.mockResolvedValue({ bookedQty: 30, heldQty: 10 });

    const req = { params: { ticketProductId: 'tkt-001' }, query: { date: '2026-06-15' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await checkAvailability(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ availableTickets: 60 })]) }));
  });

  test('✅ availableTickets không âm khi sold + held > capacity', async () => {
    mockPrisma.timeSlot.findMany.mockResolvedValue([{ id: 'slot-001', startTime: '08:00', endTime: '11:00', maxCapacity: 10 }]);
    mockPrisma.timeSlotStock.findUnique.mockResolvedValue({ bookedQty: 8, heldQty: 5 });

    const req = { params: { ticketProductId: 'tkt-001' }, query: { date: '2026-06-15' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await checkAvailability(req, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ availableTickets: 0 })]) }));
  });
});
