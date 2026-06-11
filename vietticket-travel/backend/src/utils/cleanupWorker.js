const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { sendHoldExpiredEmail } = require('./mailer');

const DEFAULT_INTERVAL_MS = 60 * 1000; // chạy mỗi 1 phút
const DEFAULT_GRACE_MS = 3 * 60 * 1000; // chừa 3 phút cho IPN trả trễ (xem QĐ6)

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
              booking: { select: { id: true, status: true, email: true, fullName: true } },
              ticketProduct: {
                select: { attraction: { select: { title: true } } },
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

// Khởi động vòng lặp định kỳ. Có cờ isRunning chống chạy chồng.
function startCleanupWorker({ intervalMs = DEFAULT_INTERVAL_MS, graceMs = DEFAULT_GRACE_MS } = {}) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await sweepExpiredReservations({ graceMs });
    } catch (error) {
      console.error('[cleanup] Lỗi vòng quét:', error.message);
    } finally {
      isRunning = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref(); // không chặn process thoát
  console.log(`[cleanup] Worker đã khởi động (mỗi ${intervalMs / 1000}s, grace ${graceMs / 1000}s).`);
  return handle;
}

module.exports = {
  sweepExpiredReservations,
  startCleanupWorker,
  DEFAULT_INTERVAL_MS,
  DEFAULT_GRACE_MS,
};
