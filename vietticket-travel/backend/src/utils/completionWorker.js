const prisma = require('../config/prisma');
const { todayInVietnam } = require('./refundService');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // chạy mỗi 10 phút

// Mốc 00:00 của NGÀY HÔM NAY THEO GIỜ VIỆT NAM, biểu diễn bằng UTC midnight
// (reservation.date lưu dạng date-only = UTC midnight của ngày tham quan).
// Đơn có ngày tham quan TRƯỚC mốc này coi như đã đi xong.
function startOfTodayVn(now = new Date()) {
  return new Date(`${todayInVietnam(now)}T00:00:00.000Z`);
}

// Quét các Booking CONFIRMED đã qua ngày tham quan -> chuyển sang COMPLETED.
// Tách riêng khỏi timer để test được. Trả về số đơn đã hoàn tất.
async function sweepCompletedBookings({ now = new Date() } = {}) {
  const cutoff = startOfTodayVn(now);

  // updateMany không lọc được theo quan hệ -> tìm id trước rồi cập nhật hàng loạt.
  const due = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      reservation: { date: { lt: cutoff } },
    },
    select: { id: true },
  });

  if (due.length === 0) return 0;

  const result = await prisma.booking.updateMany({
    where: { id: { in: due.map((b) => b.id) }, status: 'CONFIRMED' },
    data: { status: 'COMPLETED' },
  });

  if (result.count > 0) {
    console.log(`[completion] Đã chuyển ${result.count} đơn sang COMPLETED.`);
  }
  return result.count;
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
