jest.mock('../config/prisma', () => ({
  reservation: { findMany: jest.fn() },
  scheduledJobLock: {
    upsert: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  $transaction: jest.fn(),
}));

const prisma = require('../config/prisma');
const { sweepExpiredReservations } = require('../utils/cleanupWorker');

function makeTx({ reservation }) {
  return {
    reservation: {
      findUnique: jest.fn().mockResolvedValue(reservation),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    booking: { update: jest.fn().mockResolvedValue({}) },
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
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
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1', status: 'HELD' },
      data: { status: 'EXPIRED' },
    });
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
      expect.objectContaining({
        where: { id: 'bk-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationSource: 'PAYMENT_TIMEOUT',
        }),
      }),
    );
    // Đơn VNPay không được gắn cờ hoàn tiền: cổng đã báo thất bại/không thu tiền.
    expect(tx.booking.update.mock.calls[0][0].data.refundRequired).toBeUndefined();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } }),
    );
  });

  test('đơn CHUYỂN KHOẢN hết hạn -> gắn cờ refundRequired + ghi audit để Admin rà sao kê', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-bt' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-bt',
        status: 'HELD',
        ticketProductId: 'tkt-bt',
        timeSlotId: null,
        date: new Date('2026-06-20'),
        quantity: 2,
        booking: {
          id: 'bk-bt',
          status: 'PENDING_PAYMENT',
          email: 'khach@example.com',
          fullName: 'Khách chuyển khoản',
          voucherId: null,
          paymentMethod: 'bank_transfer',
          totalAmount: 450000,
        },
        ticketProduct: {
          attractionId: 'attr-bt',
          attraction: { title: 'Điểm C' },
        },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(1);
    const updateArgs = tx.booking.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'bk-bt' });
    expect(updateArgs.data.status).toBe('CANCELLED');
    // Cổng chuyển khoản không có callback -> tiền có thể đã vào tài khoản.
    expect(updateArgs.data.refundRequired).toBe(true);
    expect(updateArgs.data.cancellationSource).toBe('PAYMENT_TIMEOUT');
    expect(updateArgs.data.cancellationReason).toMatch(/sao kê/i);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BANK_TRANSFER_HOLD_EXPIRED',
          entityType: 'Booking',
          entityId: 'bk-bt',
          metadata: expect.objectContaining({
            amount: 450000,
            requiresManualRefundCheck: true,
          }),
        }),
      }),
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
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
    expect(tx.dailyStock.updateMany).not.toHaveBeenCalled();
  });

  test('không hủy booking nếu một lớp kho không thể hoàn trả an toàn', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-stock-drift' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-stock-drift',
        status: 'HELD',
        ticketProductId: 'tkt-drift',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 2,
        booking: {
          id: 'bk-stock-drift',
          status: 'PENDING_PAYMENT',
          email: 'a@example.com',
          fullName: 'A',
          voucherId: null,
        },
        ticketProduct: {
          attractionId: 'attr-drift',
          attraction: { title: 'Điểm lỗi kho' },
        },
      },
    });
    tx.attractionDailyStock.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(0);
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('res-stock-drift'),
      expect.stringContaining('Không thể hoàn trả kho'),
    );
  });
});
