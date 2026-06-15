jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { getSchedule, saveSchedule } = require('../controllers/scheduleController');

afterEach(() => jest.clearAllMocks());

function createRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const PARTNER = { id: 'partner-001' };

describe('getSchedule', () => {
  test('✅ Trả cấu hình lịch (openDays, timeSlots, specialDates)', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001', partnerId: 'partner-001',
      openDays: '1,1,1,1,1,0,0', defaultCapacity: 500,
      timeSlots: [{ id: 'slot-1', startTime: '08:00', endTime: '11:00', maxCapacity: 100, isActive: true }],
      specialDates: [{ date: new Date('2026-12-25T00:00:00.000Z'), closed: true, capacity: null }],
    });
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await getSchedule(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      schedule: expect.objectContaining({
        openDays: [true, true, true, true, true, false, false],
        defaultCapacity: 500,
        timeSlots: expect.any(Array),
        specialDates: expect.objectContaining({ '2026-12-25': expect.objectContaining({ closed: true }) }),
      }),
    }));
  });

  test('❌ Trả 404 khi không sở hữu', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'other' });
    const req = { partner: PARTNER, params: { id: 'attr-001' } };
    const res = createRes();
    await getSchedule(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('saveSchedule', () => {
  function setupOwned() {
    mockPrisma.attraction.findUnique.mockResolvedValue({ id: 'attr-001', partnerId: 'partner-001' });
  }

  test('✅ Lưu thành công openDays + timeSlots + specialDates', async () => {
    setupOwned();
    const tx = {
      attraction: { update: jest.fn() },
      timeSlot: { updateMany: jest.fn(), createMany: jest.fn() },
      specialDate: { deleteMany: jest.fn(), createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((cb) => cb(tx));

    const req = {
      partner: PARTNER, params: { id: 'attr-001' },
      body: {
        openDays: [true, true, true, true, true, false, false],
        defaultCapacity: 300,
        timeSlots: [{ start: '08:00', end: '11:00', capacity: 100 }],
        specialDates: { '2026-12-25': { closed: true } },
      },
    };
    const res = createRes();
    await saveSchedule(req, res, jest.fn());
    expect(tx.timeSlot.createMany).toHaveBeenCalled();
    expect(tx.specialDate.createMany).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  test('❌ Trả 400 khi timeSlots không phải mảng', async () => {
    setupOwned();
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { timeSlots: 'invalid' } };
    const res = createRes();
    await saveSchedule(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi giờ bắt đầu >= giờ kết thúc', async () => {
    setupOwned();
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { timeSlots: [{ start: '11:00', end: '08:00', capacity: 10 }] } };
    const res = createRes();
    await saveSchedule(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi định dạng thời gian sai', async () => {
    setupOwned();
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { timeSlots: [{ start: '25:00', end: '26:00', capacity: 10 }] } };
    const res = createRes();
    await saveSchedule(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 khi ngày đặc biệt không hợp lệ', async () => {
    setupOwned();
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: { specialDates: { 'khong-phai-ngay': { closed: true } } } };
    const res = createRes();
    await saveSchedule(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('✅ Không có thay đổi thì trả message phù hợp', async () => {
    setupOwned();
    const req = { partner: PARTNER, params: { id: 'attr-001' }, body: {} };
    const res = createRes();
    await saveSchedule(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Không có thay đổi') }));
  });
});
