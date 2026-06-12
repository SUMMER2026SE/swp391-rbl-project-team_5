jest.mock('../config/prisma', () => ({
  booking: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  ticketInstance: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
}));

const prisma = require('../config/prisma');
const { sweepCompletedBookings } = require('../utils/completionWorker');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  prisma.$transaction.mockImplementation((operations) => Promise.all(operations));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('chỉ booking đã dùng toàn bộ vé mới được COMPLETED', async () => {
  prisma.booking.findMany
    .mockResolvedValueOnce([{ id: 'checked-in' }])
    .mockResolvedValueOnce([{ id: 'no-show' }]);
  prisma.booking.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 1 });
  prisma.ticketInstance.updateMany.mockResolvedValue({ count: 2 });

  const completed = await sweepCompletedBookings({
    now: new Date('2026-06-20T03:00:00.000Z'),
  });

  expect(completed).toBe(1);
  expect(prisma.booking.updateMany).toHaveBeenNthCalledWith(1, {
    where: { id: { in: ['checked-in'] }, status: 'CONFIRMED' },
    data: { status: 'COMPLETED' },
  });
  expect(prisma.booking.updateMany).toHaveBeenNthCalledWith(2, {
    where: { id: { in: ['no-show'] }, status: 'CONFIRMED' },
    data: { status: 'NO_SHOW' },
  });
  expect(prisma.ticketInstance.updateMany).toHaveBeenCalledWith({
    where: { bookingId: { in: ['no-show'] }, status: 'VALID' },
    data: { status: 'EXPIRED' },
  });
});
