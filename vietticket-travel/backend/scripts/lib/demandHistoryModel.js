'use strict';

// ============================================================
// demandHistoryModel.js
// ------------------------------------------------------------
// Mô hình nhu cầu dùng để sinh lịch sử vận hành cho bộ dữ liệu demo.
//
// Tách riêng khỏi script seed vì đây là phần quyết định chất lượng của toàn
// bộ tầng dự báo và giá động: model chỉ học được những gì có trong dữ liệu.
// Tách ra thì kiểm thử được từng thành phần (mùa vụ, cuối tuần, lễ, sức chứa
// khung giờ) mà không cần chạm cơ sở dữ liệu.
//
// Nhu cầu một ngày được sinh theo TỶ LỆ LẤP ĐẦY, không phải theo số vé tuyệt
// đối:
//
//   occupancy = nền × cuối tuần × lễ × mùa cao điểm × xu hướng × nhiễu
//
// Mỗi thành phần là một quy luật độc lập và có thật trong vận hành du lịch,
// nên model dự báo có cái để học, và người trình bày có thể chỉ ra model đã
// học được thành phần nào.
// ============================================================

const { createHash } = require('crypto');

const NOISE_RATIO = 0.12; // biên nhiễu nhân tính quanh nhu cầu nền
const NO_SHOW_RATE = 0.045;
const MAX_OCCUPANCY = 0.97;
const MIN_OCCUPANCY = 0.06;
const SUMMER_MONTHS = Object.freeze([6, 7, 8]);

// Quy mô đoàn khách: lệch về nhóm nhỏ, thỉnh thoảng có đoàn trường/công ty.
const GROUP_SIZES = Object.freeze([1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 8, 10]);

// Ngày lễ dương lịch cố định; đủ để tạo đỉnh nhu cầu mà không cần bảng âm lịch.
const PUBLIC_HOLIDAYS = Object.freeze(new Set([
  '01-01', '04-30', '05-01', '09-01', '09-02', '09-03', '12-31',
]));

/**
 * PRNG mulberry32 gieo từ một chuỗi khóa.
 *
 * Không dùng Math.random: hai lần seed phải cho ra cùng một bộ số thì runbook,
 * smoke test và mọi con số đem ra trình bày mới ổn định.
 */
function seededGenerator(seedKey) {
  let state = createHash('sha256').update(String(seedKey)).digest().readUInt32BE(0);
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isPublicHoliday(dateKey) {
  return PUBLIC_HOLIDAYS.has(String(dateKey).slice(5));
}

function isWeekendDateKey(dateKey) {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Tỷ lệ lấp đầy của một ngày, trong khoảng [MIN_OCCUPANCY, MAX_OCCUPANCY].
 *
 * `random` được truyền vào (thay vì gieo bên trong) để nơi gọi kiểm soát được
 * chuỗi ngẫu nhiên: cùng một (điểm, ngày) phải luôn ra cùng một con số.
 */
function occupancyFor({
  profile,
  dateKey,
  dayIndex,
  historyDays,
  random,
  noiseRatio = NOISE_RATIO,
}) {
  const month = Number(String(dateKey).slice(5, 7));
  const weekend = isWeekendDateKey(dateKey);
  const holiday = isPublicHoliday(dateKey);

  const seasonFactor = SUMMER_MONTHS.includes(month) ? (profile.summerLift || 1) : 1;
  const trendFactor = 1
    + ((profile.trendPercent || 0) * dayIndex) / Math.max(1, historyDays - 1);
  const noiseFactor = 1 + (random() * 2 - 1) * noiseRatio;

  const raw = profile.baseOccupancy
    * (weekend ? (profile.weekendLift || 1) : 1)
    * (holiday ? (profile.holidayLift || 1) : 1)
    * seasonFactor
    * trendFactor
    * noiseFactor;

  return Math.min(MAX_OCCUPANCY, Math.max(MIN_OCCUPANCY, raw));
}

/**
 * Chia số khách trong ngày về từng khung giờ theo tỷ trọng, nhưng không khung
 * nào được vượt sức chứa của chính nó.
 *
 * Phần dư sau khi kẹp được rải sang các khung còn chỗ. Nếu tất cả đều đầy thì
 * ngày đó cháy vé — tổng phân bổ nhỏ hơn tổng mong muốn, đúng như vận hành
 * thật, và đó cũng là dữ liệu duy nhất dạy cho hệ thống biết "kín chỗ" trông
 * như thế nào.
 */
function allocateAdmissionsToSlots(totalAdmissions, slots, weekend) {
  const capacities = slots.map((slot) => Math.max(0, Number(slot.capacity || 0)));
  const shares = slots.map((slot) => Math.max(
    0,
    Number(weekend ? slot.weekendShare : slot.weekdayShare) || 0,
  ));
  const shareTotal = shares.reduce((sum, value) => sum + value, 0) || 1;

  const allocation = slots.map((_, index) => Math.min(
    capacities[index],
    Math.round((Math.max(0, totalAdmissions) * shares[index]) / shareTotal),
  ));

  let remaining = Math.max(0, totalAdmissions)
    - allocation.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    const openIndex = allocation.findIndex((value, index) => value < capacities[index]);
    if (openIndex === -1) break;
    allocation[openIndex] += 1;
    remaining -= 1;
  }
  return allocation;
}

/**
 * Quy mô một đơn đặt. Nếu phần còn lại quá nhỏ thì gộp luôn vào đơn hiện tại,
 * để không sinh ra một chuỗi đơn 1 khách lẻ ở cuối mỗi khung giờ.
 */
function drawGroupSize(random, remaining) {
  const draw = GROUP_SIZES[Math.floor(random() * GROUP_SIZES.length)];
  if (remaining - draw <= 2) return remaining;
  return draw;
}

// ------------------------------------------------------------
// Nhịp đặt chỗ (booking pace)
// ------------------------------------------------------------
// Khách mua vé tham quan chủ yếu sát ngày đi, không phải trải đều nhiều tuần.
// Dùng phân phối mũ rời rạc: phần lớn đơn có lead 1-5 ngày, đuôi kéo tới ~4
// tuần. Hai nơi phải dùng CHUNG một quy luật này:
//   - lịch sử: quyết định lead của từng đơn đã qua;
//   - tồn kho tương lai: quyết định ngày mai đã bán được bao nhiêu phần trăm.
// Lệch nhau thì đường cong đặt chỗ mà backend học được sẽ không khớp với tồn
// kho đang thấy, và mọi kết luận về "nhanh/chậm hơn thường lệ" đều sai.
const LEAD_TIME_SCALE_DAYS = 4.5;
const MAX_LEAD_DAYS = 28;

function drawLeadDays(random) {
  const draw = 1 + Math.floor(-Math.log(1 - random() * 0.999) * LEAD_TIME_SCALE_DAYS);
  return Math.min(MAX_LEAD_DAYS, Math.max(1, draw));
}

/**
 * Tỷ lệ vé của một ngày đã được bán khi còn `leadDays` ngày nữa — chính là
 * P(lead >= leadDays) của phân phối trên.
 */
function paceShareAtLead(leadDays) {
  const lead = Math.max(0, Math.trunc(Number(leadDays) || 0));
  if (lead <= 1) return 1;
  if (lead > MAX_LEAD_DAYS) return 0;
  return Math.exp(-(lead - 1) / LEAD_TIME_SCALE_DAYS);
}

function drawWeighted(random, entries) {
  const total = entries.reduce((sum, entry) => sum + Number(entry.share || 0), 0) || 1;
  let cursor = random() * total;
  for (const entry of entries) {
    cursor -= Number(entry.share || 0);
    if (cursor <= 0) return entry;
  }
  return entries[entries.length - 1];
}

/**
 * Kế hoạch nhu cầu của MỘT ngày cho một điểm tham quan: danh sách các đơn sẽ
 * được tạo, kèm khung giờ, gói vé, số vé và lead time.
 *
 * Đây là nguồn sự thật duy nhất cho cả hai nơi cần nó — script seed (ghi vào
 * cơ sở dữ liệu) và script sinh dataset huấn luyện (ghi ra CSV). Nếu hai bên
 * tự dựng lại logic thì chỉ cần một bên đổi thứ tự gọi PRNG là dữ liệu huấn
 * luyện không còn khớp dữ liệu đang chạy, và mọi con số độ chính xác đem ra
 * bảo vệ đều sai.
 *
 * @param {object} params
 * @param {number} params.paceRatio Tỷ lệ nhu cầu đã phát sinh (1 = trọn ngày
 *   đã qua; < 1 dùng cho ngày tương lai mới bán được một phần).
 */
function planDayDemand({
  profile,
  dateKey,
  dayIndex,
  historyDays,
  capacity,
  slots,
  productChoices,
  random,
  paceRatio = 1,
}) {
  const weekend = isWeekendDateKey(dateKey);
  const occupancy = occupancyFor({ profile, dateKey, dayIndex, historyDays, random });
  const targetAdmissions = Math.max(
    paceRatio >= 1 ? 1 : 0,
    Math.round(capacity * occupancy * Math.max(0, Math.min(1, paceRatio))),
  );
  const perSlot = allocateAdmissionsToSlots(targetAdmissions, slots, weekend);
  const orders = [];

  slots.forEach((slot, slotIndex) => {
    let remaining = perSlot[slotIndex];
    while (remaining > 0) {
      const quantity = Math.max(1, Math.min(remaining, drawGroupSize(random, remaining)));
      remaining -= quantity;
      const product = drawWeighted(random, productChoices);
      orders.push({
        slot,
        product,
        quantity,
        customerIndex: random(),
        leadDays: drawLeadDays(random),
        noShow: random() < NO_SHOW_RATE,
      });
    }
  });

  return { occupancy, targetAdmissions, weekend, orders };
}

module.exports = {
  GROUP_SIZES,
  LEAD_TIME_SCALE_DAYS,
  MAX_LEAD_DAYS,
  MAX_OCCUPANCY,
  MIN_OCCUPANCY,
  NOISE_RATIO,
  NO_SHOW_RATE,
  PUBLIC_HOLIDAYS,
  allocateAdmissionsToSlots,
  drawGroupSize,
  drawLeadDays,
  drawWeighted,
  isPublicHoliday,
  isWeekendDateKey,
  occupancyFor,
  paceShareAtLead,
  planDayDemand,
  seededGenerator,
};
