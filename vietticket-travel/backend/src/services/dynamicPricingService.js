'use strict';

// ============================================================
// dynamicPricingService.js
// ------------------------------------------------------------
// Biến dự báo AI thành một quyết định giá có thể giải trình.
//
// Chuỗi suy luận cho mỗi (gói vé, ngày, khung giờ):
//   1. realizedRatio  = (đã bán + đang giữ) / sức chứa   -> sự thật đã xảy ra
//   2. forecastRatio  = vé dự báo bán được / sức chứa ngày -> RevenueForecast (AI)
//   3. demandIndex    = trộn 2 tín hiệu theo lead time, nhưng KHÔNG BAO GIỜ
//                       thấp hơn realizedRatio (đã bán 90% thì không thể coi là vắng)
//   4. demandIndex -> phần trăm điều chỉnh (dốc tuyến tính, không có bậc thang)
//   5. Kẹp trong hàng rào sàn/trần của đối tác -> làm tròn -> giá cuối
//
// Mọi hàm tính toán ở phần đầu file đều thuần tuý (không chạm CSDL) để test
// được từng hàng rào một cách độc lập.
// ============================================================

const prisma = require('../config/prisma');
const { MIN_VNPAY_AMOUNT, parseVndInteger } = require('../utils/money');
const {
  buildScheduleFromProduct,
  getProductCapacity,
  getSlotCapacity,
} = require('./availabilityService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Giá đơn vị tối thiểu sau khi điều chỉnh: đúng bằng hạn mức tối thiểu của
// cổng thanh toán. Nếu để thấp hơn, khách vẫn giữ chỗ được nhưng sẽ không tạo
// nổi booking (createBooking chặn ở MIN_VNPAY_AMOUNT) -> lượt giữ chỗ chết.
// Với gói vé vốn đã rẻ hơn hạn mức này thì lấy chính giá niêm yết làm sàn,
// tuyệt đối không được vin vào hạn mức để đẩy giá LÊN.
const MIN_ADJUSTED_UNIT_PRICE = MIN_VNPAY_AMOUNT;

const CONFIDENCE_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

const DEFAULT_POLICY = Object.freeze({
  enabled: false,
  mode: 'SUGGEST_ONLY',
  highDemandThreshold: 0.75,
  lowDemandThreshold: 0.35,
  maxSurchargePercent: 15,
  maxDiscountPercent: 15,
  priceFloorPercent: 80,
  priceCeilingPercent: 120,
  roundingStep: 1000,
  lookaheadDays: 14,
  minConfidence: 'MEDIUM',
});

function isAutoApplyAllowed(env = process.env) {
  return String(env.DYNAMIC_PRICING_AUTO_APPLY_ALLOWED || '')
    .trim()
    .toLowerCase() === 'true';
}

function describeRuntimePolicy(raw, env = process.env) {
  const policy = normalizePolicy(raw);
  const autoApplyAllowed = isAutoApplyAllowed(env);
  const runtimeSafetyActive = (
    policy.mode === 'AUTO_APPLY' && !autoApplyAllowed
  );

  return {
    ...policy,
    autoApplyAllowed,
    effectiveMode: runtimeSafetyActive ? 'SUGGEST_ONLY' : policy.mode,
    runtimeSafetyActive,
    runtimeSafetyReason: runtimeSafetyActive
      ? 'Chế độ tự áp giá đang bị khóa ở cấp hệ thống; khách vẫn trả giá niêm yết.'
      : null,
  };
}

function applyRuntimeSafety(raw, env = process.env) {
  const described = describeRuntimePolicy(raw, env);
  return normalizePolicy({
    ...described,
    mode: described.effectiveMode,
  });
}

// ------------------------------------------------------------
// Chuẩn hoá đầu vào
// ------------------------------------------------------------

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function intInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.round(parsed), minimum, maximum);
}

function floatInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, minimum, maximum);
}

// Ràng buộc giống hệt CHECK constraint trong migration: API và CSDL không được
// phép hiểu khác nhau về thế nào là một chính sách hợp lệ.
function normalizePolicy(raw) {
  const policy = { ...DEFAULT_POLICY, ...(raw || {}) };

  const highDemandThreshold = floatInRange(policy.highDemandThreshold, 0.75, 0.05, 1);
  let lowDemandThreshold = floatInRange(policy.lowDemandThreshold, 0.35, 0, 0.95);
  // Hai vùng không được chồng lấn, nếu không một demandIndex có thể vừa là
  // "đông" vừa là "vắng".
  if (lowDemandThreshold >= highDemandThreshold) {
    lowDemandThreshold = Math.max(0, highDemandThreshold - 0.05);
  }

  return {
    id: policy.id || null,
    attractionId: policy.attractionId || null,
    enabled: Boolean(policy.enabled),
    mode: policy.mode === 'AUTO_APPLY' ? 'AUTO_APPLY' : 'SUGGEST_ONLY',
    highDemandThreshold,
    lowDemandThreshold,
    maxSurchargePercent: intInRange(policy.maxSurchargePercent, 15, 0, 100),
    maxDiscountPercent: intInRange(policy.maxDiscountPercent, 15, 0, 100),
    priceFloorPercent: intInRange(policy.priceFloorPercent, 80, 1, 100),
    priceCeilingPercent: intInRange(policy.priceCeilingPercent, 120, 100, 300),
    roundingStep: intInRange(policy.roundingStep, 1000, 1, 1_000_000),
    lookaheadDays: intInRange(policy.lookaheadDays, 14, 1, 60),
    minConfidence: CONFIDENCE_RANK[policy.minConfidence] === undefined
      ? 'MEDIUM'
      : policy.minConfidence,
    updatedById: policy.updatedById || null,
    updatedAt: policy.updatedAt || null,
  };
}

// ------------------------------------------------------------
// Tín hiệu nhu cầu
// ------------------------------------------------------------

function vietnamDayStart(date) {
  return Math.floor((new Date(date).getTime() + VN_OFFSET_MS) / MS_PER_DAY);
}

// Số ngày từ "hôm nay" (giờ VN) tới ngày tham quan.
function leadTimeDays(visitDate, now = new Date()) {
  return vietnamDayStart(visitDate) - vietnamDayStart(now);
}

/**
 * Trộn dự báo AI với mức lấp đầy thực tế.
 *
 * Trọng số của dự báo giảm dần khi tới gần ngày tham quan: còn xa thì hầu như
 * chưa ai đặt nên realizedRatio ≈ 0 và không nói lên điều gì; càng sát ngày thì
 * số vé đã bán càng là bằng chứng đáng tin hơn mọi mô hình.
 *
 * Bất biến: demandIndex >= realizedRatio. Số vé đã bán là chặn dưới cứng của
 * nhu cầu — một khung giờ đã lấp đầy 90% thì không bao giờ được giảm giá vì
 * model đoán "vắng".
 */
function blendDemandIndex({
  realizedRatio,
  forecastRatio,
  leadDays,
  lookaheadDays,
}) {
  const realized = clamp(Number(realizedRatio) || 0, 0, 1);

  if (forecastRatio == null || !Number.isFinite(Number(forecastRatio))) {
    return {
      demandIndex: realized,
      forecastWeight: 0,
      signalSource: 'REALTIME_OCCUPANCY',
    };
  }

  const forecast = clamp(Number(forecastRatio), 0, 1);
  const horizon = Math.max(1, Number(lookaheadDays) || 1);
  const forecastWeight = clamp(Math.max(0, Number(leadDays) || 0) / horizon, 0, 1);
  const blended = forecast * forecastWeight + realized * (1 - forecastWeight);

  let signalSource = 'BLENDED';
  if (forecastWeight <= 0.05) signalSource = 'REALTIME_OCCUPANCY';
  else if (forecastWeight >= 0.95) signalSource = 'AI_FORECAST';

  return {
    demandIndex: Math.max(realized, blended),
    forecastWeight,
    signalSource,
  };
}

/**
 * demandIndex -> phần trăm điều chỉnh, dốc tuyến tính từ ngưỡng ra biên.
 * Ngay tại ngưỡng mức điều chỉnh bằng 0 nên giá không nhảy bậc khi nhu cầu
 * dao động quanh ranh giới.
 */
function demandToAdjustmentPercent(demandIndex, policy) {
  const index = clamp(Number(demandIndex) || 0, 0, 1);

  if (index >= policy.highDemandThreshold) {
    const span = 1 - policy.highDemandThreshold;
    const ratio = span <= 0 ? 1 : (index - policy.highDemandThreshold) / span;
    return {
      percent: policy.maxSurchargePercent * clamp(ratio, 0, 1),
      demandLevel: 'PEAK',
    };
  }

  if (index <= policy.lowDemandThreshold) {
    const span = policy.lowDemandThreshold;
    const ratio = span <= 0 ? 1 : (policy.lowDemandThreshold - index) / span;
    return {
      percent: -policy.maxDiscountPercent * clamp(ratio, 0, 1),
      demandLevel: 'QUIET',
    };
  }

  return { percent: 0, demandLevel: 'NORMAL' };
}

// Làm tròn về bội số gần nhất, nhưng luôn kẹp lại trong [floor, ceiling] để
// bước làm tròn không thể đẩy giá vượt hàng rào của đối tác.
function roundWithinBounds(price, step, floorPrice, ceilingPrice) {
  const safeStep = Math.max(1, Math.round(step));
  let rounded = Math.round(price / safeStep) * safeStep;
  if (rounded > ceilingPrice) rounded = Math.floor(ceilingPrice / safeStep) * safeStep;
  if (rounded < floorPrice) rounded = Math.ceil(floorPrice / safeStep) * safeStep;
  return clamp(rounded, floorPrice, ceilingPrice);
}

/**
 * Hàm quyết định giá. Thuần tuý: cùng đầu vào luôn cho cùng một báo giá, nên
 * mọi hàng rào đều kiểm thử được mà không cần CSDL.
 *
 * Trả về `applied=false` kèm `reason` cho mọi trường hợp không điều chỉnh, để
 * đối tác luôn đọc được vì sao AI đứng yên.
 */
function quotePrice({
  basePrice,
  policy: rawPolicy,
  realizedRatio,
  forecastRatio = null,
  forecastConfidence = 'LOW',
  leadDays,
  modelVersion = null,
  forecastGeneratedAt = null,
}) {
  const policy = normalizePolicy(rawPolicy);
  const base = parseVndInteger(basePrice);
  const realized = clamp(Number(realizedRatio) || 0, 0, 1);

  const noChange = (reason, extra = {}) => ({
    applied: false,
    basePrice: base,
    finalPrice: base,
    adjustmentPercent: 0,
    demandLevel: 'NORMAL',
    demandIndex: realized,
    realizedRatio: realized,
    forecastRatio: null,
    signalSource: 'NONE',
    confidence: forecastConfidence,
    leadTimeDays: Number.isFinite(leadDays) ? leadDays : 0,
    modelVersion: null,
    forecastGeneratedAt: null,
    mode: policy.mode,
    reason,
    ...extra,
  });

  if (base === null) return noChange('Giá niêm yết không phải số nguyên VND hợp lệ.');
  if (!policy.enabled) return noChange('Đối tác chưa bật giá động cho điểm tham quan này.');

  const lead = Number.isFinite(leadDays) ? Math.trunc(leadDays) : null;
  if (lead === null || lead < 0) {
    return noChange('Ngày tham quan không hợp lệ để tính giá động.');
  }
  if (lead > policy.lookaheadDays) {
    return noChange(
      `Ngày tham quan còn cách ${lead} ngày, vượt tầm dự báo ${policy.lookaheadDays} ngày nên giữ giá niêm yết.`,
    );
  }

  const hasForecast = forecastRatio != null && Number.isFinite(Number(forecastRatio));
  // Chặn tín hiệu yếu TRƯỚC khi đụng vào giá. Khi còn xa ngày tham quan mà dự
  // báo không đủ tin cậy thì mức lấp đầy thực tế cũng chưa nói lên gì, nên
  // đứng yên là lựa chọn đúng.
  const effectiveConfidence = hasForecast ? forecastConfidence : 'LOW';
  if (
    (CONFIDENCE_RANK[effectiveConfidence] ?? 0) < (CONFIDENCE_RANK[policy.minConfidence] ?? 1)
    && lead > 0
  ) {
    return noChange(
      hasForecast
        ? 'Độ tin cậy của dự báo thấp hơn ngưỡng tối thiểu nên giá giữ nguyên.'
        : 'Chưa có dự báo AI hợp lệ cho ngày này nên giá giữ nguyên.',
    );
  }

  const { demandIndex, forecastWeight, signalSource } = blendDemandIndex({
    realizedRatio: realized,
    forecastRatio: hasForecast ? forecastRatio : null,
    leadDays: lead,
    lookaheadDays: policy.lookaheadDays,
  });

  const { percent, demandLevel } = demandToAdjustmentPercent(demandIndex, policy);

  // Hai ràng buộc phải cùng được tôn trọng: hàng rào tuyệt đối (sàn/trần theo
  // % giá niêm yết) và biên điều chỉnh tối đa của chính sách. `rawPrice` vốn đã
  // nằm trong biên, nhưng bước làm tròn có thể đẩy nó vượt ra — nên bounds đưa
  // cho hàm làm tròn phải là giao của cả hai.
  const floorPrice = Math.max(
    Math.ceil((base * policy.priceFloorPercent) / 100),
    Math.ceil((base * (100 - policy.maxDiscountPercent)) / 100),
  );
  const ceilingPrice = Math.min(
    Math.floor((base * policy.priceCeilingPercent) / 100),
    Math.floor((base * (100 + policy.maxSurchargePercent)) / 100),
  );
  const rawPrice = base * (1 + percent / 100);
  let finalPrice = roundWithinBounds(rawPrice, policy.roundingStep, floorPrice, ceilingPrice);
  finalPrice = Math.max(finalPrice, Math.min(MIN_ADJUSTED_UNIT_PRICE, base));

  // Bất biến cuối cùng, mạnh hơn mọi bước ở trên: quyết định giảm giá không bao
  // giờ được làm giá tăng, và ngược lại. Với gói vé rẻ hơn cả bước làm tròn,
  // các phép kẹp/làm tròn phía trên có thể lật ngược hướng điều chỉnh.
  if (percent < 0) finalPrice = Math.min(finalPrice, base);
  if (percent > 0) finalPrice = Math.max(finalPrice, base);

  const parsedFinal = parseVndInteger(finalPrice);
  const effectivePercent = parsedFinal === null || base === 0
    ? 0
    : Number((((parsedFinal - base) / base) * 100).toFixed(2));

  const quote = {
    basePrice: base,
    finalPrice: parsedFinal === null ? base : parsedFinal,
    adjustmentPercent: parsedFinal === null ? 0 : effectivePercent,
    demandLevel,
    demandIndex: Number(demandIndex.toFixed(4)),
    realizedRatio: Number(realized.toFixed(4)),
    forecastRatio: hasForecast ? Number(clamp(Number(forecastRatio), 0, 1).toFixed(4)) : null,
    forecastWeight: Number(forecastWeight.toFixed(4)),
    signalSource: hasForecast ? signalSource : 'REALTIME_OCCUPANCY',
    confidence: effectiveConfidence,
    leadTimeDays: lead,
    modelVersion: hasForecast ? modelVersion : null,
    forecastGeneratedAt: hasForecast ? forecastGeneratedAt : null,
    mode: policy.mode,
  };

  if (quote.finalPrice === base) {
    return {
      ...quote,
      applied: false,
      adjustmentPercent: 0,
      reason: demandLevel === 'NORMAL'
        ? 'Nhu cầu dự báo nằm trong vùng trung tính nên giữ giá niêm yết.'
        : 'Mức điều chỉnh sau khi làm tròn không đổi so với giá niêm yết.',
    };
  }

  // SUGGEST_ONLY: AI vẫn tính đầy đủ và đối tác xem được đề xuất, nhưng khách
  // hàng trả đúng giá niêm yết. Đây là bước "chạy thử" trước khi giao quyền
  // quyết định giá cho mô hình.
  if (policy.mode !== 'AUTO_APPLY') {
    return {
      ...quote,
      applied: false,
      suggestedPrice: quote.finalPrice,
      suggestedPercent: quote.adjustmentPercent,
      finalPrice: base,
      adjustmentPercent: 0,
      reason: `Đang ở chế độ chỉ đề xuất: AI gợi ý ${quote.adjustmentPercent > 0 ? '+' : ''}${quote.adjustmentPercent}% nhưng chưa áp vào giá bán.`,
    };
  }

  return {
    ...quote,
    applied: true,
    reason: buildReason(quote),
  };
}

function buildReason(quote) {
  const percentText = `${quote.adjustmentPercent > 0 ? '+' : ''}${quote.adjustmentPercent}%`;
  const occupancyText = `${Math.round(quote.demandIndex * 100)}%`;
  const sourceText = {
    AI_FORECAST: 'dự báo AI',
    BLENDED: 'dự báo AI kết hợp lượng vé đã bán',
    REALTIME_OCCUPANCY: 'lượng vé đã bán thực tế',
    NONE: 'không có tín hiệu',
  }[quote.signalSource] || 'tín hiệu nhu cầu';

  if (quote.demandLevel === 'PEAK') {
    return `Cao điểm: ${sourceText} cho thấy mức lấp đầy khoảng ${occupancyText} nên phụ thu ${percentText}.`;
  }
  if (quote.demandLevel === 'QUIET') {
    // "giảm -15%" là phủ định kép; mức giảm đã mang nghĩa âm trong câu chữ.
    return `Giờ vắng: ${sourceText} cho thấy mức lấp đầy chỉ khoảng ${occupancyText} nên giảm ${Math.abs(quote.adjustmentPercent)}% để kích cầu.`;
  }
  return `Nhu cầu trung bình (${occupancyText}), điều chỉnh ${percentText}.`;
}

// ------------------------------------------------------------
// Truy xuất dữ liệu
// ------------------------------------------------------------

async function getPolicy(attractionId, client = prisma) {
  const stored = await client.dynamicPricingPolicy.findUnique({
    where: { attractionId },
  });
  return describeRuntimePolicy(stored || { attractionId });
}

/**
 * Suy ra độ tin cậy của một dòng RevenueForecast.
 * - HIGH: model AI thật, đủ dữ liệu lịch sử.
 * - MEDIUM: model AI nhưng nền dữ liệu mỏng.
 * - LOW: baseline fallback (không phải AI) -> mặc định sẽ không được đụng giá.
 */
function forecastConfidenceOf(row) {
  if (!row) return 'LOW';
  if (row.usedFallback) return 'LOW';
  if (Number(row.observedDays || 0) >= 21 && Number(row.sampleBookings || 0) >= 60) {
    return 'HIGH';
  }
  return 'MEDIUM';
}

async function getForecastForDate(attractionId, date, client = prisma) {
  const row = await client.revenueForecast.findUnique({
    where: { attractionId_forecastDate: { attractionId, forecastDate: date } },
  });
  if (!row) return null;
  return {
    predictedTickets: Number(row.predictedTickets || 0),
    confidence: forecastConfidenceOf(row),
    modelVersion: row.modelVersion || null,
    generatedAt: row.generatedAt || null,
  };
}

function occupancyRatio(used, capacity) {
  const total = Number(capacity || 0);
  if (total <= 0) return 1; // Hết sức chứa -> coi như đã đầy, không bao giờ giảm giá.
  return clamp(Number(used || 0) / total, 0, 1);
}

/**
 * Báo giá cho toàn bộ khung giờ của một lịch bán (schedule) trong một ngày.
 *
 * Dùng chung cho ba nơi để cả ba không bao giờ lệch nhau:
 *   - checkAvailability: giá hiển thị cho khách
 *   - reserveTickets:    giá chốt vào snapshot (nguồn chân lý)
 *   - pricing preview:   bảng giá đối tác xem trước
 */
async function quoteSchedule(client, { schedule, date, now = new Date(), policy = null }) {
  const attractionId = schedule.attraction.id;
  const configuredPolicy = policy
    ? describeRuntimePolicy(policy)
    : await getPolicy(attractionId, client);
  const resolvedPolicy = applyRuntimeSafety(configuredPolicy);
  const basePrice = schedule.product.sellingPrice;
  const lead = leadTimeDays(date, now);

  const slotIds = schedule.slots.map((slot) => slot.id);
  const [dailyStock, attractionStock, slotStocks, forecast] = await Promise.all([
    client.dailyStock.findUnique({
      where: { ticketProductId_date: { ticketProductId: schedule.product.id, date } },
    }),
    client.attractionDailyStock.findUnique({
      where: { attractionId_date: { attractionId, date } },
    }),
    slotIds.length > 0
      ? client.timeSlotStock.findMany({ where: { timeSlotId: { in: slotIds }, date } })
      : Promise.resolve([]),
    resolvedPolicy.enabled
      ? getForecastForDate(attractionId, date, client)
      : Promise.resolve(null),
  ]);

  // Tỷ lệ lấp đầy cấp ngày lấy theo kho của điểm tham quan (dùng chung cho mọi
  // gói vé) — sát với "hôm đó có đông không" hơn là kho riêng của một gói vé.
  const dayUsed = Number(attractionStock?.bookedQty || 0) + Number(attractionStock?.heldQty || 0);
  const dayRatio = occupancyRatio(dayUsed, schedule.dayCapacity);
  const forecastRatio = forecast && schedule.dayCapacity > 0
    ? clamp(forecast.predictedTickets / schedule.dayCapacity, 0, 1)
    : null;

  const stockBySlot = new Map((slotStocks || []).map((stock) => [stock.timeSlotId, stock]));

  const quoteWith = (realizedRatio) => quotePrice({
    basePrice,
    policy: resolvedPolicy,
    realizedRatio,
    forecastRatio,
    forecastConfidence: forecast?.confidence || 'LOW',
    leadDays: lead,
    modelVersion: forecast?.modelVersion || null,
    forecastGeneratedAt: forecast?.generatedAt || null,
  });

  if (schedule.slots.length === 0) {
    const productUsed = Number(dailyStock?.bookedQuantity || 0)
      + Number(dailyStock?.heldQuantity || 0);
    const productRatio = Math.max(
      dayRatio,
      occupancyRatio(productUsed, getProductCapacity(schedule)),
    );
    return {
      policy: configuredPolicy,
      byTimeSlotId: new Map(),
      allDay: quoteWith(productRatio),
    };
  }

  const byTimeSlotId = new Map();
  schedule.slots.forEach((slot) => {
    const stock = stockBySlot.get(slot.id);
    const slotUsed = Number(stock?.bookedQty || 0) + Number(stock?.heldQty || 0);
    // Khung giờ chật hơn cả ngày thì tín hiệu của khung giờ mới là cái quyết
    // định: một suất chiều đã kín vẫn phải phụ thu dù cả ngày còn trống.
    const slotRatio = Math.max(
      dayRatio,
      occupancyRatio(slotUsed, getSlotCapacity(schedule, slot)),
    );
    byTimeSlotId.set(slot.id, quoteWith(slotRatio));
  });

  return { policy: configuredPolicy, byTimeSlotId, allDay: null };
}

function quoteForSlot(quotes, timeSlotId) {
  if (!quotes) return null;
  if (!timeSlotId) return quotes.allDay;
  return quotes.byTimeSlotId.get(timeSlotId) || quotes.allDay;
}

// Rút gọn báo giá thành phần hiển thị cho khách: chỉ những gì cần để hiểu vì
// sao giá khác giá niêm yết, không lộ tham số chính sách của đối tác.
function toPublicQuote(quote) {
  if (!quote || !quote.applied) return null;
  return {
    unitPrice: quote.finalPrice,
    basePrice: quote.basePrice,
    adjustmentPercent: quote.adjustmentPercent,
    demandLevel: quote.demandLevel,
    label: quote.demandLevel === 'QUIET'
      ? `Giá giờ vắng ${quote.adjustmentPercent}%`
      : `Phụ thu cao điểm +${quote.adjustmentPercent}%`,
    reason: quote.reason,
  };
}

// ------------------------------------------------------------
// Cấu hình & báo cáo cho đối tác
// ------------------------------------------------------------

async function savePolicy({ attractionId, payload, actorId, client = prisma }) {
  const current = await client.dynamicPricingPolicy.findUnique({ where: { attractionId } });
  // Field nào không gửi thì giữ nguyên giá trị đang chạy, tránh việc một form
  // thiếu field vô tình reset cả chính sách về mặc định.
  const merged = normalizePolicy({ ...(current || {}), ...(payload || {}), attractionId });
  if (
    merged.enabled
    && merged.mode === 'AUTO_APPLY'
    && !isAutoApplyAllowed()
  ) {
    const error = new Error(
      'Chế độ tự áp giá đang bị khóa ở cấp hệ thống. Hãy dùng chế độ chỉ đề xuất.',
    );
    error.statusCode = 409;
    error.code = 'DYNAMIC_PRICING_AUTO_APPLY_DISABLED';
    throw error;
  }
  const data = {
    enabled: merged.enabled,
    mode: merged.mode,
    highDemandThreshold: merged.highDemandThreshold,
    lowDemandThreshold: merged.lowDemandThreshold,
    maxSurchargePercent: merged.maxSurchargePercent,
    maxDiscountPercent: merged.maxDiscountPercent,
    priceFloorPercent: merged.priceFloorPercent,
    priceCeilingPercent: merged.priceCeilingPercent,
    roundingStep: merged.roundingStep,
    lookaheadDays: merged.lookaheadDays,
    minConfidence: merged.minConfidence,
    updatedById: actorId || null,
  };

  const saved = await client.dynamicPricingPolicy.upsert({
    where: { attractionId },
    create: { attractionId, ...data },
    update: data,
  });
  return describeRuntimePolicy(saved);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// Nửa đêm giờ VN của ngày tham quan, biểu diễn dưới dạng cột @db.Date.
function vietnamDateOnly(now) {
  const key = new Date(new Date(now).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * Bảng giá dự kiến N ngày tới cho toàn bộ gói vé của một điểm tham quan.
 *
 * Chạy hoàn toàn trong bộ nhớ sau vài truy vấn gom theo khoảng ngày, thay vì
 * gọi lại đường dẫn báo giá cho từng (gói vé × ngày × khung giờ) — nếu không
 * một bảng 14 ngày sẽ tạo ra hàng trăm truy vấn.
 */
async function previewPricing({ attractionId, days = 14, now = new Date(), client = prisma }) {
  const horizon = intInRange(days, 14, 1, 60);
  const startDate = vietnamDateOnly(now);
  const endDate = addDays(startDate, horizon - 1);
  const policy = await getPolicy(attractionId, client);
  // Bảng xem trước luôn trả lời câu hỏi "AI sẽ làm gì với giá?", kể cả khi giá
  // động đang tắt — nếu không, đối tác không có cơ sở nào để quyết định có bật
  // hay không. Trạng thái thật (enabled/mode) được trả về nguyên vẹn ở
  // `policy` để giao diện nói rõ bảng này đã có hiệu lực hay chưa.
  const evaluationPolicy = normalizePolicy({
    ...policy,
    enabled: true,
    mode: 'AUTO_APPLY',
  });

  const products = await client.ticketProduct.findMany({
    where: { attractionId, archivedAt: null, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    include: {
      timeSlots: { where: { isActive: true }, orderBy: { startTime: 'asc' } },
      attraction: {
        include: {
          partner: { select: { status: true, commissionRate: true } },
          specialDates: { where: { date: { gte: startDate, lte: endDate } } },
          timeSlots: {
            where: { ticketProductId: null, isActive: true },
            orderBy: { startTime: 'asc' },
          },
        },
      },
    },
  });

  if (products.length === 0) {
    return { policy, forecastDays: 0, products: [] };
  }

  const productIds = products.map((product) => product.id);
  const slotIds = [
    ...new Set(products.flatMap((product) => [
      ...product.timeSlots.map((slot) => slot.id),
      ...product.attraction.timeSlots.map((slot) => slot.id),
    ])),
  ];
  const dateRange = { gte: startDate, lte: endDate };

  const [attractionStocks, dailyStocks, slotStocks, forecasts] = await Promise.all([
    client.attractionDailyStock.findMany({ where: { attractionId, date: dateRange } }),
    client.dailyStock.findMany({ where: { ticketProductId: { in: productIds }, date: dateRange } }),
    slotIds.length > 0
      ? client.timeSlotStock.findMany({ where: { timeSlotId: { in: slotIds }, date: dateRange } })
      : Promise.resolve([]),
    client.revenueForecast.findMany({
      where: { attractionId, forecastDate: dateRange },
    }),
  ]);

  const keyOf = (date) => new Date(date).toISOString().slice(0, 10);
  const attractionStockByDate = new Map(attractionStocks.map((row) => [keyOf(row.date), row]));
  const dailyStockByKey = new Map(dailyStocks.map((row) => [`${row.ticketProductId}|${keyOf(row.date)}`, row]));
  const slotStockByKey = new Map(slotStocks.map((row) => [`${row.timeSlotId}|${keyOf(row.date)}`, row]));
  const forecastByDate = new Map(forecasts.map((row) => [keyOf(row.forecastDate), {
    predictedTickets: Number(row.predictedTickets || 0),
    confidence: forecastConfidenceOf(row),
    modelVersion: row.modelVersion || null,
    generatedAt: row.generatedAt || null,
  }]));

  const previewProducts = products.map((product) => {
    const dayRows = [];

    for (let offset = 0; offset < horizon; offset += 1) {
      const date = addDays(startDate, offset);
      const dateKey = keyOf(date);
      const scopedProduct = {
        ...product,
        attraction: {
          ...product.attraction,
          specialDates: product.attraction.specialDates.filter(
            (special) => keyOf(special.date) === dateKey,
          ),
        },
      };
      const schedule = buildScheduleFromProduct(scopedProduct, date);

      if (!schedule || schedule.isClosed) {
        dayRows.push({ date: dateKey, closed: true, slots: [] });
        continue;
      }

      const forecast = forecastByDate.get(dateKey) || null;
      const forecastRatio = forecast && schedule.dayCapacity > 0
        ? clamp(forecast.predictedTickets / schedule.dayCapacity, 0, 1)
        : null;
      const attractionStock = attractionStockByDate.get(dateKey);
      const dayRatio = occupancyRatio(
        Number(attractionStock?.bookedQty || 0) + Number(attractionStock?.heldQty || 0),
        schedule.dayCapacity,
      );
      const lead = leadTimeDays(date, now);

      const quoteWith = (realizedRatio) => quotePrice({
        basePrice: product.sellingPrice,
        policy: evaluationPolicy,
        realizedRatio,
        forecastRatio,
        forecastConfidence: forecast?.confidence || 'LOW',
        leadDays: lead,
        modelVersion: forecast?.modelVersion || null,
        forecastGeneratedAt: forecast?.generatedAt || null,
      });

      const slotQuotes = schedule.slots.length > 0
        ? schedule.slots.map((slot) => {
            const stock = slotStockByKey.get(`${slot.id}|${dateKey}`);
            const realized = Math.max(
              dayRatio,
              occupancyRatio(
                Number(stock?.bookedQty || 0) + Number(stock?.heldQty || 0),
                getSlotCapacity(schedule, slot),
              ),
            );
            return {
              timeSlotId: slot.id,
              label: `${slot.startTime} - ${slot.endTime}`,
              quote: quoteWith(realized),
            };
          })
        : [(() => {
            const stock = dailyStockByKey.get(`${product.id}|${dateKey}`);
            const realized = Math.max(
              dayRatio,
              occupancyRatio(
                Number(stock?.bookedQuantity || 0) + Number(stock?.heldQuantity || 0),
                getProductCapacity(schedule),
              ),
            );
            return {
              timeSlotId: null,
              label: 'Vé sử dụng trong ngày',
              quote: quoteWith(realized),
            };
          })()];

      const prices = slotQuotes.map((entry) => entry.quote.finalPrice);
      // Khung giờ được điều chỉnh mạnh nhất là dòng đại diện cho cả ngày: đó
      // là thứ đối tác cần nhìn thấy đầu tiên khi rà soát.
      const representative = slotQuotes.reduce(
        (best, entry) => (
          Math.abs(entry.quote.adjustmentPercent) > Math.abs(best.quote.adjustmentPercent)
            ? entry
            : best
        ),
        slotQuotes[0],
      );

      dayRows.push({
        date: dateKey,
        closed: false,
        dayCapacity: schedule.dayCapacity,
        leadTimeDays: lead,
        demandLevel: representative.quote.demandLevel,
        demandIndex: representative.quote.demandIndex,
        forecastRatio: representative.quote.forecastRatio,
        realizedRatio: representative.quote.realizedRatio,
        confidence: representative.quote.confidence,
        signalSource: representative.quote.signalSource,
        applied: representative.quote.applied,
        adjustmentPercent: representative.quote.adjustmentPercent,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        reason: representative.quote.reason,
        slots: slotQuotes.map((entry) => ({
          timeSlotId: entry.timeSlotId,
          label: entry.label,
          price: entry.quote.finalPrice,
          adjustmentPercent: entry.quote.adjustmentPercent,
          demandLevel: entry.quote.demandLevel,
          applied: entry.quote.applied,
        })),
      });
    }

    return {
      ticketProductId: product.id,
      name: product.name,
      listedPrice: parseVndInteger(product.sellingPrice),
      days: dayRows,
    };
  });

  return {
    policy,
    // Bảng xem trước có đang là giá khách thật sự trả hay không.
    live: policy.enabled && policy.effectiveMode === 'AUTO_APPLY',
    forecastDays: forecastByDate.size,
    products: previewProducts,
  };
}

/**
 * Tổng hợp tác động thật của giá động: bao nhiêu lượt giữ chỗ bị đổi giá,
 * chênh lệch doanh thu ròng là bao nhiêu, tách theo cao điểm / giờ vắng.
 */
async function getPricingImpact({ attractionId, days = 30, now = new Date(), client = prisma }) {
  const horizon = intInRange(days, 30, 1, 365);
  const since = addDays(vietnamDateOnly(now), -(horizon - 1));

  const rows = await client.dynamicPriceAdjustment.findMany({
    where: { attractionId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      visitDate: true,
      basePrice: true,
      finalPrice: true,
      adjustmentPercent: true,
      quantity: true,
      demandLevel: true,
      demandIndex: true,
      confidence: true,
      signalSource: true,
      leadTimeDays: true,
      reason: true,
      createdAt: true,
      ticketProduct: { select: { name: true } },
    },
  });

  const summary = {
    days: horizon,
    totalAdjustments: rows.length,
    peakCount: 0,
    quietCount: 0,
    surchargeRevenue: 0,
    discountGiven: 0,
    netRevenueDelta: 0,
    adjustedTickets: 0,
  };

  rows.forEach((row) => {
    const delta = (Number(row.finalPrice) - Number(row.basePrice)) * Number(row.quantity || 1);
    summary.netRevenueDelta += delta;
    summary.adjustedTickets += Number(row.quantity || 1);
    if (row.demandLevel === 'PEAK') {
      summary.peakCount += 1;
      summary.surchargeRevenue += delta;
    } else if (row.demandLevel === 'QUIET') {
      summary.quietCount += 1;
      summary.discountGiven += Math.abs(delta);
    }
  });

  return {
    summary: {
      ...summary,
      surchargeRevenue: Math.round(summary.surchargeRevenue),
      discountGiven: Math.round(summary.discountGiven),
      netRevenueDelta: Math.round(summary.netRevenueDelta),
    },
    adjustments: rows.map((row) => ({
      id: row.id,
      ticketName: row.ticketProduct?.name || '',
      visitDate: new Date(row.visitDate).toISOString().slice(0, 10),
      basePrice: Number(row.basePrice),
      finalPrice: Number(row.finalPrice),
      adjustmentPercent: Number(row.adjustmentPercent),
      quantity: row.quantity,
      demandLevel: row.demandLevel,
      demandIndex: row.demandIndex,
      confidence: row.confidence,
      signalSource: row.signalSource,
      leadTimeDays: row.leadTimeDays,
      reason: row.reason,
      createdAt: row.createdAt,
    })),
  };
}

module.exports = {
  DEFAULT_POLICY,
  MIN_ADJUSTED_UNIT_PRICE,
  applyRuntimeSafety,
  describeRuntimePolicy,
  getPricingImpact,
  previewPricing,
  savePolicy,
  blendDemandIndex,
  demandToAdjustmentPercent,
  forecastConfidenceOf,
  getForecastForDate,
  getPolicy,
  isAutoApplyAllowed,
  leadTimeDays,
  normalizePolicy,
  occupancyRatio,
  quoteForSlot,
  quotePrice,
  quoteSchedule,
  roundWithinBounds,
  toPublicQuote,
};
