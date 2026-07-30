'use strict';

// ============================================================
// slotDemandService.js
// ------------------------------------------------------------
// Học tỷ trọng nhu cầu giữa các khung giờ trong cùng một ngày, từ chính lịch
// sử bán vé của điểm tham quan (bảng TimeSlotStock).
//
// Vì sao cần lớp này: dự báo doanh thu chạy ở CẤP NGÀY. Nếu lấy thẳng con số
// cấp ngày gán cho mọi khung giờ thì mọi suất trong ngày đều nhận cùng một
// tín hiệu dự báo, và câu "giá động theo từng khung giờ" chỉ đúng ở phần tồn
// kho thực tế chứ không đúng ở phần dự báo.
//
// Cách làm: với mỗi ngày trong quá khứ, tính tỷ trọng vé bán của từng khung
// giờ trên tổng vé bán của ngày đó, rồi lấy trung bình các tỷ trọng — tách
// riêng ngày thường và cuối tuần vì hành vi khách khác hẳn nhau (suất hoàng
// hôn cuối tuần đông hơn hẳn suất chiều).
//
// Lấy trung bình của TỶ TRỌNG TỪNG NGÀY, không phải tỷ trọng của tổng cộng
// dồn: nếu cộng dồn thì một ngày lễ đông gấp ba sẽ chi phối toàn bộ kết quả.
//
// Nguyên tắc trung thực: khi chưa đủ dữ liệu để nói bất cứ điều gì về tỷ
// trọng, service trả `learned=false` và bên gọi phải quay về tín hiệu cấp
// ngày — không bịa ra một phân bố đều rồi gọi đó là dự báo theo khung giờ.
// ============================================================

const prisma = require('../config/prisma');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const LOOKBACK_DAYS = 84; // 12 tuần: đủ 12 cuối tuần để tách được hai chế độ
const MIN_WEEKDAY_SAMPLE_DAYS = 10;
const MIN_WEEKEND_SAMPLE_DAYS = 4;
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

function isWeekendDateKey(dateKey) {
  const day = dateOnlyFromKey(dateKey).getUTCDay();
  return day === 0 || day === 6;
}

function uniformShares(slotIds) {
  const share = slotIds.length > 0 ? 1 / slotIds.length : 0;
  return new Map(slotIds.map((id) => [id, { weekdayShare: share, weekendShare: share }]));
}

/**
 * Trung bình các tỷ trọng đã quan sát, rồi chuẩn hoá để tổng đúng bằng 1.
 * Chuẩn hoá là bắt buộc: một khung giờ không có dòng tồn kho trong ngày nào đó
 * được tính là 0, nên trung bình cộng thô có thể lệch khỏi 1.
 */
function averageShares(slotIds, samples) {
  const raw = slotIds.map((id) => {
    const values = samples.get(id) || [];
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return slotIds.map(() => (slotIds.length > 0 ? 1 / slotIds.length : 0));
  return raw.map((value) => value / total);
}

function buildEmptyResult(slotIds, reason) {
  return {
    learned: false,
    reason,
    lookbackDays: LOOKBACK_DAYS,
    weekdaySampleDays: 0,
    weekendSampleDays: 0,
    bySlotId: uniformShares(slotIds),
  };
}

/**
 * Tỷ trọng nhu cầu theo khung giờ của một điểm tham quan.
 *
 * @returns {{
 *   learned: boolean,
 *   reason: string|null,
 *   weekdaySampleDays: number,
 *   weekendSampleDays: number,
 *   bySlotId: Map<string, {weekdayShare: number, weekendShare: number}>,
 * }}
 */
async function getSlotDemandShares(
  client = prisma,
  { attractionId, slotIds, now = new Date() } = {},
) {
  const ids = [...new Set((slotIds || []).filter(Boolean))];
  if (ids.length === 0) return buildEmptyResult(ids, 'Lịch bán không có khung giờ nào.');
  if (ids.length === 1) {
    // Một khung giờ duy nhất: tỷ trọng luôn là 100%, và đó là sự thật hiển
    // nhiên chứ không phải thứ học được từ dữ liệu. Phải phân biệt rõ với
    // trường hợp học được thật, nếu không giao diện sẽ khoe "đã học từ 0 ngày".
    return {
      learned: true,
      singleSlot: true,
      reason: null,
      lookbackDays: LOOKBACK_DAYS,
      weekdaySampleDays: 0,
      weekendSampleDays: 0,
      bySlotId: new Map([[ids[0], { weekdayShare: 1, weekendShare: 1 }]]),
    };
  }

  const todayKey = vietnamDateKey(now);
  const cacheKey = `${attractionId}|${todayKey}|${ids.slice().sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const endKey = addDateKeyDays(todayKey, -1);
  const startKey = addDateKeyDays(endKey, -(LOOKBACK_DAYS - 1));
  const rows = await client.timeSlotStock.findMany({
    where: {
      timeSlotId: { in: ids },
      date: { gte: dateOnlyFromKey(startKey), lte: dateOnlyFromKey(endKey) },
    },
    select: { timeSlotId: true, date: true, bookedQty: true },
  });

  const byDate = new Map();
  for (const row of rows || []) {
    const key = vietnamDateKey(row.date);
    const entry = byDate.get(key) || new Map();
    entry.set(row.timeSlotId, Number(entry.get(row.timeSlotId) || 0) + Number(row.bookedQty || 0));
    byDate.set(key, entry);
  }

  const weekdaySamples = new Map();
  const weekendSamples = new Map();
  let weekdayDays = 0;
  let weekendDays = 0;

  for (const [dateKey, slotMap] of byDate) {
    const total = [...slotMap.values()].reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue;
    const weekend = isWeekendDateKey(dateKey);
    const target = weekend ? weekendSamples : weekdaySamples;
    ids.forEach((id) => {
      const list = target.get(id) || [];
      list.push(Number(slotMap.get(id) || 0) / total);
      target.set(id, list);
    });
    if (weekend) weekendDays += 1;
    else weekdayDays += 1;
  }

  if (weekdayDays < MIN_WEEKDAY_SAMPLE_DAYS || weekendDays < MIN_WEEKEND_SAMPLE_DAYS) {
    const value = buildEmptyResult(
      ids,
      `Chưa đủ lịch sử theo khung giờ để học tỷ trọng (cần ${MIN_WEEKDAY_SAMPLE_DAYS} ngày thường và ${MIN_WEEKEND_SAMPLE_DAYS} ngày cuối tuần, hiện có ${weekdayDays}/${weekendDays}).`,
    );
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  const weekdayShares = averageShares(ids, weekdaySamples);
  const weekendShares = averageShares(ids, weekendSamples);
  const value = {
    learned: true,
    reason: null,
    lookbackDays: LOOKBACK_DAYS,
    weekdaySampleDays: weekdayDays,
    weekendSampleDays: weekendDays,
    bySlotId: new Map(ids.map((id, index) => [id, {
      weekdayShare: weekdayShares[index],
      weekendShare: weekendShares[index],
    }])),
  };

  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function shareForSlot(shares, slotId, dateKey) {
  const entry = shares?.bySlotId?.get(slotId);
  if (!entry) return null;
  return isWeekendDateKey(dateKey) ? entry.weekendShare : entry.weekdayShare;
}

function resetSlotDemandCache() {
  cache.clear();
}

module.exports = {
  LOOKBACK_DAYS,
  MIN_WEEKDAY_SAMPLE_DAYS,
  MIN_WEEKEND_SAMPLE_DAYS,
  getSlotDemandShares,
  resetSlotDemandCache,
  shareForSlot,
  // Xuất ra để test khỏi phải dựng lại phép tính ngày tháng.
  __internals: { averageShares, isWeekendDateKey, uniformShares },
};
