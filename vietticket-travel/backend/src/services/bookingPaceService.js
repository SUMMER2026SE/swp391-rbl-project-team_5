'use strict';

// ============================================================
// bookingPaceService.js
// ------------------------------------------------------------
// Đường cong đặt chỗ (booking pace): tại thời điểm còn L ngày nữa tới ngày
// tham quan, trung bình đã bán được bao nhiêu phần trăm số vé cuối cùng của
// ngày đó.
//
// Vì sao cần: dự báo AI nói về TỶ LỆ LẤP ĐẦY CUỐI CÙNG của một ngày, còn tồn
// kho nói về TỶ LỆ ĐÃ BÁN TỚI LÚC NÀY. Trộn thẳng hai đại lượng này theo một
// trọng số tùy chọn là so sánh hai thứ khác bản chất: còn 3 ngày nữa mà mới
// bán 20% thì con số 20% đó không có nghĩa là "vắng khách" — nó chỉ có nghĩa
// khi biết bình thường ở mốc 3 ngày người ta đã bán được bao nhiêu.
//
// Có đường cong này thì quy được tồn kho hiện tại về cùng một đại lượng với
// dự báo:
//
//   tỷ lệ lấp đầy cuối dự kiến ≈ (đã bán tới lúc này) / pace(L)
//
// và trọng số giữa hai nguồn không còn là hằng số chọn tay: pace(L) chính là
// phần thông tin đã biết chắc, 1 − pace(L) là phần còn phải dựa vào dự báo.
//
// Nguyên tắc trung thực: khi lịch sử chưa đủ để dựng đường cong, service trả
// `learned=false` và bên gọi quay về heuristic cũ — không bịa ra một đường
// cong tuyến tính rồi trình bày như thứ học được từ dữ liệu.
// ============================================================

const prisma = require('../config/prisma');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const LOOKBACK_DAYS = 84;
const MAX_LEAD_DAYS = 60;
const MIN_OBSERVED_DATES = 21;
// Dưới mức này, phép chia realized/pace khuếch đại nhiễu thành những con số vô
// nghĩa (bán 1 vé ở mốc pace=1% thành "dự kiến đầy 100%").
const MIN_USABLE_PACE = 0.08;
const CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map();

function vietnamDateKey(date) {
  return new Date(new Date(date).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function dateOnlyFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDateKeyDays(dateKey, days) {
  return new Date(dateOnlyFromKey(dateKey).getTime() + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

// Số ngày từ lúc đặt tới ngày tham quan, tính theo ngày lịch giờ VN.
function leadDaysBetween(visitDate, createdAt) {
  const visit = Math.floor(new Date(visitDate).getTime() / MS_PER_DAY);
  const created = Math.floor((new Date(createdAt).getTime() + VN_OFFSET_MS) / MS_PER_DAY);
  return Math.max(0, visit - created);
}

function emptyCurve(reason) {
  return {
    learned: false,
    reason,
    observedDates: 0,
    lookbackDays: LOOKBACK_DAYS,
    curve: [],
  };
}

/**
 * Dựng đường cong tích lũy từ các đơn đã đặt.
 *
 * Với mỗi ngày tham quan D: tổng vé cuối cùng T(D), và với mỗi mốc L, số vé đã
 * đặt trước đó ít nhất L ngày. Tỷ lệ pace(L) của ngày D là thương của hai số
 * này. Kết quả cuối là trung bình của các tỷ lệ theo từng ngày, không phải tỷ
 * lệ của tổng cộng dồn — nếu cộng dồn thì một ngày lễ bán gấp nhiều lần sẽ
 * quyết định toàn bộ hình dạng đường cong.
 */
function buildCurveFromReservations(rows) {
  const byDate = new Map();
  for (const row of rows || []) {
    const units = Math.max(0, Number(row.quantity || 0))
      * Math.max(1, Number(row.snapshotAdmissionCount ?? 1));
    if (units <= 0) continue;
    const key = new Date(row.date).toISOString().slice(0, 10);
    const lead = Math.min(MAX_LEAD_DAYS, leadDaysBetween(row.date, row.createdAt));
    const entry = byDate.get(key) || { total: 0, byLead: new Map() };
    entry.total += units;
    entry.byLead.set(lead, Number(entry.byLead.get(lead) || 0) + units);
    byDate.set(key, entry);
  }

  const usable = [...byDate.values()].filter((entry) => entry.total > 0);
  if (usable.length < MIN_OBSERVED_DATES) {
    return emptyCurve(
      `Chưa đủ ngày lịch sử để dựng đường cong đặt chỗ (cần ${MIN_OBSERVED_DATES} ngày, hiện có ${usable.length}).`,
    );
  }

  const sums = new Array(MAX_LEAD_DAYS + 1).fill(0);
  for (const entry of usable) {
    // Tích lũy ngược: ở mốc L đã bán được mọi đơn có lead >= L.
    let cumulative = 0;
    for (let lead = MAX_LEAD_DAYS; lead >= 0; lead -= 1) {
      cumulative += Number(entry.byLead.get(lead) || 0);
      sums[lead] += cumulative / entry.total;
    }
  }

  const curve = sums.map((sum) => Math.min(1, Math.max(0, sum / usable.length)));
  // Ép đơn điệu không tăng theo L: số vé đã bán không thể giảm đi khi thời
  // gian trôi về phía ngày đi. Nhiễu lấy mẫu có thể phá vỡ điều này ở đuôi.
  for (let lead = 1; lead <= MAX_LEAD_DAYS; lead += 1) {
    curve[lead] = Math.min(curve[lead], curve[lead - 1]);
  }
  curve[0] = 1;

  return {
    learned: true,
    reason: null,
    observedDates: usable.length,
    lookbackDays: LOOKBACK_DAYS,
    curve,
  };
}

async function getBookingPaceCurve(
  client = prisma,
  { attractionId, now = new Date() } = {},
) {
  const todayKey = vietnamDateKey(now);
  const cacheKey = `${attractionId}|${todayKey}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const endKey = addDateKeyDays(todayKey, -1);
  const startKey = addDateKeyDays(endKey, -(LOOKBACK_DAYS - 1));
  const rows = await client.reservation.findMany({
    where: {
      status: 'CONFIRMED',
      date: { gte: dateOnlyFromKey(startKey), lte: dateOnlyFromKey(endKey) },
      ticketProduct: { attractionId },
    },
    select: {
      date: true,
      createdAt: true,
      quantity: true,
      snapshotAdmissionCount: true,
    },
  });

  const value = buildCurveFromReservations(rows);
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Tỷ lệ vé thường đã bán được khi còn `leadDays` ngày nữa.
 * Trả null khi đường cong chưa học được hoặc giá trị quá nhỏ để chia.
 */
function paceAtLead(paceCurve, leadDays) {
  if (!paceCurve?.learned) return null;
  const lead = Math.max(0, Math.min(MAX_LEAD_DAYS, Math.trunc(Number(leadDays) || 0)));
  const value = paceCurve.curve[lead];
  if (!Number.isFinite(value) || value < MIN_USABLE_PACE) return null;
  return value;
}

function resetBookingPaceCache() {
  cache.clear();
}

module.exports = {
  LOOKBACK_DAYS,
  MAX_LEAD_DAYS,
  MIN_OBSERVED_DATES,
  MIN_USABLE_PACE,
  buildCurveFromReservations,
  getBookingPaceCurve,
  leadDaysBetween,
  paceAtLead,
  resetBookingPaceCache,
};
