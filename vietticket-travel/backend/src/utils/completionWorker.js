'use strict';

const prisma = require('../config/prisma');
const { todayInVietnam } = require('./refundService');
const { acquireJobLock, releaseJobLock, INSTANCE_ID } = require('./cleanupWorker');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // chạy mỗi 10 phút
const JOB_NAME = 'completion_bookings';
// TTL = gấp đôi interval để lock tự hết hạn nếu process crash giữa chừng.
const LOCK_TTL_MS = DEFAULT_INTERVAL_MS * 2;

// Mốc 00:00 của NGÀY HÔM NAY THEO GIỜ VIỆT NAM, biểu diễn bằng UTC midnight
// (reservation.date lưu dạng date-only = UTC midnight của ngày tham quan).
// Đơn có ngày tham quan TRƯỚC mốc này coi như đã đi xong.
function startOfTodayVn(now = new Date()) {
  return new Date(`${todayInVietnam(now)}T00:00:00.000Z`);
}

// Sau khi ngày tham quan kết thúc: đơn đã sử dụng ít nhất một vé được COMPLETED,
// các vé còn lại hết hiệu lực; đơn không sử dụng vé nào được đánh dấu NO_SHOW.
// Nếu toàn bộ vé được quét trong ngày, staffController sẽ COMPLETED đơn ngay.
// Tách riêng khỏi timer để test được. Trả về số đơn đã hoàn tất.
async function sweepCompletedBookings({ now = new Date() } = {}) {
  const cutoff = startOfTodayVn(now);

  // updateMany không lọc được theo quan hệ -> tìm id trước rồi cập nhật hàng loạt.
  // Với booking nhóm, một phần khách có thể không đến. Sau khi ngày tham quan kết thúc,
  // chỉ cần có vé USED là dịch vụ đã được thực hiện và booking được coi là hoàn tất.
  const completed = await prisma.booking.findMany({
    where: {
      isForecastTrainingSample: false,
      status: 'CONFIRMED',
      reservation: { date: { lt: cutoff } },
      ticketInstances: {
        some: { status: 'USED' },
      },
    },
    select: { id: true },
  });

  // Đơn hàng không có bất kỳ vé nào được check-in sẽ được coi là NO_SHOW.
  const noShows = await prisma.booking.findMany({
    where: {
      isForecastTrainingSample: false,
      status: 'CONFIRMED',
      reservation: { date: { lt: cutoff } },
      ticketInstances: {
        none: { status: 'USED' },
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
        bookingId: { in: [...completed, ...noShows].map((booking) => booking.id) },
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

// Khởi động vòng lặp định kỳ với distributed lock.
// acquireJobLock/releaseJobLock được import từ cleanupWorker để tái sử dụng logic
// và dùng chung INSTANCE_ID cho toàn process.
function startCompletionWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false; // chống chạy chồng trong cùng process

  const tick = async () => {
    if (isRunning) return;

    // Thử acquire distributed lock trước khi làm việc.
    let lockAcquired;
    try {
      lockAcquired = await acquireJobLock(JOB_NAME, LOCK_TTL_MS);
    } catch (lockError) {
      console.error('[completion] Không thể kiểm tra lock:', lockError.message);
      return;
    }

    if (!lockAcquired) {
      // Instance khác đang giữ lock → bỏ qua chu kỳ này.
      return;
    }

    isRunning = true;
    try {
      await sweepCompletedBookings();
    } catch (error) {
      console.error('[completion] Lỗi vòng quét:', error.message);
    } finally {
      isRunning = false;
      await releaseJobLock(JOB_NAME);
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref(); // không chặn process thoát
  console.log(`[completion] Worker đã khởi động (instance=${INSTANCE_ID}, mỗi ${intervalMs / 1000}s).`);
  return handle;
}

module.exports = {
  sweepCompletedBookings,
  startCompletionWorker,
  startOfTodayVn,
  DEFAULT_INTERVAL_MS,
};
