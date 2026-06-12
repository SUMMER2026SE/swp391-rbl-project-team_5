const prisma = require('../config/prisma');
const { todayInVietnam } = require('./refundService');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // chạy mỗi 10 phút

// Mốc 00:00 của NGÀY HÔM NAY THEO GIỜ VIỆT NAM, biểu diễn bằng UTC midnight
// (reservation.date lưu dạng date-only = UTC midnight của ngày tham quan).
// Đơn có ngày tham quan TRƯỚC mốc này coi như đã đi xong.
function startOfTodayVn(now = new Date()) {
  return new Date(`${todayInVietnam(now)}T00:00:00.000Z`);
}

// Chỉ đơn đã check-in toàn bộ vé mới được COMPLETED. Đơn đã qua ngày nhưng
// không sử dụng được đánh dấu NO_SHOW để không mở quyền đánh giá sai.
// Tách riêng khỏi timer để test được. Trả về số đơn đã hoàn tất.
async function sweepCompletedBookings({ now = new Date() } = {}) {
  const cutoff = startOfTodayVn(now);

  // updateMany không lọc được theo quan hệ -> tìm id trước rồi cập nhật hàng loạt.
  const completed = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      reservation: { date: { lt: cutoff } },
      ticketInstances: {
        some: { status: 'USED' },
        every: { status: 'USED' },
      },
    },
    select: { id: true },
  });

  const noShows = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      reservation: { date: { lt: cutoff } },
      NOT: {
        ticketInstances: {
          some: { status: 'USED' },
          every: { status: 'USED' },
        },
      },
    },
    select: { id: true },
  });

  const [completedResult, noShowResult] = await prisma.$transaction([
    prisma.booking.updateMany({
      where: { id: { in: completed.map((booking) => booking.id) }, status: 'CONFIRMED' },
      data: { status: 'COMPLETED' },
    }),
    prisma.booking.updateMany({
      where: { id: { in: noShows.map((booking) => booking.id) }, status: 'CONFIRMED' },
      data: { status: 'NO_SHOW' },
    }),
    prisma.ticketInstance.updateMany({
      where: {
        bookingId: { in: noShows.map((booking) => booking.id) },
        status: 'VALID',
      },
      data: { status: 'EXPIRED' },
    }),
  ]);

  if (completedResult.count > 0 || noShowResult.count > 0) {
    console.log(
      `[completion] COMPLETED=${completedResult.count}, NO_SHOW=${noShowResult.count}.`,
    );
  }
  return completedResult.count;
}

// Khởi động vòng lặp định kỳ. Có cờ isRunning chống chạy chồng.
function startCompletionWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await sweepCompletedBookings();
    } catch (error) {
      console.error('[completion] Lỗi vòng quét:', error.message);
    } finally {
      isRunning = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref(); // không chặn process thoát
  console.log(`[completion] Worker đã khởi động (mỗi ${intervalMs / 1000}s).`);
  return handle;
}

module.exports = {
  sweepCompletedBookings,
  startCompletionWorker,
  startOfTodayVn,
  DEFAULT_INTERVAL_MS,
};
