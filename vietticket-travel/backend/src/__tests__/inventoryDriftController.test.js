jest.mock('../config/prisma', () => ({
  reservation: { findUnique: jest.fn() },
}));
jest.mock('../utils/cleanupWorker', () => ({
  listInventoryDriftCases: jest.fn(),
  recordStockDriftResolution: jest.fn(),
  sweepExpiredReservations: jest.fn(),
}));

const prisma = require('../config/prisma');
const {
  listInventoryDriftCases,
  recordStockDriftResolution,
  sweepExpiredReservations,
} = require('../utils/cleanupWorker');
const {
  getInventoryDriftCases,
  retryInventoryDriftCase,
} = require('../controllers/inventoryDriftController');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('inventoryDriftController', () => {
  test('Admin xem được danh sách ca đang mở', async () => {
    listInventoryDriftCases.mockResolvedValue([
      { reservationId: 'res-1', status: 'OPEN' },
    ]);
    const res = createRes();

    await getInventoryDriftCases({
      query: { status: 'OPEN', limit: '50' },
    }, res, jest.fn());

    expect(listInventoryDriftCases).toHaveBeenCalledWith({ status: 'OPEN', limit: 50 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      summary: expect.objectContaining({ open: 1, total: 1 }),
    }));
  });

  test('không cho retry nếu thiếu ghi chú bằng chứng đối soát', async () => {
    const res = createRes();

    await retryInventoryDriftCase({
      params: { reservationId: 'res-1' },
      body: { resolutionNote: 'x' },
      user: { id: 'admin-1' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.reservation.findUnique).not.toHaveBeenCalled();
    expect(sweepExpiredReservations).not.toHaveBeenCalled();
  });

  test('retry thành công chỉ đóng ca sau khi giải phóng tồn kho thành công', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      status: 'HELD',
      expiresAt: new Date(Date.now() - 60_000),
    });
    sweepExpiredReservations.mockResolvedValue({
      cleaned: 1,
      cleanedIds: ['res-1'],
      resolvedDriftIds: ['res-1'],
      failedDriftIds: [],
    });
    const res = createRes();
    const req = {
      params: { reservationId: 'res-1' },
      body: { resolutionNote: 'Đã đối chiếu đủ ba lớp tồn kho.' },
      user: { id: 'admin-1' },
      headers: {},
    };

    await retryInventoryDriftCase(req, res, jest.fn());

    expect(sweepExpiredReservations).toHaveBeenCalledWith(expect.objectContaining({
      reservationIds: ['res-1'],
      includeQuarantined: true,
      actorId: 'admin-1',
      returnDetails: true,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ reservationId: 'res-1', status: 'EXPIRED' }),
    }));
  });

  test('reservation đã được luồng khác xử lý vẫn đóng ca idempotent', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      status: 'EXPIRED',
      expiresAt: new Date(Date.now() - 60_000),
    });
    recordStockDriftResolution.mockResolvedValue({});
    const res = createRes();

    await retryInventoryDriftCase({
      params: { reservationId: 'res-1' },
      body: { resolutionNote: 'Đã xác minh worker khác xử lý thành công.' },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(recordStockDriftResolution).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 'res-1',
      resolution: 'ALREADY_PROCESSED_BY_ANOTHER_FLOW',
      reservationStatus: 'EXPIRED',
    }));
    expect(sweepExpiredReservations).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alreadyProcessed: true }),
    }));
  });

  test('tồn kho vẫn lệch thì trả 409 và không báo đóng ca giả', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      status: 'HELD',
      expiresAt: new Date(Date.now() - 60_000),
    });
    sweepExpiredReservations.mockResolvedValue({
      cleaned: 0,
      cleanedIds: [],
      resolvedDriftIds: [],
      failedDriftIds: ['res-1'],
    });
    const res = createRes();

    await retryInventoryDriftCase({
      params: { reservationId: 'res-1' },
      body: { resolutionNote: 'Đã rà nhưng bộ đếm vẫn chưa khớp.' },
      user: { id: 'admin-1' },
      headers: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'STOCK_DRIFT_UNRESOLVED' }),
    }));
  });
});
