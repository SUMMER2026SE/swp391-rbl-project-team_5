'use strict';

const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { sendHoldExpiredEmail } = require('./mailer');
const { BANK_TRANSFER_METHOD } = require('./bankTransferPolicy');
const { writeAuditLog } = require('./auditLog');
const { HELD_STOCK_DRIFT, releaseHeldInventory } = require('./refundService');

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

// Dấu cách ly cho lượt giữ chỗ có bộ đếm kho đã lệch. Dùng chính AuditLog làm
// nơi lưu: đây đã là kênh "Admin cần xem việc này" của hệ thống, nên không cần
// thêm cột/bảng mới chỉ để đánh dấu một tình huống hiếm.
const STOCK_DRIFT_ACTION = 'HOLD_EXPIRY_STOCK_DRIFT';

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

// Quét và giải phóng các Reservation HELD đã quá hạn (qua grace).
// Tách riêng khỏi timer để test được. Trả về số reservation đã dọn.
async function sweepExpiredReservations({
  graceMs = DEFAULT_GRACE_MS,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  const cutoff = new Date(Date.now() - graceMs);

  // Giới hạn mỗi vòng. Sau một đợt downtime, số lượt hết hạn tồn đọng có thể
  // rất lớn; không chặn thì một vòng quét sẽ ôm cả tồn đọng đó vào bộ nhớ và
  // đẩy một mệnh đề IN khổng lồ xuống Postgres. Worker chạy mỗi phút nên tồn
  // đọng vẫn được tiêu hoá dần, chỉ là chia thành nhiều lô.
  const candidates = await prisma.reservation.findMany({
    where: { status: 'HELD', expiresAt: { lt: cutoff } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' }, // hết hạn lâu nhất được dọn trước
    take: Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE),
  });

  // Bỏ qua những lượt đã được đánh dấu cách ly. Một truy vấn cho cả vòng quét,
  // không phải một truy vấn cho mỗi lượt. Lỗi ở đây không được làm hỏng cả
  // vòng quét — cùng lắm là xử lý lại lượt đã cách ly và thất bại y như cũ.
  let quarantined = new Set();
  if (candidates.length > 0) {
    try {
      const marks = await prisma.auditLog.findMany({
        where: {
          action: STOCK_DRIFT_ACTION,
          entityType: 'Reservation',
          entityId: { in: candidates.map((row) => row.id) },
        },
        select: { entityId: true },
      });
      quarantined = new Set(marks.map((row) => row.entityId));
    } catch (error) {
      console.error('[cleanup] Không đọc được danh sách cách ly:', error.message);
    }
  }

  const expired = candidates.filter((row) => !quarantined.has(row.id));
  if (quarantined.size > 0) {
    console.warn(
      `[cleanup] Bỏ qua ${quarantined.size} lượt giữ chỗ đang chờ xử lý tay do lệch kho.`,
    );
  }

  let cleaned = 0;
  const cancelledBookings = []; // gom lại để gửi email SAU transaction
  for (const { id } of expired) {
    try {
      await prisma.$transaction(
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
          if (!r || r.status !== 'HELD') return;
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
          if (r.booking && r.booking.status === 'PENDING_PAYMENT') {
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
                cancellationSource: 'PAYMENT_TIMEOUT',
                cancellationReason: needsManualRefundReview
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
              await tx.voucher.updateMany({
                where: { id: r.booking.voucherId, usedCount: { gt: 0 } },
                data: { usedCount: { decrement: 1 } },
              });
            }
            await tx.payment.updateMany({
              where: { bookingId: r.booking.id, status: 'PENDING' },
              data: { status: 'FAILED' },
            });
            cancelledBookings.push({
              id: r.booking.id,
              email: r.booking.email,
              fullName: r.booking.fullName,
              attractionTitle: r.ticketProduct?.attraction?.title || null,
            });
          }

          cleaned += 1;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Serialization failure / lỗi 1 reservation -> bỏ qua, vòng sau quét lại.
      console.error(`[cleanup] Lỗi khi dọn reservation ${id}:`, error.message);
      if (error.code === HELD_STOCK_DRIFT) {
        // Lỗi này KHÔNG tự lành: vòng quét sau sẽ gặp đúng bộ đếm lệch đó và
        // thất bại y hệt. Ghi dấu để (a) Admin có việc cụ thể để xử lý và
        // (b) các vòng sau bỏ qua, thay vì đốt một transaction mỗi phút và
        // in lỗi mãi mãi mà không ai được báo.
        await quarantineDriftedReservation(id, error);
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
  return cleaned;
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
};
