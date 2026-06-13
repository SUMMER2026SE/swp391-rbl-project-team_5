'use strict';

const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { sendHoldExpiredEmail } = require('./mailer');

const DEFAULT_INTERVAL_MS = 60 * 1000; // chạy mỗi 1 phút
const DEFAULT_GRACE_MS = 3 * 60 * 1000; // chừa 3 phút cho IPN trả trễ
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

// Quét và giải phóng các Reservation HELD đã quá hạn (qua grace).
// Tách riêng khỏi timer để test được. Trả về số reservation đã dọn.
async function sweepExpiredReservations({ graceMs = DEFAULT_GRACE_MS } = {}) {
  const cutoff = new Date(Date.now() - graceMs);

  const expired = await prisma.reservation.findMany({
    where: { status: 'HELD', expiresAt: { lt: cutoff } },
    select: { id: true },
  });

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
                },
              },
              ticketProduct: {
                select: { attractionId: true, attraction: { select: { title: true } } },
              },
            },
          });
          if (!r || r.status !== 'HELD') return;

          await tx.reservation.update({
            where: { id },
            data: { status: 'EXPIRED' },
          });

          // Trả kho giữ chỗ (guard gte để không âm / không trừ trùng).
          await tx.dailyStock.updateMany({
            where: {
              ticketProductId: r.ticketProductId,
              date: r.date,
              heldQuantity: { gte: r.quantity },
            },
            data: { heldQuantity: { decrement: r.quantity } },
          });
          await tx.attractionDailyStock.updateMany({
            where: {
              attractionId: r.ticketProduct.attractionId,
              date: r.date,
              heldQty: { gte: r.quantity },
            },
            data: { heldQty: { decrement: r.quantity } },
          });

          if (r.timeSlotId) {
            await tx.timeSlotStock.updateMany({
              where: {
                timeSlotId: r.timeSlotId,
                date: r.date,
                heldQty: { gte: r.quantity },
              },
              data: { heldQty: { decrement: r.quantity } },
            });
          }

          // Dọn đơn mồ côi: booking đã tạo nhưng chưa thanh toán.
          if (r.booking && r.booking.status === 'PENDING_PAYMENT') {
            await tx.booking.update({
              where: { id: r.booking.id },
              data: { status: 'CANCELLED' },
            });
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
