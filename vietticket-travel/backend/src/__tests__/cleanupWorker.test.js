jest.mock('../config/prisma', () => ({
  reservation: { findMany: jest.fn() },
  auditLog: {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
  },
  scheduledJobLock: {
    upsert: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  $transaction: jest.fn(),
}));

const prisma = require('../config/prisma');
const {
  listInventoryDriftCases,
  sweepExpiredReservations,
} = require('../utils/cleanupWorker');

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
  prisma.auditLog.findMany.mockResolvedValue([]);
  prisma.auditLog.create.mockResolvedValue({});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
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

  test('commit bị serialization failure không được đếm là đã dọn', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-commit-race' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-commit-race',
        status: 'HELD',
        ticketProductId: 'tkt-race',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 1,
        booking: null,
        ticketProduct: {
          attractionId: 'attr-race',
          attraction: { title: 'Điểm race' },
        },
      },
    });
    prisma.$transaction.mockImplementation(async (cb) => {
      await cb(tx);
      const error = new Error('Transaction failed due to a write conflict');
      error.code = 'P2034';
      throw error;
    });

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('res-commit-race'),
      expect.stringContaining('write conflict'),
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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

  test('lệch kho -> ghi dấu cách ly ngoài transaction để Admin xử lý tay', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-stock-drift' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-stock-drift',
        status: 'HELD',
        ticketProductId: 'tkt-drift',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 2,
        booking: null,
        ticketProduct: {
          attractionId: 'attr-drift',
          attraction: { title: 'Điểm lỗi kho' },
        },
      },
    });
    tx.attractionDailyStock.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await sweepExpiredReservations();

    // Ghi bằng client gốc, KHÔNG phải tx — tx đã rollback nên bản ghi trong đó
    // sẽ biến mất và lần quét sau lại không biết gì.
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'HOLD_EXPIRY_STOCK_DRIFT',
          entityType: 'Reservation',
          entityId: 'res-stock-drift',
          metadata: expect.objectContaining({ needsManualReview: true }),
        }),
      }),
    );
  });

  test('lượt đã bị cách ly không được quét lại ở vòng sau', async () => {
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'res-stock-drift' },
      { id: 'res-healthy' },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([{ entityId: 'res-stock-drift' }]);
    const tx = makeTx({
      reservation: {
        id: 'res-healthy',
        status: 'HELD',
        ticketProductId: 'tkt-ok',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 1,
        booking: null,
        ticketProduct: {
          attractionId: 'attr-ok',
          attraction: { title: 'Điểm bình thường' },
        },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations();

    // Chỉ mở transaction cho lượt lành, không đốt thêm transaction cho lượt lệch.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(cleaned).toBe(1);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('không truy vấn dấu cách ly khi không có lượt nào hết hạn', async () => {
    prisma.reservation.findMany.mockResolvedValue([]);

    const cleaned = await sweepExpiredReservations();

    expect(cleaned).toBe(0);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe('sweepExpiredReservations - giới hạn lô', () => {
  test('mỗi vòng chỉ ôm một lô, dọn lượt hết hạn lâu nhất trước', async () => {
    prisma.reservation.findMany.mockResolvedValue([]);

    await sweepExpiredReservations();

    const [{ take, orderBy }] = prisma.reservation.findMany.mock.calls[0];
    expect(take).toBe(500);
    expect(orderBy).toEqual({ expiresAt: 'asc' });
  });

  test('không đọc được danh sách cách ly thì vẫn quét tiếp, không hỏng cả vòng', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-1' }]);
    prisma.auditLog.findMany.mockRejectedValue(new Error('mất kết nối'));
    const tx = makeTx({
      reservation: {
        id: 'res-1',
        status: 'HELD',
        ticketProductId: 'tkt-1',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 1,
        booking: null,
        ticketProduct: { attractionId: 'attr-1', attraction: { title: 'X' } },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    await expect(sweepExpiredReservations()).resolves.toBe(1);
  });

  test('lô đầu toàn ca cách ly không được bỏ đói lượt khỏe ở lô kế tiếp', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([{ id: 'res-drift' }])
      .mockResolvedValueOnce([{ id: 'res-healthy' }]);
    prisma.auditLog.findMany
      .mockResolvedValueOnce([{ entityId: 'res-drift', action: 'HOLD_EXPIRY_STOCK_DRIFT' }])
      .mockResolvedValueOnce([]);
    const tx = makeTx({
      reservation: {
        id: 'res-healthy',
        status: 'HELD',
        ticketProductId: 'tkt-ok',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 1,
        booking: null,
        ticketProduct: {
          attractionId: 'attr-ok',
          attraction: { title: 'Điểm bình thường' },
        },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const cleaned = await sweepExpiredReservations({ batchSize: 1 });

    expect(cleaned).toBe(1);
    expect(prisma.reservation.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.reservation.findMany.mock.calls[1][0].skip).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('Admin retry thành công ghi event đóng ca và không giải phóng lần hai', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-drift' }]);
    prisma.auditLog.findMany
      .mockResolvedValueOnce([{
        entityId: 'res-drift',
        action: 'HOLD_EXPIRY_STOCK_DRIFT',
        createdAt: new Date('2026-06-21T00:00:00Z'),
      }]);
    const tx = makeTx({
      reservation: {
        id: 'res-drift',
        status: 'HELD',
        ticketProductId: 'tkt-ok',
        timeSlotId: null,
        date: new Date('2026-06-21'),
        quantity: 1,
        booking: null,
        ticketProduct: {
          attractionId: 'attr-ok',
          attraction: { title: 'Điểm đã đối soát' },
        },
      },
    });
    prisma.$transaction.mockImplementation((cb) => cb(tx));

    const result = await sweepExpiredReservations({
      graceMs: 0,
      batchSize: 1,
      reservationIds: ['res-drift'],
      includeQuarantined: true,
      actorId: 'admin-1',
      resolutionNote: 'Đã đối chiếu đủ ba lớp tồn kho.',
      returnDetails: true,
    });

    expect(console.error.mock.calls).toEqual([]);
    expect(result.cleaned).toBe(1);
    expect(result.resolvedDriftIds).toEqual(['res-drift']);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'HOLD_EXPIRY_STOCK_DRIFT_RESOLVED',
        entityId: 'res-drift',
        actorId: 'admin-1',
        metadata: expect.objectContaining({
          resolution: 'RELEASED_AFTER_RECONCILIATION',
        }),
      }),
    }));
  });
});

describe('listInventoryDriftCases', () => {
  test('event đóng mới nhất làm ca RESOLVED nhưng vẫn giữ thời điểm và lý do phát hiện gốc', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        entityId: 'res-1',
        action: 'HOLD_EXPIRY_STOCK_DRIFT_RESOLVED',
        metadata: { resolutionNote: 'Đã đối soát và sửa bộ đếm.' },
        createdAt: new Date('2026-07-29T10:10:00Z'),
        actor: { id: 'admin-1', fullName: 'Admin', email: 'admin@example.com' },
      },
      {
        entityId: 'res-1',
        action: 'HOLD_EXPIRY_STOCK_DRIFT',
        metadata: {
          reason: 'Không thể hoàn trả kho điểm tham quan.',
          detectedAt: '2026-07-29T10:00:00.000Z',
        },
        createdAt: new Date('2026-07-29T10:00:00Z'),
        actor: null,
      },
    ]);
    prisma.reservation.findMany.mockResolvedValue([{
      id: 'res-1',
      status: 'EXPIRED',
      expiresAt: new Date('2026-07-29T09:50:00Z'),
      quantity: 2,
      date: new Date('2026-08-01T00:00:00Z'),
      ticketProduct: {
        name: 'Vé người lớn',
        attraction: { id: 'attr-1', title: 'Điểm A' },
      },
      booking: {
        id: 'booking-1',
        status: 'CANCELLED',
        totalAmount: 200000,
        paymentMethod: 'vnpay',
        refundRequired: false,
      },
    }]);

    const cases = await listInventoryDriftCases({ status: 'ALL' });

    expect(cases).toEqual([
      expect.objectContaining({
        reservationId: 'res-1',
        status: 'RESOLVED',
        detectedAt: '2026-07-29T10:00:00.000Z',
        reason: 'Không thể hoàn trả kho điểm tham quan.',
        resolutionNote: 'Đã đối soát và sửa bộ đếm.',
        booking: expect.objectContaining({ totalAmount: 200000 }),
      }),
    ]);
  });
});
