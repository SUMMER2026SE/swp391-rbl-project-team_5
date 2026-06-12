jest.mock('../config/prisma', () => ({
  reservation: { findMany: jest.fn() },
  $transaction: jest.fn(),
}));

const prisma = require('../config/prisma');
const { sweepExpiredReservations } = require('../utils/cleanupWorker');

function makeTx({ reservation }) {
  return {
    reservation: {
      findUnique: jest.fn().mockResolvedValue(reservation),
      update: jest.fn().mockResolvedValue({}),
    },
    dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    booking: { update: jest.fn().mockResolvedValue({}) },
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('sweepExpiredReservations', () => {
  test('không có đơn hết hạn -> 0, không mở transaction', async () => {
    prisma.reservation.findMany.mockResolvedValue([]);
    const cleaned = await sweepExpiredReservations();
    expect(cleaned).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('đơn hết hạn có timeSlot + booking PENDING_PAYMENT -> trả cả 2 kho + hủy đơn', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-1' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-1',
        status: 'HELD',
        ticketProductId: 'tkt-1',
        timeSlotId: 'slot-1',
        date: new Date('2026-06-20'),
        quantity: 2,
        booking: {
          id: 'bk-1',
          status: 'PENDING_PAYMENT',
          email: 'a@example.com',
          fullName: 'A',
          voucherId: null,
        },
        ticketProduct: {
          attractionId: 'attr-1',
          attraction: { title: 'Điểm A' },
        },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(1);
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
    expect(tx.dailyStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ heldQuantity: { gte: 2 } }),
        data: { heldQuantity: { decrement: 2 } },
      }),
    );
    expect(tx.timeSlotStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ heldQty: { gte: 2 } }),
        data: { heldQty: { decrement: 2 } },
      }),
    );
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } }),
    );
  });

  test('đơn hết hạn không timeSlot, không booking -> chỉ trả DailyStock', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-2' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-2',
        status: 'HELD',
        ticketProductId: 'tkt-2',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 1,
        booking: null,
        ticketProduct: {
          attractionId: 'attr-2',
          attraction: { title: 'Điểm B' },
        },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(1);
    expect(tx.dailyStock.updateMany).toHaveBeenCalled();
    expect(tx.timeSlotStock.updateMany).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  test('reservation đã đổi trạng thái (IPN thắng) -> bỏ qua, không trả kho', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-3' }]);
    const tx = makeTx({
      reservation: { id: 'res-3', status: 'CONFIRMED', ticketProductId: 'tkt-3', quantity: 1, booking: null },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(0);
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.dailyStock.updateMany).not.toHaveBeenCalled();
  });
});
