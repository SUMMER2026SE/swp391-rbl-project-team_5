'use strict';

// ============================================================
// aiAssistantService.js
// ------------------------------------------------------------
// 3 chức năng AI chính (không tính dự đoán doanh thu):
//
//   1. chatWithUser(message, history)
//      - Chatbot tư vấn dịch vụ & chính sách nền tảng.
//
//   2. recommendAttractions({ city, budget, people/adults/children,
//      interests, priority, companion })
//      - Gợi ý địa điểm tham quan + combo vé theo nhiều tiêu chí.
//
//   3. generateItinerary({ city, days, budget, people/adults/children,
//      interests, pace, priority, companion })
//      - Tạo kế hoạch tham quan nhiều ngày.
//
// Tất cả đều: lấy dữ liệu thật từ DB (qua aiCatalogService) ->
// chấm điểm/xếp lịch theo tiêu chí khách chọn -> trả JSON có
// cấu trúc cho controller. LLM chỉ dùng để sinh tiêu đề + mẹo
// (ít token) trong generateItinerary.
// ============================================================

const { generateJSON, generateText } = require('./llmClient');
const { getCatalogSummary } = require('./aiCatalogService');
const { PLATFORM_POLICY_TEXT } = require('./platformPolicy');

const AI_UNAVAILABLE_REPLY =
  'Trợ lý AI hiện chưa được cấu hình hoặc đang tạm thời không khả dụng. Bạn vẫn có thể xem chính sách đặt vé, hoàn vé trong phần trợ giúp hoặc tạo Support Ticket để nhân viên hỗ trợ trực tiếp.';

// ------------------------------------------------------------
// Tiêu chí gợi ý (giá trị hợp lệ + mặc định)
// ------------------------------------------------------------
const ALLOWED_PRIORITY = ['balanced', 'rating', 'budget'];
const ALLOWED_COMPANION = ['solo', 'couple', 'family', 'friends'];
const ALLOWED_PACE = ['relaxed', 'normal', 'packed'];

// Số điểm tối đa mỗi ngày theo nhịp độ chuyến đi.
const PACE_MAX_PER_DAY = { relaxed: 2, normal: 3, packed: 4 };

// Khung giờ gợi ý trong ngày (đủ cho nhịp độ "dày đặc" = 4 điểm).
const DAY_SLOTS = ['Sáng', 'Trưa', 'Chiều', 'Tối'];
const DAY_TIMES = ['08:00 - 11:00', '11:30 - 13:30', '14:00 - 17:00', '18:00 - 21:00'];

function timeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Khoảng [phút bắt đầu, phút kết thúc] của từng khung giờ trong ngày.
const DAY_SLOT_RANGES = DAY_TIMES.map((label) => {
  const [start, end] = label.split(' - ');
  return { start: timeToMinutes(start), end: timeToMinutes(end) };
});

/**
 * Địa điểm có mở cửa xuyên suốt khung giờ slotIndex không?
 * Không rõ giờ (null) -> coi như mở (không loại oan).
 */
function isOpenDuringSlot(attraction, slotIndex) {
  const open = timeToMinutes(attraction.openTime);
  const close = timeToMinutes(attraction.closeTime);
  if (open == null || close == null) return true;
  const slot = DAY_SLOT_RANGES[slotIndex];
  if (!slot || slot.start == null || slot.end == null) return true;
  return open <= slot.start && close >= slot.end;
}

// Đọc toạ độ an toàn: null/undefined/'' -> NaN (KHÔNG phải 0), để điểm thiếu
// toạ độ được coi là "không rõ vị trí" thay vì bị đặt nhầm ở (0,0).
function coordValue(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/** Khoảng cách đường chim bay (km) giữa 2 điểm; Infinity nếu thiếu toạ độ. */
function haversineKm(a, b) {
  const lat1 = coordValue(a?.latitude);
  const lng1 = coordValue(a?.longitude);
  const lat2 = coordValue(b?.latitude);
  const lng2 = coordValue(b?.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;

  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Loại hình ưu tiên theo nhóm đi cùng (đặt đúng gu để khách dễ chịu).
const COMPANION_CATEGORY_PREF = {
  family: ['Theme Park & Resort', 'Amusement Park', 'Nature & Sightseeing'],
  couple: ['Nature & Sightseeing', 'Cultural Experience'],
  friends: ['Adventure', 'Theme Park & Resort', 'Amusement Park'],
  solo: [],
};

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Chuẩn hoá số người: ưu tiên adults/children nếu có, nếu không
 * thì suy từ people (giữ tương thích ngược với client cũ).
 *
 * @returns {{ adults: number, children: number, total: number }}
 */
function normalizeParty({ people, adults, children }) {
  const a = Number(adults);
  const c = Number(children);
  const hasSplit = Number.isFinite(a) || Number.isFinite(c);

  if (hasSplit) {
    const adultsN = Number.isFinite(a) && a > 0 ? Math.floor(a) : 0;
    const childrenN = Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
    const total = adultsN + childrenN;
    if (total > 0) return { adults: adultsN, children: childrenN, total };
  }

  const p = Number(people);
  const totalP = Number.isFinite(p) && p > 0 ? Math.floor(p) : 1;
  return { adults: totalP, children: 0, total: totalP };
}

function getCheapestTicket(attraction) {
  if (!Array.isArray(attraction?.tickets) || attraction.tickets.length === 0) {
    return null;
  }

  return attraction.tickets.reduce(
    (min, ticket) => (Number(ticket.price) < Number(min.price) ? ticket : min),
    attraction.tickets[0],
  );
}

function pickCheapestByType(tickets, type) {
  const ofType = tickets.filter((t) => t.type === type);
  if (ofType.length === 0) return null;
  return ofType.reduce((min, t) => (Number(t.price) < Number(min.price) ? t : min), ofType[0]);
}

/**
 * Tính giá nhóm cho 1 địa điểm theo số người lớn/trẻ em.
 * - Người lớn dùng vé ADULT rẻ nhất (fallback: vé rẻ nhất bất kỳ).
 * - Trẻ em dùng vé CHILD rẻ nhất (fallback: vé người lớn).
 *
 * @returns {null | { adultTicket, childTicket, adultUnit, childUnit, total }}
 */
function buildGroupPricing(attraction, party) {
  const tickets = Array.isArray(attraction?.tickets) ? attraction.tickets : [];
  if (tickets.length === 0) return null;

  const cheapestOverall = getCheapestTicket(attraction);
  const adultTicket = pickCheapestByType(tickets, 'ADULT') || cheapestOverall;
  const childTicket = pickCheapestByType(tickets, 'CHILD') || adultTicket;

  const adultUnit = Number(adultTicket.price);
  const childUnit = Number(childTicket.price);
  const total = adultUnit * party.adults + childUnit * party.children;

  return { adultTicket, childTicket, adultUnit, childUnit, total };
}

/**
 * Chấm điểm 1 địa điểm theo tiêu chí khách chọn.
 * - priority 'rating': cộng mạnh theo đánh giá.
 * - priority 'budget': càng rẻ so với ngân sách càng cao điểm.
 * - companion: cộng điểm nếu loại hình hợp với nhóm đi cùng.
 */
function scoreAttraction(a, { priority, companion, groupPrice, budget }) {
  const rating = a.rating || 0;
  const reviews = a.totalReviews || 0;
  let score = rating * 10 + reviews * 0.01;

  if (groupPrice != null && budget > 0 && groupPrice <= budget) score += 20;

  if (priority === 'rating') {
    score += rating * 15;
  } else if (priority === 'budget' && groupPrice != null && budget > 0) {
    // groupPrice càng nhỏ so với budget -> bonus càng lớn (tối đa 25).
    score += Math.max(0, 1 - groupPrice / budget) * 25;
  }

  const prefs = COMPANION_CATEGORY_PREF[companion] || [];
  if (prefs.length && Array.isArray(a.categories)) {
    if (a.categories.some((name) => prefs.includes(name))) score += 8;
  }

  return score;
}

function buildComboItems(pricing, party) {
  const items = [];
  const line = (ticket, quantity, unitPrice) => ({
    ticketId: ticket.id,
    ticketName: ticket.name,
    quantity,
    unitPrice,
    subtotal: unitPrice * quantity,
  });

  // Nếu trẻ em không có vé riêng (dùng chung vé người lớn) thì gộp 1 dòng.
  const sameTicket = pricing.childTicket.id === pricing.adultTicket.id;
  if (sameTicket) {
    items.push(line(pricing.adultTicket, party.total, pricing.adultUnit));
    return items;
  }

  if (party.adults > 0) items.push(line(pricing.adultTicket, party.adults, pricing.adultUnit));
  if (party.children > 0) items.push(line(pricing.childTicket, party.children, pricing.childUnit));
  return items;
}

function buildReason(pricing, party) {
  const parts = [`giá từ ${pricing.adultUnit.toLocaleString('vi-VN')}đ/người lớn`];
  if (party.children > 0 && pricing.childTicket.id !== pricing.adultTicket.id) {
    parts.push(`${pricing.childUnit.toLocaleString('vi-VN')}đ/trẻ em`);
  }
  return parts.join(', ');
}

function describeParty(party) {
  const segments = [];
  if (party.adults > 0) segments.push(`${party.adults} người lớn`);
  if (party.children > 0) segments.push(`${party.children} trẻ em`);
  return segments.join(' + ') || `${party.total} người`;
}

const CHATBOT_SYSTEM_PROMPT = `
Bạn là trợ lý ảo của VietTicket Travel — nền tảng đặt vé tham quan trực tuyến tại Việt Nam.
Nhiệm vụ: tư vấn khách hàng về dịch vụ, chính sách đặt vé/hoàn vé/thanh toán, và hỗ trợ chung.
Trả lời bằng tiếng Việt, ngắn gọn, thân thiện, chính xác.
Chỉ dựa vào thông tin chính sách được cung cấp dưới đây — không bịa thêm chính sách không có.

${PLATFORM_POLICY_TEXT}
`.trim();

/**
 * Chatbot tư vấn khách hàng.
 *
 * @param {string} message - Câu hỏi/tin nhắn mới nhất của khách.
 * @param {Array<{ role: 'user'|'assistant', content: string }>} [history]
 *        Lịch sử hội thoại gần nhất (tối đa nên giới hạn ~10 lượt).
 * @returns {Promise<{ reply: string, provider: string }>}
 */
async function chatWithUser(message, history = []) {
  if (!message || !message.trim()) {
    throw new Error('Nội dung tin nhắn không được để trống');
  }

  const trimmedHistory = history
    .filter((item) => item && ['user', 'assistant'].includes(item.role))
    .slice(-10);
  const historyText = trimmedHistory
    .map((h) => {
      const content = String(h.content || h.message || h.text || '').trim();
      return content ? `${h.role === 'user' ? 'Khách' : 'Trợ lý'}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');

  const userPrompt = [
    historyText ? `LỊCH SỬ HỘI THOẠI:\n${historyText}\n` : '',
    `CÂU HỎI MỚI CỦA KHÁCH:\n${message.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const { text, provider } = await generateText(CHATBOT_SYSTEM_PROMPT, userPrompt, {
      temperature: 0.5,
      maxOutputTokens: 1024,
    });

    return { reply: text.trim(), provider };
  } catch (error) {
    console.error('[aiAssistant] Chat provider unavailable:', error.message);
    return { reply: AI_UNAVAILABLE_REPLY, provider: 'fallback' };
  }
}

// ------------------------------------------------------------
// 2. Gợi ý địa điểm + combo vé theo nhiều tiêu chí
// ------------------------------------------------------------

/**
 * Gợi ý địa điểm tham quan + combo vé theo budget, số người và sở thích.
 *
 * @param {object} params
 * @param {number} params.budget - Tổng số tiền khách có (VND).
 * @param {number} [params.people] - Tổng số người (tương thích ngược).
 * @param {number} [params.adults] - Số người lớn.
 * @param {number} [params.children] - Số trẻ em.
 * @param {string} [params.city] - Thành phố/khu vực mong muốn.
 * @param {string} [params.interests] - Loại hình ưa thích (CSV).
 * @param {string} [params.priority] - 'balanced' | 'rating' | 'budget'.
 * @param {string} [params.companion] - 'solo' | 'couple' | 'family' | 'friends'.
 * @returns {Promise<{ data: object, provider: string }>}
 */
async function recommendAttractions({
  budget,
  people,
  adults,
  children,
  city,
  interests,
  priority,
  companion,
}) {
  if (!budget || budget <= 0) throw new Error('Vui lòng cung cấp ngân sách (budget) hợp lệ');

  const party = normalizeParty({ people, adults, children });
  if (party.total <= 0) throw new Error('Vui lòng cung cấp số người (people) hợp lệ');

  const priorityKey = normalizeEnum(priority, ALLOWED_PRIORITY, 'balanced');
  const companionKey = normalizeEnum(companion, ALLOWED_COMPANION, 'solo');

  const catalog = await getCatalogSummary({ city, category: interests, limit: 6 });

  if (catalog.length === 0) {
    return {
      data: { recommendedAttractions: [], combos: [], overallSummary: 'Hiện chưa có điểm tham quan phù hợp. Vui lòng thử khu vực khác.' },
      provider: 'none',
    };
  }

  // Chọn địa điểm bằng rule-based scoring (không dùng LLM để tránh token limit).
  const scored = catalog.map((a) => {
    const pricing = buildGroupPricing(a, party);
    const groupPrice = pricing ? pricing.total : null;
    const score = scoreAttraction(a, { priority: priorityKey, companion: companionKey, groupPrice, budget });
    return { ...a, pricing, groupPrice, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const provider = 'rule-based';
  const selected = [];
  let remainingBudget = budget;

  for (const attraction of scored) {
    if (selected.length >= 3) break;
    if (!attraction.pricing || attraction.groupPrice == null) continue;
    if (attraction.groupPrice > remainingBudget) continue;

    selected.push(attraction);
    remainingBudget -= attraction.groupPrice;
  }

  const recommended = selected.map((a) => ({
    attractionId: a.id,
    title: a.title,
    reason: `Đánh giá ${a.rating || 0}/5, ${buildReason(a.pricing, party)}`,
  }));

  // Mỗi "combo" = gói vé rẻ nhất của 1 điểm tham quan cho cả nhóm
  // (tách dòng người lớn/trẻ em), không phải gói gộp nhiều điểm.
  // Giữ nguyên tên field vì frontend và test đang dựa vào contract này.
  const combos = selected.map((a) => ({
    attractionId: a.id,
    attractionTitle: a.title,
    items: buildComboItems(a.pricing, party),
    totalPrice: a.groupPrice,
  }));

  const grandTotal = combos.reduce((sum, c) => sum + c.totalPrice, 0);
  const partyText = describeParty(party);
  const overallSummary = combos.length > 0
    ? `Đề xuất ${combos.length} điểm tham quan với tổng chi phí vé ước tính ${grandTotal.toLocaleString('vi-VN')}đ cho ${partyText}, trong ngân sách ${budget.toLocaleString('vi-VN')}đ.`
    : `Chưa tìm thấy combo vé phù hợp trong ngân sách ${budget.toLocaleString('vi-VN')}đ cho ${partyText}. Bạn có thể tăng ngân sách hoặc thử khu vực khác.`;

  return {
    data: {
      recommendedAttractions: recommended,
      combos,
      overallSummary,
    },
    provider,
  };
}

// ------------------------------------------------------------
// 3. Tạo kế hoạch tham quan nhiều ngày
// ------------------------------------------------------------

/**
 * Chọn địa điểm cho 1 khung giờ trong ngày:
 *  - Phải còn ngân sách và đang mở cửa trong khung giờ đó (#1).
 *  - Nếu đã có điểm trước đó: ưu tiên điểm GẦN nhất (tối ưu tuyến #2).
 *  - Nếu là điểm đầu ngày: ưu tiên điểm điểm số cao nhất (đúng gu).
 * Trả về index trong `available` hoặc -1.
 */
function pickEntryForSlot(available, slotIndex, remainingBudget, refAttraction) {
  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < available.length; i++) {
    const entry = available[i];
    if (entry.groupPrice == null || entry.groupPrice > remainingBudget) continue;
    if (!isOpenDuringSlot(entry.attraction, slotIndex)) continue;

    // Có điểm trước -> ưu tiên GẦN nhất (tối ưu tuyến). Khoảng cách bằng nhau
    // hoặc thiếu toạ độ (Infinity) -> rớt về điểm số cao nhất. Luôn chọn được
    // một ứng viên hợp lệ nếu tồn tại (không bỏ trống khung giờ oan).
    const dist = refAttraction ? haversineKm(refAttraction, entry.attraction) : Number.POSITIVE_INFINITY;
    const better =
      bestIndex === -1 ||
      dist < bestDist ||
      (dist === bestDist && entry.score > bestScore);
    if (better) {
      bestIndex = i;
      bestDist = dist;
      bestScore = entry.score;
    }
  }

  return bestIndex;
}

/** Toạ độ trung tâm của 1 ngày (để tìm phương án thay thế gần khu vực). */
function dayCentroid(entries) {
  const coords = entries
    .map((e) => e.attraction)
    .filter((a) => Number.isFinite(coordValue(a?.latitude)) && Number.isFinite(coordValue(a?.longitude)));
  if (coords.length === 0) return null;
  const lat = coords.reduce((s, a) => s + coordValue(a.latitude), 0) / coords.length;
  const lng = coords.reduce((s, a) => s + coordValue(a.longitude), 0) / coords.length;
  return { latitude: lat, longitude: lng };
}

/**
 * Tạo kế hoạch tham quan nhiều ngày theo nhiều tiêu chí.
 *
 * @param {object} params
 * @param {string} params.city - Thành phố/khu vực muốn tham quan.
 * @param {number} params.days - Số ngày tham quan.
 * @param {number} [params.budget] - Ngân sách (VND).
 * @param {number} [params.people] - Tổng số người (tương thích ngược).
 * @param {number} [params.adults] - Số người lớn.
 * @param {number} [params.children] - Số trẻ em.
 * @param {string} [params.interests] - Loại hình ưa thích (CSV).
 * @param {string} [params.pace] - 'relaxed' | 'normal' | 'packed'.
 * @param {string} [params.priority] - 'balanced' | 'rating' | 'budget'.
 * @param {string} [params.companion] - 'solo' | 'couple' | 'family' | 'friends'.
 * @returns {Promise<{ data: object, provider: string }>}
 */
async function generateItinerary({
  city,
  days,
  budget,
  people,
  adults,
  children,
  interests,
  pace,
  priority,
  companion,
}) {
  if (!city || !city.trim()) throw new Error('Vui lòng cung cấp khu vực/thành phố (city)');
  if (!days || days <= 0) throw new Error('Vui lòng cung cấp số ngày (days) hợp lệ');

  const party = normalizeParty({ people, adults, children });
  const priorityKey = normalizeEnum(priority, ALLOWED_PRIORITY, 'balanced');
  const companionKey = normalizeEnum(companion, ALLOWED_COMPANION, 'solo');
  const paceKey = normalizeEnum(pace, ALLOWED_PACE, 'normal');

  const catalog = await getCatalogSummary({ city, category: interests, limit: 30 });

  if (catalog.length === 0) {
    return {
      data: {
        title: `Kế hoạch tham quan ${city}`,
        days: [],
        estimatedCost: { perPerson: 0, total: 0, note: 'Chưa có dữ liệu điểm tham quan cho khu vực này.' },
        tips: [],
      },
      provider: 'none',
    };
  }

  // Xếp hạng địa điểm theo tiêu chí để điểm "đúng gu" được ưu tiên trước.
  const ranked = catalog
    .map((a) => {
      const pricing = buildGroupPricing(a, party);
      const groupPrice = pricing ? pricing.total : null;
      const score = scoreAttraction(a, { priority: priorityKey, companion: companionKey, groupPrice, budget });
      return { attraction: a, pricing, groupPrice, score };
    })
    .sort((x, y) => y.score - x.score);

  const maxPerDay = PACE_MAX_PER_DAY[paceKey] || 3;
  const available = [...ranked];
  const dayPlans = [];
  const dayCentroids = [];
  const budgetLimit = Number(budget);
  let remainingBudget = Number.isFinite(budgetLimit) && budgetLimit > 0
    ? budgetLimit
    : Number.POSITIVE_INFINITY;

  // ---- Pha A: xếp hoạt động chính cho từng ngày ----
  // Mỗi ngày duyệt khung giờ theo thứ tự thời gian; mỗi khung giờ chọn điểm
  // đang mở cửa (#1) và gần điểm trước đó nhất (tối ưu tuyến #2).
  for (let d = 1; d <= days; d++) {
    if (available.length === 0) break;

    const dayEntries = [];
    const activities = [];
    let lastAttraction = null;

    for (let s = 0; s < maxPerDay; s++) {
      const idx = pickEntryForSlot(available, s, remainingBudget, lastAttraction);
      if (idx === -1) continue; // không có điểm hợp khung giờ/ngân sách -> để trống khung này
      const entry = available.splice(idx, 1)[0];
      remainingBudget -= entry.groupPrice;
      lastAttraction = entry.attraction;
      dayEntries.push(entry);
      activities.push({
        attractionId: entry.attraction.id,
        title: entry.attraction.title,
        timeSlot: DAY_SLOTS[s] || `Hoạt động ${s + 1}`,
        suggestedTime: DAY_TIMES[s] || 'Thời gian linh hoạt',
        estimatedCost: entry.groupPrice,
        notes: entry.attraction.openTime
          ? `Mở cửa ${entry.attraction.openTime} - ${entry.attraction.closeTime || '17:00'}`
          : 'Kiểm tra giờ mở cửa trước khi đến',
      });
    }

    if (activities.length === 0) break; // hết điểm hợp lệ -> tránh tạo ngày rỗng

    dayCentroids.push(dayCentroid(dayEntries) || lastAttraction);
    dayPlans.push({ day: d, theme: `Ngày ${d} tại ${city}`, activities, alternatives: [] });
  }

  // ---- Pha B: kế hoạch B (#3) — tối đa 2 điểm dự phòng gần khu vực mỗi ngày ----
  // Lấy từ pool còn lại sau khi đã xếp xong hoạt động chính, không trùng giữa các ngày.
  dayPlans.forEach((plan, i) => {
    const centroid = dayCentroids[i];
    const sorted = [...available].sort((x, y) => {
      const dx = haversineKm(centroid, x.attraction);
      const dy = haversineKm(centroid, y.attraction);
      if (dx === dy) return y.score - x.score; // thiếu toạ độ -> theo điểm số
      return dx - dy;
    });
    for (const alt of sorted) {
      if (plan.alternatives.length >= 2) break;
      plan.alternatives.push({
        attractionId: alt.attraction.id,
        title: alt.attraction.title,
        reason: `Phương án thay thế gần khu vực, đánh giá ${alt.attraction.rating || 0}/5`,
      });
      const removeIdx = available.indexOf(alt);
      if (removeIdx !== -1) available.splice(removeIdx, 1);
    }
  });

  // Ước tính chi phí — cộng đúng giá nhóm đã dùng để xếp lịch (gồm cả
  // giá vé trẻ em), tránh lệch/0đ khi minPrice (minTicketPrice) null/stale.
  const usedActivities = dayPlans.flatMap((d) => d.activities);
  const totalGroupCost = usedActivities.reduce((sum, a) => sum + (a.estimatedCost || 0), 0);
  const perPerson = party.total > 0 ? Math.round(totalGroupCost / party.total) : totalGroupCost;
  const estimatedCost = {
    perPerson,
    total: totalGroupCost,
    note: Number.isFinite(budgetLimit) && budgetLimit > 0
      ? `Chỉ tính giá vé tham quan cho ${describeParty(party)}, chưa gồm ăn uống và di chuyển. Ngân sách dự kiến: ${budgetLimit.toLocaleString('vi-VN')}đ.`
      : `Chỉ tính giá vé tham quan cho ${describeParty(party)}, chưa gồm ăn uống và di chuyển`,
  };

  // Dùng LLM chỉ để generate title + tips (output ngắn, ít token).
  const TIPS_PROMPT = `Bạn là hướng dẫn viên du lịch. Trả về JSON ngắn gọn:
{"title":"Tên kế hoạch hấp dẫn cho ${days} ngày tại ${city}","tips":["mẹo 1","mẹo 2","mẹo 3"]}`;

  let title = `Khám phá ${city} ${days} ngày`;
  let tips = [];
  let provider = 'rule-based';

  try {
    const { data: llmData, provider: llmProvider } = await generateJSON(
      TIPS_PROMPT,
      `Khu vực: ${city}, Số ngày: ${days}, Nhóm: ${describeParty(party)}, Nhịp độ: ${paceKey}, Sở thích: ${interests || 'đa dạng'}`,
      { temperature: 0.5, maxOutputTokens: 256 }
    );
    title = llmData.title || title;
    tips = llmData.tips || [];
    provider = llmProvider;
  } catch {
    // fallback: giữ title/tips mặc định nếu LLM lỗi
  }

  // Cập nhật theme cho từng ngày bằng tên attraction nổi bật.
  dayPlans.forEach((d) => {
    if (d.activities.length > 0) {
      d.theme = `Tham quan ${d.activities.map((a) => a.title).join(' & ')}`;
    }
  });

  return {
    data: { title, days: dayPlans, estimatedCost, tips },
    provider,
  };
}

module.exports = {
  chatWithUser,
  recommendAttractions,
  generateItinerary,
};
