'use strict';

/**
 * Múi giờ Việt Nam = UTC+7.
 * Dùng hằng số ms để không phụ thuộc thư viện ngoài.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Parse chuỗi "HH:MM" thành số phút tính từ 00:00.
 * Trả về null nếu chuỗi không hợp lệ.
 *
 * @param {string|null|undefined} timeStr
 * @returns {number|null}
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Tính thời điểm (UTC Date) mà khách được phép bắt đầu đánh giá.
 *
 * Quy tắc:
 *  - visitDate lưu dạng @db.Date = UTC midnight của ngày tham quan.
 *    Ví dụ ngày 17/06 → 2026-06-17T00:00:00Z (= 07:00 VN).
 *  - Nếu có timeSlot.endTime (VD "17:30" giờ VN):
 *      deadline UTC = visitDate UTC + (endTimeMinutes * 60 000) - VN_OFFSET_MS
 *      = visitDate 00:00 UTC + 17h30m - 7h = visitDate + 10h30m UTC
 *  - Nếu không có timeSlot:
 *      deadline = đầu ngày kế tiếp theo giờ VN
 *               = visitDate UTC + 24h - VN_OFFSET_MS + VN_OFFSET_MS... thực ra:
 *               = visitDate UTC + 17h (= 00:00 VN ngày kế tiếp)
 *               = visitDate 00:00 UTC + (24 * 60 - 0) phút - 7h
 *      Tức là: visitDate midnight UTC + (24h - 7h) = visitDate + 17h UTC
 *      = 2026-06-17T17:00:00Z  → tương đương 00:00 ngày 18/06 giờ VN.
 *
 * @param {Date} visitDateUtc  - UTC midnight của ngày tham quan
 * @param {string|null} endTimeVn - "HH:MM" giờ VN, hoặc null
 * @returns {Date}
 */
function computeReviewDeadlineUtc(visitDateUtc, endTimeVn) {
  const endMinutes = parseTimeToMinutes(endTimeVn);

  if (endMinutes !== null) {
    // visitDate là UTC midnight.
    // endTime là giờ VN → quy UTC = endTime - 7h
    // deadline UTC ms = visitDate.getTime() + endMinutes * 60_000 - VN_OFFSET_MS
    return new Date(visitDateUtc.getTime() + endMinutes * 60_000 - VN_OFFSET_MS);
  }

  // Không có time slot → kết thúc = 00:00 VN ngày kế tiếp
  // = visitDate UTC midnight + 24h - 7h = visitDate UTC + 17h
  return new Date(visitDateUtc.getTime() + (24 * 60 - 0) * 60_000 - VN_OFFSET_MS);
}

/**
 * Kiểm tra booking có đủ điều kiện để đánh giá không.
 * SRS yêu cầu trạng thái phải đúng COMPLETED; việc chuyển trạng thái do luồng
 * check-in (khi đã dùng toàn bộ vé) hoặc completion worker (sau ngày tham quan) đảm nhiệm.
 *
 * @param {object} booking Booking từ Prisma, cần có booking.status.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isReviewEligible(booking) {
  const status = (booking.status || '').toUpperCase();

  if (status === 'COMPLETED') {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'Bạn chỉ được đánh giá sau khi đơn đã hoàn thành.',
  };
}

module.exports = { isReviewEligible, computeReviewDeadlineUtc, parseTimeToMinutes };
