'use strict';

const prisma = require('../config/prisma');
const {
  listInventoryDriftCases,
  recordStockDriftResolution,
  sweepExpiredReservations,
} = require('../utils/cleanupWorker');

const MAX_NOTE_LENGTH = 1000;

function respondError(res, error) {
  return res.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.code || 'INVENTORY_DRIFT_ERROR',
      message: error.message || 'Không thể xử lý ca lệch tồn kho.',
    },
    message: error.message || 'Không thể xử lý ca lệch tồn kho.',
  });
}

/**
 * GET /api/admin/inventory-drift-cases
 *
 * Admin chỉ xem được read model các ca lệch tồn kho đang mở/đã xử lý. Việc
 * thay đổi số lượng tồn kho phải được đối chiếu ở tầng vận hành trước khi
 * bấm retry, nên API này không tự ý ghi đè các bộ đếm.
 */
async function getInventoryDriftCases(req, res, next) {
  try {
    const status = String(req.query.status || 'OPEN').trim().toUpperCase();
    const limit = Number.parseInt(req.query.limit, 10) || 100;
    const cases = await listInventoryDriftCases({ status, limit });
    return res.json({
      success: true,
      data: cases,
      summary: {
        status,
        total: cases.length,
        open: cases.filter((item) => item.status === 'OPEN').length,
        resolved: cases.filter((item) => item.status === 'RESOLVED').length,
      },
    });
  } catch (error) {
    if (error.statusCode) return respondError(res, error);
    return next(error);
  }
}

/**
 * POST /api/admin/inventory-drift-cases/:reservationId/retry
 *
 * Quy trình an toàn: Admin kiểm tra ba lớp kho (ngày sản phẩm, ngày điểm
 * tham quan, khung giờ nếu có) ở ngoài màn hình này, ghi chú bằng chứng, rồi
 * mới yêu cầu retry. Nếu một lớp vẫn lệch, transaction rollback và ca vẫn
 * OPEN; không hủy booking hoặc tự ý trừ/hoàn tiền trên dữ liệu không tin cậy.
 */
async function retryInventoryDriftCase(req, res, next) {
  try {
    const reservationId = String(req.params.reservationId || '').trim();
    const resolutionNote = String(req.body?.resolutionNote || '').trim();
    if (!reservationId) {
      const error = new Error('Thiếu mã lượt giữ chỗ cần đối soát.');
      error.statusCode = 400;
      error.code = 'RESERVATION_ID_REQUIRED';
      return respondError(res, error);
    }
    if (resolutionNote.length < 5 || resolutionNote.length > MAX_NOTE_LENGTH) {
      const error = new Error('Ghi chú đối soát phải dài từ 5 đến 1000 ký tự.');
      error.statusCode = 400;
      error.code = 'INVALID_RESOLUTION_NOTE';
      return respondError(res, error);
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!reservation) {
      const error = new Error('Không tìm thấy lượt giữ chỗ cần đối soát.');
      error.statusCode = 404;
      error.code = 'RESERVATION_NOT_FOUND';
      return respondError(res, error);
    }

    // Idempotent: một ca đã được worker/phiên Admin khác xử lý thì không chạy
    // lại transaction và không đụng vào tồn kho lần hai.
    if (reservation.status !== 'HELD') {
      await recordStockDriftResolution({
        reservationId,
        actorId: req.user.id,
        req,
        resolutionNote,
        resolution: 'ALREADY_PROCESSED_BY_ANOTHER_FLOW',
        reservationStatus: reservation.status,
      });
      return res.json({
        success: true,
        message: 'Lượt giữ chỗ đã được xử lý trước đó; không cần retry thêm.',
        data: { reservationId, status: reservation.status, alreadyProcessed: true },
      });
    }

    if (new Date(reservation.expiresAt) > new Date()) {
      const error = new Error('Lượt giữ chỗ chưa quá hạn, chưa thể giải phóng tồn kho.');
      error.statusCode = 409;
      error.code = 'RESERVATION_NOT_EXPIRED';
      return respondError(res, error);
    }

    const result = await sweepExpiredReservations({
      graceMs: 0,
      batchSize: 1,
      reservationIds: [reservationId],
      includeQuarantined: true,
      actorId: req.user.id,
      req,
      resolutionNote,
      returnDetails: true,
    });

    if (
      result.cleanedIds?.includes(reservationId)
      && !result.resolvedDriftIds.includes(reservationId)
    ) {
      // Inventory đã commit nhưng event đóng ca có thể thất bại tạm thời.
      // Thử ghi lại ngay ở request Admin để ca không bị treo OPEN vĩnh viễn.
      await recordStockDriftResolution({
        reservationId,
        actorId: req.user.id,
        req,
        resolutionNote,
        reservationStatus: 'EXPIRED',
      });
      result.resolvedDriftIds.push(reservationId);
    }

    if (result.resolvedDriftIds.includes(reservationId)) {
      return res.json({
        success: true,
        message: 'Đã đối soát và giải phóng tồn kho an toàn cho lượt giữ chỗ.',
        data: {
          reservationId,
          status: 'EXPIRED',
          resolutionNote,
        },
      });
    }

    const error = new Error(
      'Các bộ đếm tồn kho vẫn chưa khớp. Ca được giữ ở trạng thái chờ đối soát; chưa hủy đơn hoặc hoàn tiền.',
    );
    error.statusCode = 409;
    error.code = 'STOCK_DRIFT_UNRESOLVED';
    error.details = {
      reservationId,
      failed: result.failedDriftIds.includes(reservationId),
    };
    return respondError(res, error);
  } catch (error) {
    if (error.statusCode) return respondError(res, error);
    return next(error);
  }
}

module.exports = {
  getInventoryDriftCases,
  retryInventoryDriftCase,
};
