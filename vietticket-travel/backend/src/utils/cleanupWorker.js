'use strict';

const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { sendHoldExpiredEmail } = require('./mailer');
const { BANK_TRANSFER_METHOD } = require('./bankTransferPolicy');
const { writeAuditLog } = require('./auditLog');
const { HELD_STOCK_DRIFT, releaseHeldInventory } = require('./refundService');
const { releaseVoucherRedemption } = require('../services/voucherRedemptionService');

const DEFAULT_INTERVAL_MS = 60 * 1000; // chạy mỗi 1 phút
const DEFAULT_GRACE_MS = 3 * 60 * 1000; // chừa 3 phút cho IPN trả trễ
// Số lượt giữ chỗ tối đa xử lý trong một vòng. 500/phút = 30.000/giờ, thừa sức
// theo kịp lưu lượng thật mà vẫn chặn được một vòng quét khổng lồ sau downtime.
const DEFAULT_BATCH_SIZE = 500;
const JOB_NAME = 'cleanup_expired_reservations';
// TTL = thời gian tối đa worker được giữ lock (gấp đôi interval để an toàn).
// Nếu process crash trong khi đang chạy, lock sẽ tự hết hạn sau TTL.
const LOCK_TTL_MS = DEFAULT_INTERVAL_MS * 2;

// ID duy nhất của process/instance hiện tại (hostname + PID + random để tránh trùng
// khi scale ngang nhiều container trên cùng máy).
const INSTANCE_ID = `${require('os').hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Cố gắng acquire distributed lock qua ScheduledJobLock.
 * Dùng updateMany với điều kiện guard (lockedUntil < now HOẶC chính instance này)
 * để đảm bảo chỉ một instance chạy tại một thời điểm khi scale ngang.
 *
 * Trả về true nếu acquire thành công, false nếu instance khác đang giữ lock.
 */
async function acquireJobLock(jobName, ttlMs) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  // Bước 1: Tạo bản ghi lock nếu chưa có (idempotent).
  await prisma.scheduledJobLock.upsert({
    where: { jobName },
    update: {}, // không update gì nếu đã tồn tại
    create: { jobName, lockedBy: null, lockedUntil: new Date(0) },
  });

  // Bước 2: Cố gắng chiếm lock. Chỉ thành công nếu lock đã hết hạn
  // HOẶC chính instance này đang giữ (re-entrant an toàn).
  const result = await prisma.scheduledJobLock.updateMany({
    where: {
      jobName,
      OR: [
        { lockedUntil: { lt: now } },   // lock đã hết hạn (kể cả null < now là false → chỉ catch null qua case trên)
        { lockedUntil: null },           // chưa có ai giữ
        { lockedBy: INSTANCE_ID },       // chính instance này giữ (re-acquire)
      ],
    },
    data: {
      lockedBy: INSTANCE_ID,
      lockedUntil,
      updatedAt: now,
    },
  });

  return result.count === 1;
}

/**
 * Giải phóng lock sau khi worker chạy xong.
 * Chỉ release nếu chính instance này đang giữ (tránh xóa lock của instance khác).
 */
async function releaseJobLock(jobName) {
  try {
    await prisma.scheduledJobLock.updateMany({
      where: { jobName, lockedBy: INSTANCE_ID },
      data: {
        lockedBy: null,
        lockedUntil: new Date(0), // đặt về quá khứ để instance khác có thể lấy ngay
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    // Release thất bại không nghiêm trọng — lock sẽ tự hết hạn sau TTL.
    console.error(`[cleanup] Không thể release lock "${jobName}":`, error.message);
  }
}

// Dấu cách ly cho lượt giữ chỗ có bộ đếm kho đã lệch. AuditLog được dùng như
// event log bất biến: một event mở được ghi khi phát hiện lỗi, một event đóng
// được ghi sau khi Admin đối chiếu và giải phóng thành công. Vì vậy worker
// không coi một dấu cũ là trạng thái vĩnh viễn và vẫn truy được lịch sử xử lý.
const STOCK_DRIFT_ACTION = 'HOLD_EXPIRY_STOCK_DRIFT';
const STOCK_DRIFT_RESOLVED_ACTION = 'HOLD_EXPIRY_STOCK_DRIFT_RESOLVED';
const STOCK_DRIFT_ACTIONS = [STOCK_DRIFT_ACTION, STOCK_DRIFT_RESOLVED_ACTION];

// Ghi dấu cách ly NGOÀI transaction vừa rollback — nếu ghi bên trong, bản ghi
// sẽ bị cuốn theo và lần quét sau lại không biết gì.
async function quarantineDriftedReservation(reservationId, error) {
  try {
    await writeAuditLog({
      actorId: null,
      action: STOCK_DRIFT_ACTION,
      entityType: 'Reservation',
      entityId: reservationId,
      metadata: {
        reason: error.message,
        detectedAt: new Date().toISOString(),
        // Kho đã lệch nên worker cố ý KHÔNG tự hủy đơn hay tự trả kho. Nếu đơn
        // gắn với lượt giữ chỗ này đã thu tiền, tiền của khách đang không nằm
        // trong hàng đợi hoàn nào — phải có người đối chiếu rồi xử lý tay.
        needsManualReview: true,
      },
    });
    return true;
  } catch (auditError) {
    // Không ghi được dấu thì vòng sau vẫn thử lại — thà lặp còn hơn im lặng.
    console.error(
      `[cleanup] Không ghi được dấu lệch kho cho reservation ${reservationId}:`,
      auditError.message,
    );
    return false;
  }
}

async function recordStockDriftResolution({
  reservationId,
  actorId,
  req = null,
  resolutionNote = null,
  resolution = 'RELEASED_AFTER_RECONCILIATION',
  reservationStatus = 'EXPIRED',
}) {
  return writeAuditLog({
    req,
    actorId,
    action: STOCK_DRIFT_RESOLVED_ACTION,
    entityType: 'Reservation',
    entityId: reservationId,
    metadata: {
      status: 'RESOLVED',
      reservationStatus,
      resolvedAt: new Date().toISOString(),
      resolutionNote: String(resolutionNote || '').trim().slice(0, 1000) || null,
      resolution,
    },
  });
}

/**
 * Đọc trạng thái mới nhất của các ca lệch kho.
 *
 * AuditLog có thể chứa nhiều lần phát hiện và nhiều lần retry. Chỉ event mới
 * nhất quyết định trạng thái hiện tại; dữ liệu lịch sử vẫn được giữ nguyên để
 * phục vụ đối soát và điều tra sự cố.
 */
async function getStockDriftStates(reservationIds) {
  if (!reservationIds.length) return new Map();

  const events = await prisma.auditLog.findMany({
    where: {
      action: { in: STOCK_DRIFT_ACTIONS },
      entityType: 'Reservation',
      entityId: { in: reservationIds },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      entityId: true,
      action: true,
      metadata: true,
      createdAt: true,
    },
  });

  const states = new Map();
  for (const event of events || []) {
    if (!event?.entityId || states.has(event.entityId)) continue;
    // Tương thích với các dấu cũ chỉ có entityId, chưa có action/createdAt.
    const resolved = event.action === STOCK_DRIFT_RESOLVED_ACTION;
    states.set(event.entityId, {
      status: resolved ? 'RESOLVED' : 'OPEN',
      event,
    });
  }
  return states;
}

/**
 * Liệt kê các ca lệch kho cho màn hình vận hành Admin.
 * Đây là read model dựng từ event log, không cho phép sửa/xóa AuditLog.
 */
async function listInventoryDriftCases({
  status = 'OPEN',
  limit = 100,
} = {}) {
  const normalizedStatus = String(status || 'OPEN').trim().toUpperCase();
  if (!['OPEN', 'RESOLVED', 'ALL'].includes(normalizedStatus)) {
    const error = new Error('Trạng thái ca lệch kho không hợp lệ.');
    error.statusCode = 400;
    error.code = 'INVALID_DRIFT_STATUS';
    throw error;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const events = await prisma.auditLog.findMany({
    where: {
      action: { in: STOCK_DRIFT_ACTIONS },
      entityType: 'Reservation',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      entityId: true,
      action: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, fullName: true, email: true } },
    },
  });

  const histories = new Map();
  for (const event of events || []) {
    if (!event?.entityId) continue;
    const history = histories.get(event.entityId) || {
      latest: event,
      latestDetection: null,
    };
    if (
      event.action === STOCK_DRIFT_ACTION
      || (!event.action && !history.latestDetection)
    ) {
      history.latestDetection ||= event;
    }
    histories.set(event.entityId, history);
  }

  const selected = [...histories.values()]
    .map(({ latest, latestDetection }) => ({
      reservationId: latest.entityId,
      status: latest.action === STOCK_DRIFT_RESOLVED_ACTION ? 'RESOLVED' : 'OPEN',
      detectedAt: latestDetection?.metadata?.detectedAt
        || latestDetection?.createdAt
        || latest.createdAt,
      updatedAt: latest.createdAt,
      reason: latestDetection?.metadata?.reason || latest.metadata?.reason || null,
      resolutionNote: latest.metadata?.resolutionNote || null,
      actor: latest.actor || null,
    }))
    .filter((item) => normalizedStatus === 'ALL' || item.status === normalizedStatus)
    .slice(0, safeLimit);

  if (selected.length === 0) return [];

  const reservations = await prisma.reservation.findMany({
    where: { id: { in: selected.map((item) => item.reservationId) } },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      quantity: true,
      date: true,
      ticketProduct: {
        select: {
          name: true,
          attraction: { select: { id: true, title: true } },
        },
      },
      booking: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          paymentMethod: true,
          refundRequired: true,
        },
      },
    },
  });
  const byId = new Map((reservations || []).map((reservation) => [reservation.id, reservation]));

  return selected.map((item) => {
    const reservation = byId.get(item.reservationId);
    return {
      ...item,
      reservation: reservation
        ? {
            id: reservation.id,
            status: reservation.status,
            expiresAt: reservation.expiresAt,
            quantity: reservation.quantity,
            date: reservation.date,
          }
        : null,
      ticketProduct: reservation?.ticketProduct
        ? {
            name: reservation.ticketProduct.name,
            attraction: reservation.ticketProduct.attraction,
          }
        : null,
      booking: reservation?.booking
        ? {
            id: reservation.booking.id,
            status: reservation.booking.status,
            totalAmount: Number(reservation.booking.totalAmount || 0),
            paymentMethod: reservation.booking.paymentMethod,
            refundRequired: reservation.booking.refundRequired,
          }
        : null,
    };
  });
}

// Quét và giải phóng các Reservation HELD đã quá hạn (qua grace).
// Tách riêng khỏi timer để test được. Trả về số reservation đã dọn.
async function sweepExpiredReservations({
  graceMs = DEFAULT_GRACE_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  reservationIds = null,
  includeQuarantined = false,
  actorId = null,
  req = null,
  resolutionNote = null,
  returnDetails = false,
} = {}) {
  const cutoff = new Date(Date.now() - graceMs);

  // Giới hạn mỗi vòng. Sau một đợt downtime, số lượt hết hạn tồn đọng có thể
  // rất lớn; không chặn thì một vòng quét sẽ ôm cả tồn đọng đó vào bộ nhớ và
  // đẩy một mệnh đề IN khổng lồ xuống Postgres. Worker chạy mỗi phút nên tồn
  // đọng vẫn được tiêu hoá dần, chỉ là chia thành nhiều lô.
  const take = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
  const requestedIds = Array.isArray(reservationIds)
    ? reservationIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null;
  const candidates = [];
  const quarantined = new Set();
  let offset = 0;
  let canReadDriftState = true;
  let hasMoreCandidates = true;

  // Không dừng ở 500 dòng đầu: nếu toàn bộ lô đầu đã cách ly thì vẫn phải
  // quét các lô kế tiếp để các lượt lành không bị bỏ đói.
  while (hasMoreCandidates && candidates.length < take) {
    const page = await prisma.reservation.findMany({
      where: {
        status: 'HELD',
        expiresAt: { lt: cutoff },
        ...(requestedIds ? { id: { in: requestedIds } } : {}),
      },
      select: { id: true },
      orderBy: { expiresAt: 'asc' }, // hết hạn lâu nhất được dọn trước
      ...(requestedIds ? {} : { skip: offset }),
      take,
    });
    if (!page.length) break;

    offset += page.length;
    let states = new Map();
    if (canReadDriftState) {
      try {
        states = await getStockDriftStates(page.map((row) => row.id));
      } catch (error) {
        canReadDriftState = false;
        console.error('[cleanup] Không đọc được danh sách cách ly:', error.message);
      }
    }

    for (const row of page) {
      const state = states.get(row.id);
      if (state?.status === 'OPEN') {
        quarantined.add(row.id);
        if (!includeQuarantined) continue;
      }
      candidates.push(row);
      if (candidates.length >= take) break;
    }

    hasMoreCandidates = !requestedIds && page.length === take;
  }

  if (quarantined.size > 0 && !includeQuarantined) {
    console.warn(
      `[cleanup] Bỏ qua ${quarantined.size} lượt giữ chỗ đang chờ xử lý tay do lệch kho.`,
    );
  }

  const expired = candidates;
  let cleaned = 0;
  const result = {
    cleaned: 0,
    quarantined: [],
    resolvedDriftIds: [],
    failedDriftIds: [],
  };
  const cleanedIds = new Set();

  const cancelledBookings = []; // gom lại để gửi email SAU transaction
  for (const { id } of expired) {
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          // Đọc lại trong transaction; nếu IPN đã xử lý (không còn HELD) thì bỏ qua.
          const r = await tx.reservation.findUnique({
            where: { id },
            include: {
              booking: {
                select: {
                  id: true,
                  status: true,
                  email: true,
                  fullName: true,
                  voucherId: true,
                  paymentMethod: true,
                  totalAmount: true,
                },
              },
              ticketProduct: {
                select: {
                  attractionId: true,
                  admissionCount: true,
                  attraction: { select: { title: true } },
                },
              },
            },
          });
          if (!r || r.status !== 'HELD') return { cleaned: false };
          const released = await releaseHeldInventory(
            tx,
            r,
            { status: 'EXPIRED' },
          );
          if (!released) {
            const error = new Error('Lượt giữ chỗ vừa được xử lý bởi luồng khác.');
            error.statusCode = 409;
            throw error;
          }

          // Dọn đơn mồ côi: booking đã tạo nhưng chưa thanh toán.
          if (
            r.booking
            && ['PENDING_PAYMENT', 'PENDING_PARTNER'].includes(r.booking.status)
          ) {
            // Chuyển khoản ngân hàng KHÔNG có callback như VNPay, nên tại đây
            // hệ thống không thể biết khách đã chuyển tiền hay chưa. Nếu chỉ
            // hủy đơn, tiền của khách sẽ biến mất khỏi mọi hàng đợi: màn đối
            // chiếu sao kê chỉ liệt kê đơn còn PENDING_PAYMENT. Gắn
            // refundRequired để đơn nổi lên bộ lọc "Cần hoàn tiền" của Admin.
            const needsManualRefundReview =
              r.booking.paymentMethod === BANK_TRANSFER_METHOD;
            const cancelledAt = new Date();

            await tx.booking.update({
              where: { id: r.booking.id },
              data: {
                status: 'CANCELLED',
                cancelledAt,
                cancellationSource: r.booking.status === 'PENDING_PARTNER'
                  ? 'PARTNER_APPROVAL_TIMEOUT'
                  : 'PAYMENT_TIMEOUT',
                cancellationReason: r.booking.status === 'PENDING_PARTNER'
                  ? 'Đối tác không phản hồi trước hạn duyệt; khách chưa bị thu tiền.'
                  : needsManualRefundReview
                  ? 'Hết hạn giữ chỗ khi chờ đối chiếu chuyển khoản. '
                    + 'Kiểm tra sao kê ngân hàng và hoàn tiền thủ công nếu khách đã chuyển.'
                  : 'Khách không hoàn tất thanh toán trong thời hạn giữ chỗ.',
                ...(needsManualRefundReview ? { refundRequired: true } : {}),
              },
            });

            if (needsManualRefundReview) {
              await writeAuditLog({
                client: tx,
                actorId: null,
                action: 'BANK_TRANSFER_HOLD_EXPIRED',
                entityType: 'Booking',
                entityId: r.booking.id,
                metadata: {
                  bookingId: r.booking.id,
                  amount: Number(r.booking.totalAmount),
                  reason: 'Hết hạn giữ chỗ trước khi được đối chiếu sao kê.',
                  requiresManualRefundCheck: true,
                },
              });
            }

            if (r.booking.voucherId) {
              await releaseVoucherRedemption(tx, {
                bookingId: r.booking.id,
                voucherId: r.booking.voucherId,
              });
            }
            await tx.payment.updateMany({
              where: { bookingId: r.booking.id, status: 'PENDING' },
              data: { status: 'FAILED' },
            });
            const cancelledBooking = {
              id: r.booking.id,
              email: r.booking.email,
              fullName: r.booking.fullName,
              attractionTitle: r.ticketProduct?.attraction?.title || null,
            };
            return { cleaned: true, cancelledBooking };
          }

          return { cleaned: true, cancelledBooking: null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      // Chỉ đếm và gửi email sau khi Prisma xác nhận transaction đã commit.
      // Nếu commit vướng serialization failure, callback có thể đã chạy xong
      // nhưng mọi thay đổi bị rollback và lượt này phải được quét lại.
      if (outcome?.cleaned) {
        cleaned += 1;
        cleanedIds.add(id);
        if (outcome.cancelledBooking) cancelledBookings.push(outcome.cancelledBooking);
      }
    } catch (error) {
      // Serialization failure / lỗi 1 reservation -> bỏ qua, vòng sau quét lại.
      console.error(`[cleanup] Lỗi khi dọn reservation ${id}:`, error.message);
      if (error.code === HELD_STOCK_DRIFT) {
        // Lỗi này KHÔNG tự lành: vòng quét sau sẽ gặp đúng bộ đếm lệch đó và
        // thất bại y hệt. Ghi dấu để (a) Admin có việc cụ thể để xử lý và
        // (b) các vòng sau bỏ qua, thay vì đốt một transaction mỗi phút và
        // in lỗi mãi mãi mà không ai được báo.
        const marked = await quarantineDriftedReservation(id, error);
        if (marked) result.quarantined.push(id);
        if (includeQuarantined) result.failedDriftIds.push(id);
      }
    }
  }

  // Đóng ca chỉ sau khi transaction giải phóng kho và cập nhật booking đã
  // commit. Nếu ghi event đóng thất bại, Admin vẫn nhìn thấy ca mở để retry.
  if (includeQuarantined && actorId && cleaned > 0) {
    for (const id of expired.map((row) => row.id)) {
      if (!quarantined.has(id) || !cleanedIds.has(id)) continue;
      try {
        await recordStockDriftResolution({
          reservationId: id,
          actorId,
          req,
          resolutionNote,
        });
        result.resolvedDriftIds.push(id);
      } catch (error) {
        console.error(`[cleanup] Không ghi được event đóng ca lệch kho ${id}:`, error.message);
      }
    }
  }

  // Báo khách đơn đã bị hủy do hết hạn thanh toán (ngoài transaction, lỗi không chặn worker).
  for (const booking of cancelledBookings) {
    sendHoldExpiredEmail({
      to: booking.email,
      fullName: booking.fullName,
      bookingId: booking.id,
      attractionTitle: booking.attractionTitle,
    }).catch((error) =>
      console.error(`[cleanup] Không gửi được email hết hạn cho ${booking.id}:`, error.message),
    );
  }

  if (cleaned > 0) {
    console.log(`[cleanup] Đã giải phóng ${cleaned}/${expired.length} đơn giữ chỗ hết hạn.`);
  }
  result.cleaned = cleaned;
  result.cleanedIds = [...cleanedIds];
  return returnDetails ? result : cleaned;
}

// Khởi động vòng lặp định kỳ với distributed lock.
function startCleanupWorker({ intervalMs = DEFAULT_INTERVAL_MS, graceMs = DEFAULT_GRACE_MS } = {}) {
  let isRunning = false; // chống chạy chồng trong cùng process

  const tick = async () => {
    if (isRunning) return;

    // Thử acquire distributed lock trước khi làm việc.
    // Nếu instance khác đang chạy (scale ngang) → skip.
    let lockAcquired;
    try {
      lockAcquired = await acquireJobLock(JOB_NAME, LOCK_TTL_MS);
    } catch (lockError) {
      // Nếu DB lỗi khi lấy lock → skip an toàn, không gây crash worker.
      console.error('[cleanup] Không thể kiểm tra lock:', lockError.message);
      return;
    }

    if (!lockAcquired) {
      // Instance khác đang giữ lock → bỏ qua chu kỳ này.
      return;
    }

    isRunning = true;
    try {
      await sweepExpiredReservations({ graceMs });
    } catch (error) {
      console.error('[cleanup] Lỗi vòng quét:', error.message);
    } finally {
      isRunning = false;
      await releaseJobLock(JOB_NAME);
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref(); // không chặn process thoát
  console.log(`[cleanup] Worker đã khởi động (instance=${INSTANCE_ID}, mỗi ${intervalMs / 1000}s, grace ${graceMs / 1000}s).`);
  return handle;
}

module.exports = {
  sweepExpiredReservations,
  startCleanupWorker,
  DEFAULT_INTERVAL_MS,
  DEFAULT_GRACE_MS,
  // Export để test
  acquireJobLock,
  releaseJobLock,
  INSTANCE_ID,
  JOB_NAME,
  STOCK_DRIFT_ACTION,
  STOCK_DRIFT_RESOLVED_ACTION,
  listInventoryDriftCases,
  recordStockDriftResolution,
};
