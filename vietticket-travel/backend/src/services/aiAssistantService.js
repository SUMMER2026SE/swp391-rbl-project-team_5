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
//      - Gợi ý địa điểm tham quan + gói vé theo nhiều tiêu chí.
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
const prisma = require('../config/prisma');
const {
  decorateCatalogAvailability,
  getCatalogSummary,
  inferCatalogFiltersFromText,
} = require('./aiCatalogService');
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

function parseDateOnly(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

// Trả về ngày hiện tại theo giờ Việt Nam (UTC+7) dạng Date UTC.
function todayVietnam() {
  const now = new Date();
  // Shift về múi giờ +7 để xác định "hôm nay" đúng theo người dùng VN.
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  // Cắt về 00:00:00 UTC của ngày VN đó.
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}

/**
 * Parse ngày từ tin nhắn tự nhiên tiếng Việt.
 * Hỗ trợ:
 *   - ISO: YYYY-MM-DD
 *   - DD/MM/YYYY hoặc DD-MM-YYYY
 *   - "hôm nay", "ngày mai", "mai", "ngày kia", "mốt"
 *   - "thứ 2/ba/tư/năm/sáu/bảy/CN" (tuần này hoặc tuần tới nếu đã qua)
 *   - "cuối tuần", "thứ bảy", "chủ nhật"
 *   - "tuần sau", "tuần tới" (+ 7 ngày từ hôm nay)
 *
 * Luôn trả về ngày >= hôm nay.
 * Trả về Date (UTC 00:00) hoặc null nếu không nhận ra.
 */
function extractDateFromMessage(message) {
  const raw = String(message || '');

  // --- 1. ISO YYYY-MM-DD (ưu tiên cao nhất) ---
  const isoMatch = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return parseDateOnly(isoMatch[1]);

  // --- 2. DD/MM/YYYY hoặc DD-MM-YYYY ---
  const dmyMatch = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return parseDateOnly(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }

  // Chuẩn hoá bỏ dấu để so sánh.
  const norm = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

  const today = todayVietnam();

  const addDaysFromToday = (n) => {
    const d = new Date(today.getTime());
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };

  // --- 3. Các mốc tương đối ---
  if (/\b(hom nay|today)\b/.test(norm)) return today;
  if (/\b(ngay mai|mai|tomorrow)\b/.test(norm)) return addDaysFromToday(1);
  if (/\b(ngay kia|mot)\b/.test(norm)) return addDaysFromToday(2);

  // --- 4. "tuần sau" / "tuần tới" (không kèm thứ cụ thể) ---
  if (/\b(tuan sau|tuan toi|next week)\b/.test(norm) && !/thu (hai|ba|tu|nam|sau|bay)|chu nhat/.test(norm)) {
    return addDaysFromToday(7);
  }

  // --- 5. Thứ trong tuần ---
  // Map: thứ 2=1, thứ 3=2, ..., thứ 7=6, CN=0 (theo JS getUTCDay)
  const DOW_MAP = [
    { re: /\b(thu hai|thu 2|monday)\b/, dow: 1 },
    { re: /\b(thu ba|thu 3|tuesday)\b/, dow: 2 },
    { re: /\b(thu tu|thu 4|wednesday)\b/, dow: 3 },
    { re: /\b(thu nam|thu 5|thursday)\b/, dow: 4 },
    { re: /\b(thu sau|thu 6|friday)\b/, dow: 5 },
    { re: /\b(thu bay|thu 7|saturday|cuoi tuan)\b/, dow: 6 },
    { re: /\b(chu nhat|cn|sunday)\b/, dow: 0 },
  ];

  const isNextWeekHint = /\b(tuan sau|tuan toi|next week)\b/.test(norm);

  for (const { re, dow } of DOW_MAP) {
    if (!re.test(norm)) continue;
    const todayDow = today.getUTCDay();
    let diff = dow - todayDow;
    // Nếu ngày đó đã qua trong tuần này, hoặc client nói "tuần tới" -> +7.
    if (diff <= 0 || isNextWeekHint) diff += 7;
    return addDaysFromToday(diff);
  }

  return null;
}

function dateOnlyKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

function categoryNamesFromAttraction(attraction) {
  return (attraction?.categories || [])
    .map((item) => (typeof item === 'string' ? item : item?.category?.name || item?.name))
    .filter(Boolean);
}

function bumpCount(map, value, weight = 1) {
  const key = String(value || '').trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + weight);
}

function topWeightedValues(map, limit = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

async function loadUserTravelPreferences(userId) {
  if (!userId) return null;

  try {
    const [favorites, bookings] = await Promise.all([
      prisma.favoriteAttraction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          attraction: {
            select: {
              city: true,
              categories: { select: { category: { select: { name: true } } } },
            },
          },
        },
      }),
      prisma.booking.findMany({
        where: {
          userId,
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          snapshotAttractionCity: true,
          reservation: {
            select: {
              ticketProduct: {
                select: {
                  attraction: {
                    select: {
                      city: true,
                      categories: { select: { category: { select: { name: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const categoryWeights = new Map();
    const cityWeights = new Map();

    favorites.forEach((favorite) => {
      const attraction = favorite.attraction;
      bumpCount(cityWeights, attraction?.city, 2);
      categoryNamesFromAttraction(attraction).forEach((name) => bumpCount(categoryWeights, name, 2));
    });

    bookings.forEach((booking) => {
      const attraction = booking.reservation?.ticketProduct?.attraction;
      bumpCount(cityWeights, booking.snapshotAttractionCity || attraction?.city, 1);
      categoryNamesFromAttraction(attraction).forEach((name) => bumpCount(categoryWeights, name, 1));
    });

    const preferredCategories = topWeightedValues(categoryWeights);
    const preferredCities = topWeightedValues(cityWeights);

    if (preferredCategories.length === 0 && preferredCities.length === 0) return null;
    return { preferredCategories, preferredCities };
  } catch (error) {
    console.warn('[aiAssistant] User personalization unavailable:', error.message);
    return null;
  }
}

function personalizationBoost(attraction, preferences) {
  if (!preferences) return 0;

  let boost = 0;
  const categories = categoryNamesFromAttraction(attraction);
  if (categories.some((name) => preferences.preferredCategories?.includes(name))) boost += 12;
  if (preferences.preferredCities?.includes(attraction.city)) boost += 5;
  return boost;
}

function ticketAvailabilityLimit(ticket) {
  if (!ticket?.availabilityChecked) return null;
  const value = Number(ticket.availability?.availableTickets);
  return Number.isFinite(value) ? value : 0;
}

function hasTicketCapacity(ticket, quantity) {
  const needed = Math.max(0, Number(quantity) || 0);
  if (needed === 0) return true;
  const limit = ticketAvailabilityLimit(ticket);
  return limit == null || limit >= needed;
}

function hasSharedAttractionCapacity(tickets, quantity) {
  const needed = Math.max(0, Number(quantity) || 0);
  if (needed === 0) return true;
  const limits = tickets
    .map((ticket) => Number(ticket?.availability?.attractionAvailable))
    .filter(Number.isFinite);
  if (limits.length === 0) return true;
  return Math.min(...limits) >= needed;
}

function getCheapestTicket(attraction, quantity = 1) {
  if (!Array.isArray(attraction?.tickets) || attraction.tickets.length === 0) {
    return null;
  }

  const candidates = attraction.tickets.filter((ticket) => hasTicketCapacity(ticket, quantity));
  if (candidates.length === 0) return null;

  return candidates.reduce(
    (min, ticket) => (Number(ticket.price) < Number(min.price) ? ticket : min),
    candidates[0],
  );
}

function pickCheapestByType(tickets, type, quantity = 1) {
  const ofType = tickets.filter((t) => t.type === type && hasTicketCapacity(t, quantity));
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

  const cheapestOverall = getCheapestTicket(attraction, Math.max(1, party.total));
  const adultTicket = pickCheapestByType(tickets, 'ADULT', party.adults) || cheapestOverall;
  const childTicket = pickCheapestByType(tickets, 'CHILD', party.children) || adultTicket;
  if (!adultTicket || !childTicket) return null;

  const sameTicket = childTicket.id === adultTicket.id;
  if (sameTicket && !hasTicketCapacity(adultTicket, party.total)) return null;
  if (!sameTicket && !hasSharedAttractionCapacity([adultTicket, childTicket], party.total)) return null;

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
function scoreAttraction(a, { priority, companion, groupPrice, budget, preferences }) {
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

  score += personalizationBoost(a, preferences);

  return score;
}

// ------------------------------------------------------------
// P1-A: FIX slot mismatch
// Tìm time slot của ticket khớp với khung giờ slotIndex trong ngày.
// - Ưu tiên slot nằm trong (hoặc chồng lấp) DAY_SLOT_RANGES[slotIndex].
// - Trong các slot khớp, chọn slot có availableTickets nhiều nhất.
// - Fallback về bestSlot (slot nhiều vé nhất toàn ngày) nếu không có slot nào khớp.
// - Trả về null nếu không có availability data.
// ------------------------------------------------------------
function availabilitySlotOverlaps(slot, slotIndex) {
  if (!slot?.startTime || !slot?.endTime) return true;
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);
  const target = DAY_SLOT_RANGES[slotIndex];
  if (start == null || end == null || !target) return true;
  return start < target.end && end > target.start;
}

function pickSlotForIndex(ticket, slotIndex) {
  const avail = ticket?.availability;
  if (!avail) return null;

  const target = slotIndex != null ? DAY_SLOT_RANGES[slotIndex] : null;
  const slots = Array.isArray(avail.slots) ? avail.slots : [];

  // Nếu không có danh sách slots chi tiết, trả về bestSlot.
  if (slots.length === 0) {
    return avail.bestSlot || null;
  }

  // Lọc các slot chồng lấp với khung giờ đã chọn.
  const overlapping = target
    ? slots.filter((slot) => availabilitySlotOverlaps(slot, slotIndex))
    : slots;

  const pool = overlapping.length > 0 ? overlapping : slots;

  // Chọn slot có availableTickets cao nhất trong pool phù hợp.
  const best = pool.reduce(
    (acc, slot) =>
      Number(slot.availableTickets || 0) > Number(acc.availableTickets || 0) ? slot : acc,
    pool[0],
  );

  return best || avail.bestSlot || null;
}

function concreteSlotCapacity(slot) {
  if (!slot?.timeSlotId) return null;
  const value = Number(slot.slotAvailable ?? slot.availableTickets);
  return Number.isFinite(value) ? value : null;
}

function buildSelectedTicketLines(pricing, party, slotIndex) {
  if (!pricing) return [];

  const sameTicket = pricing.childTicket.id === pricing.adultTicket.id;
  const lines = [];
  const addLine = (ticket, quantity, unitPrice) => {
    const needed = Math.max(0, Number(quantity) || 0);
    if (needed <= 0) return;
    lines.push({
      ticket,
      quantity: needed,
      unitPrice,
      slot: pickSlotForIndex(ticket, slotIndex),
    });
  };

  if (sameTicket) {
    addLine(pricing.adultTicket, party.total, pricing.adultUnit);
    return lines;
  }

  addLine(pricing.adultTicket, party.adults, pricing.adultUnit);
  addLine(pricing.childTicket, party.children, pricing.childUnit);
  return lines;
}

function sharedConcreteSlotCapacityOk(lines) {
  const bySlotId = new Map();

  lines.forEach((line) => {
    const slotId = line.slot?.timeSlotId;
    if (!slotId) return;

    const current = bySlotId.get(slotId) || { quantity: 0, limits: [] };
    current.quantity += line.quantity;
    const limit = concreteSlotCapacity(line.slot);
    if (limit != null) current.limits.push(limit);
    bySlotId.set(slotId, current);
  });

  for (const item of bySlotId.values()) {
    if (item.limits.length === 0) continue;
    if (Math.min(...item.limits) < item.quantity) return false;
  }

  return true;
}

function pricingSupportsSelectedPackageSlots(pricing, party, slotIndex) {
  if (!pricing) return false;
  const lines = buildSelectedTicketLines(pricing, party, slotIndex);
  return sharedConcreteSlotCapacityOk(lines);
}

/**
 * Tạo danh sách dòng vé cho 1 địa điểm.
 * slotIndex: index của khung giờ trong ngày (0=sáng,1=trưa,2=chiều,3=tối).
 * Khi slotIndex được truyền, suggestedTimeSlot sẽ khớp đúng khung giờ đó
 * thay vì luôn trả về bestSlot chung của cả ngày (fix P1-A).
 */
function buildTicketPackageItems(pricing, party, slotIndex) {
  return buildSelectedTicketLines(pricing, party, slotIndex).map(
    ({ ticket, quantity, unitPrice, slot }) => ({
      ticketId: ticket.id,
      ticketName: ticket.name,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
      availabilityDate: ticket.availabilityDate || null,
      availableTickets: ticket.availability?.availableTickets ?? null,
      // suggestedTimeSlot giờ khớp đúng với slotIndex (buổi sáng/trưa/chiều/tối)
      // mà scheduler đã xếp, không còn trả về bestSlot chung của ngày.
      suggestedTimeSlot: slot
        ? {
            timeSlotId: slot.timeSlotId,
            startTime: slot.startTime,
            endTime: slot.endTime,
          }
        : null,
    }),
  );
}

function buildReason(pricing, party) {
  const parts = [`giá từ ${pricing.adultUnit.toLocaleString('vi-VN')}đ/người lớn`];
  if (party.children > 0 && pricing.childTicket.id !== pricing.adultTicket.id) {
    parts.push(`${pricing.childUnit.toLocaleString('vi-VN')}đ/trẻ em`);
  }
  return parts.join(', ');
}

function buildAvailabilityReason(pricing) {
  const checkedTickets = [pricing.adultTicket, pricing.childTicket].filter(
    (ticket, index, arr) =>
      ticket?.availabilityChecked && arr.findIndex((item) => item?.id === ticket.id) === index,
  );
  if (checkedTickets.length === 0) return '';

  const date = checkedTickets[0].availabilityDate;
  const minAvailable = Math.min(
    ...checkedTickets.map((ticket) => Number(ticket.availability?.availableTickets || 0)),
  );
  const suffix = date ? ` ngày ${date}` : '';
  return `, còn ít nhất ${minAvailable} vé phù hợp${suffix}`;
}

function ticketSupportsItinerarySlot(ticket, quantity, slotIndex) {
  if (!ticket?.availabilityChecked) return true;
  const needed = Math.max(0, Number(quantity) || 0);
  return (ticket.availability?.slots || []).some(
    (slot) => Number(slot.availableTickets || 0) >= needed && availabilitySlotOverlaps(slot, slotIndex),
  );
}

function pricingSupportsItinerarySlot(pricing, party, slotIndex) {
  if (!pricing) return false;
  if (pricing.adultTicket.id === pricing.childTicket.id) {
    return (
      ticketSupportsItinerarySlot(pricing.adultTicket, party.total, slotIndex) &&
      pricingSupportsSelectedPackageSlots(pricing, party, slotIndex)
    );
  }
  return (
    ticketSupportsItinerarySlot(pricing.adultTicket, party.adults, slotIndex) &&
    ticketSupportsItinerarySlot(pricing.childTicket, party.children, slotIndex) &&
    pricingSupportsSelectedPackageSlots(pricing, party, slotIndex)
  );
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

Nếu prompt có DU LIEU CATALOG THUC TE, được dùng để gợi ý địa điểm/vé thực tế và link nội bộ.
Nếu prompt có DU LIEU CA NHAN CUA KHACH, chỉ dùng để trả lời về đơn/vé/support của đúng khách đang đăng nhập.
Không tiết lộ QR token, mã bảo mật, session, hay dữ liệu không có trong prompt.

${PLATFORM_POLICY_TEXT}
`.trim();

function shouldAttachCatalogContext(message) {
  const normalized = normalizeSearchText(message);
  return [
    'dia diem',
    'tham quan',
    'goi y',
    'lich trinh',
    'du lich',
    'gia ve',
    'con ve',
    'combo',
    'da nang',
    'ha noi',
    'ho chi minh',
    'sai gon',
    'phu quoc',
    'nha trang',
    'da lat',
    'ha long',
    'ba na',
    'vinwonders',
    'sun world',
  ].some((keyword) => normalized.includes(keyword));
}

function formatCatalogContext(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) return '';

  const lines = catalog.slice(0, 5).map((attraction) => {
    const tickets = (attraction.tickets || [])
      .slice(0, 3)
      .map((ticket) => {
        const availabilityText = ticket.availabilityChecked
          ? ` | còn ${Number(ticket.availability?.availableTickets || 0)} vé ngày ${ticket.availabilityDate}`
          : '';
        const slotText = ticket.availability?.bestSlot
          ? ` | gợi ý khung giờ ${ticket.availability.bestSlot.startTime}-${ticket.availability.bestSlot.endTime}`
          : '';
        return `${ticket.name}: ${Number(ticket.price || 0).toLocaleString('vi-VN')} VND${availabilityText}${slotText}`;
      })
      .join('; ');
    return [
      `- ${attraction.title} (${attraction.city || 'Viet Nam'})`,
      `rating ${attraction.rating || 0}/5`,
      tickets ? `vé: ${tickets}` : 'chưa có vé phù hợp',
      `link: /attractions/${attraction.id}`,
    ].join(' | ');
  });

  return [
    'DU LIEU CATALOG THUC TE (chỉ dùng khi liên quan):',
    'Chỉ gợi ý địa điểm/vé nằm trong danh sách này. Nếu khách hỏi đơn hàng cá nhân mà không có DU LIEU CA NHAN CUA KHACH, hướng dẫn đăng nhập hoặc tạo Support Ticket.',
    ...lines,
  ].join('\n');
}

function shouldAttachPersonalContext(message) {
  const normalized = normalizeSearchText(message);
  return [
    've cua toi',
    'don cua toi',
    'don hang',
    'ma don',
    'booking',
    'trang thai',
    'thanh toan',
    'hoan tien',
    'hoan ve',
    'refund',
    'support',
    'ho tro',
    'khieu nai',
    'voucher',
    'ma uu dai',
    'qr',
    'check in',
    'checkin',
  ].some((keyword) => normalized.includes(keyword));
}

function toNumber(value) {
  if (value == null) return 0;
  const raw = typeof value?.toString === 'function' ? value.toString() : value;
  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}

function moneyText(value) {
  return `${toNumber(value).toLocaleString('vi-VN')} VND`;
}

function dateText(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function maskIdentifier(value, visible = 4) {
  const raw = String(value || '').trim();
  if (!raw) return 'an';
  if (raw.length <= visible * 2) {
    return `${raw.slice(0, Math.min(2, raw.length))}***`;
  }
  return `${raw.slice(0, visible)}...${raw.slice(-visible)}`;
}

function ticketStatusSummary(tickets) {
  const counts = (tickets || []).reduce((acc, ticket) => {
    const status = ticket?.status || 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const parts = Object.entries(counts).map(([status, count]) => `${status}:${count}`);
  return parts.length ? parts.join(', ') : 'chua phat hanh';
}

function formatPersonalBookingLine(booking) {
  const reservation = booking.reservation || {};
  const product = reservation.ticketProduct || {};
  const attraction = product.attraction || {};
  const title = booking.snapshotAttractionTitle || attraction.title || 'Diem tham quan';
  const ticketName = booking.snapshotTicketName || product.name || 'Ve tham quan';
  const visitDate = dateText(booking.snapshotVisitDate || reservation.date) || 'chua ro';
  const timeSlot = booking.snapshotTimeSlotLabel
    || (reservation.timeSlot ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}` : 'theo ngay');
  const refund = booking.refundRequests?.[0];
  const bookingRef = maskIdentifier(booking.id);
  const voucherText = booking.voucher?.code ? ' | voucher: co ap dung' : '';
  const refundText = refund ? ` | refund: ${refund.status}` : '';

  return [
    `- ma don: ${bookingRef}`,
    booking.status,
    title,
    `ve: ${ticketName}`,
    `ngay: ${visitDate}`,
    `gio: ${timeSlot}`,
    `so luong: ${reservation.quantity || 0}`,
    `tong: ${moneyText(booking.totalAmount)}`,
    `tickets: ${ticketStatusSummary(booking.ticketInstances)}`,
    'link: /my-tickets',
    'support: /support',
  ].join(' | ') + voucherText + refundText;
}

function formatPersonalSupportLine(ticket) {
  return [
    `- ma ho tro: ${maskIdentifier(ticket.id)}`,
    ticket.status,
    ticket.subject,
    ticket.bookingId ? `booking: ${maskIdentifier(ticket.bookingId)}` : 'booking: none',
    `cap nhat: ${dateText(ticket.updatedAt) || 'chua ro'}`,
    'link: /my-support',
  ].join(' | ');
}

async function buildChatPersonalContext(message, userContext) {
  if (!userContext?.userId || !shouldAttachPersonalContext(message)) return '';

  try {
    const [bookings, supportTickets] = await Promise.all([
      prisma.booking.findMany({
        where: { userId: userContext.userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          snapshotAttractionTitle: true,
          snapshotTicketName: true,
          snapshotVisitDate: true,
          snapshotTimeSlotLabel: true,
          voucher: { select: { code: true } },
          reservation: {
            select: {
              date: true,
              quantity: true,
              timeSlot: { select: { startTime: true, endTime: true } },
              ticketProduct: {
                select: {
                  name: true,
                  attraction: { select: { title: true, city: true } },
                },
              },
            },
          },
          refundRequests: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, amount: true, reason: true, createdAt: true },
          },
          ticketInstances: { select: { status: true } },
        },
      }),
      prisma.supportTicket.findMany({
        where: { userId: userContext.userId },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          status: true,
          subject: true,
          bookingId: true,
          updatedAt: true,
        },
      }),
    ]);

    const lines = [
      'DU LIEU CA NHAN CUA KHACH (chi dung khi khach hoi ve don/ve/support cua chinh ho; khong tiet lo QR/token):',
      'Khach dang nhap: da xac thuc',
      'Don gan nhat:',
      ...(bookings.length ? bookings.map(formatPersonalBookingLine) : ['- chua co don gan day']),
      'Support ticket gan nhat:',
      ...(supportTickets.length ? supportTickets.map(formatPersonalSupportLine) : ['- chua co support ticket gan day']),
      'Neu can thao tac moi nhu hoan tien/gui yeu cau, huong dan khach vao /my-tickets hoac /support.',
    ];

    return lines.join('\n');
  } catch (error) {
    console.warn('[aiAssistant] Personal chat context unavailable:', error.message);
    return '';
  }
}

async function buildChatCatalogContext(message) {
  if (!shouldAttachCatalogContext(message)) return '';

  try {
    const inferredFilters = inferCatalogFiltersFromText(message);
    // P1-B: extractDateFromMessage giờ hiểu cả ngày tự nhiên tiếng Việt.
    const visitDate = extractDateFromMessage(message);
    const catalog = await getCatalogSummary({
      city: inferredFilters.city || message,
      category: inferredFilters.category || message,
      date: visitDate || undefined,
      limit: 5,
    });
    return formatCatalogContext(catalog);
  } catch (error) {
    console.warn('[aiAssistant] Catalog context unavailable:', error.message);
    return '';
  }
}

/**
 * Chatbot tư vấn khách hàng.
 *
 * @param {string} message - Câu hỏi/tin nhắn mới nhất của khách.
 * @param {Array<{ role: 'user'|'assistant', content: string }>} [history]
 *        Lịch sử hội thoại gần nhất (tối đa nên giới hạn ~10 lượt).
 * @returns {Promise<{ reply: string, provider: string }>}
 */
async function chatWithUser(message, history = [], userContext = {}) {
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

  const [catalogContext, personalContext] = await Promise.all([
    buildChatCatalogContext(message),
    buildChatPersonalContext(message, userContext),
  ]);

  const userPrompt = [
    catalogContext,
    personalContext,
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
// 2. Gợi ý địa điểm + gói vé theo nhiều tiêu chí
// ------------------------------------------------------------

/**
 * Gợi ý địa điểm tham quan + gói vé theo budget, số người và sở thích.
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
  visitDate,
  date,
  userId,
}) {
  if (!budget || budget <= 0) throw new Error('Vui lòng cung cấp ngân sách (budget) hợp lệ');

  const party = normalizeParty({ people, adults, children });
  if (party.total <= 0) throw new Error('Vui lòng cung cấp số người (people) hợp lệ');

  const priorityKey = normalizeEnum(priority, ALLOWED_PRIORITY, 'balanced');
  const companionKey = normalizeEnum(companion, ALLOWED_COMPANION, 'solo');
  const travelDate = parseDateOnly(visitDate || date);
  const travelDateKey = dateOnlyKey(travelDate);

  const catalog = await getCatalogSummary({ city, category: interests, limit: 12, date: travelDate });

  if (catalog.length === 0) {
    return {
      data: {
        recommendedAttractions: [],
        ticketPackages: [],
        combos: [],
        overallSummary: 'Hiện chưa có điểm tham quan phù hợp. Vui lòng thử khu vực khác.',
      },
      provider: 'none',
    };
  }

  // Chọn địa điểm bằng rule-based scoring (không dùng LLM để tránh token limit).
  const preferences = await loadUserTravelPreferences(userId);

  const scored = catalog.map((a) => {
    const pricing = buildGroupPricing(a, party);
    const groupPrice = pricing ? pricing.total : null;
    const score = scoreAttraction(a, { priority: priorityKey, companion: companionKey, groupPrice, budget, preferences });
    return { ...a, pricing, groupPrice, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const provider = 'rule-based';
  const selected = [];
  let remainingBudget = budget;

  for (const attraction of scored) {
    if (selected.length >= 3) break;
    if (!attraction.pricing || attraction.groupPrice == null) continue;
    if (!pricingSupportsSelectedPackageSlots(attraction.pricing, party, undefined)) continue;
    if (attraction.groupPrice > remainingBudget) continue;

    selected.push(attraction);
    remainingBudget -= attraction.groupPrice;
  }

  const recommended = selected.map((a) => ({
    attractionId: a.id,
    title: a.title,
    availabilityDate: travelDateKey,
    availabilityNote: buildAvailabilityReason(a.pricing).replace(/^, /, ''),
    reason: `Đánh giá ${a.rating || 0}/5, ${buildReason(a.pricing, party)}`,
  }));

  // Mỗi gói vé là tập vé phù hợp cho 1 điểm tham quan và 1 nhóm khách
  // (tách dòng người lớn/trẻ em), không phải gói gộp nhiều điểm.
  // Giữ alias combos để tương thích contract cũ, nhưng client mới dùng ticketPackages.
  const ticketPackages = selected.map((a) => ({
    attractionId: a.id,
    attractionTitle: a.title,
    availabilityDate: travelDateKey,
    // recommend không có slotIndex cụ thể -> truyền undefined để dùng bestSlot.
    items: buildTicketPackageItems(a.pricing, party, undefined),
    packageType: 'SINGLE_ATTRACTION_GROUP_TICKETS',
    packageDescription: 'Gói vé cho một điểm tham quan, không phải combo nhiều địa điểm.',
    totalPrice: a.groupPrice,
  }));
  const combos = ticketPackages;

  const grandTotal = ticketPackages.reduce((sum, c) => sum + c.totalPrice, 0);
  const partyText = describeParty(party);
  const overallSummary = ticketPackages.length > 0
    ? `Đề xuất ${ticketPackages.length} điểm tham quan với tổng chi phí gói vé ước tính ${grandTotal.toLocaleString('vi-VN')}đ cho ${partyText}, trong ngân sách ${budget.toLocaleString('vi-VN')}đ.`
    : `Chưa tìm thấy gói vé phù hợp trong ngân sách ${budget.toLocaleString('vi-VN')}đ cho ${partyText}. Bạn có thể tăng ngân sách hoặc thử khu vực khác.`;

  return {
    data: {
      recommendedAttractions: recommended,
      ticketPackages,
      combos,
      availabilityChecked: Boolean(travelDateKey),
      availabilityDate: travelDateKey,
      availabilitySummary: travelDateKey
        ? `Đã kiểm tra tình trạng còn vé cho ngày ${travelDateKey}.`
        : 'Chưa kiểm tra tình trạng còn vé theo ngày cụ thể.',
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
function pickEntryForSlot(available, slotIndex, remainingBudget, refAttraction, party) {
  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < available.length; i++) {
    const entry = available[i];
    if (entry.groupPrice == null || entry.groupPrice > remainingBudget) continue;
    if (!isOpenDuringSlot(entry.attraction, slotIndex)) continue;
    if (party && !pricingSupportsItinerarySlot(entry.pricing, party, slotIndex)) continue;

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

// ------------------------------------------------------------
// P2-C: Cải thiện ước tính thời gian di chuyển
// Hệ số làm chậm giao thông theo từng thành phố (>1 = đông/kẹt hơn).
// Dựa trên TomTom Traffic Index 2024 cho các đô thị Việt Nam.
// ------------------------------------------------------------
const CITY_TRAFFIC_FACTOR = {
  // Đô thị lớn: kẹt xe nghiêm trọng
  'ho chi minh': 1.7,
  'hcm': 1.7,
  'sai gon': 1.7,
  'ha noi': 1.6,
  'hanoi': 1.6,
  // Đô thị vừa: trung bình
  'da nang': 1.25,
  'can tho': 1.3,
  'hai phong': 1.3,
  // Điểm du lịch: đường tốt, ít tắc
  'nha trang': 1.2,
  'da lat': 1.15,
  'phu quoc': 1.1,
  'hoi an': 1.2,
  'ha long': 1.2,
  'sapa': 1.15,
};

/**
 * Ước tính thời gian di chuyển (phút) dựa trên khoảng cách đường chim bay
 * và hệ số giao thông của thành phố. Tốt hơn tốc độ hằng số 22km/h.
 *
 * Giả định tốc độ trung bình nội đô lý tưởng = 35km/h,
 * sau đó nhân với traffic factor của thành phố.
 */
function estimateTravelMinutes(distanceKm, city) {
  if (!Number.isFinite(distanceKm)) return null;
  // Tốc độ xe máy/ô tô nội đô lý tưởng (không kẹt) ~35km/h.
  const BASE_SPEED_KMH = 35;
  const norm = String(city || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim();
  // Tìm city match (substring) để xử lý "Thành phố Hồ Chí Minh" -> "ho chi minh".
  const trafficFactor =
    Object.entries(CITY_TRAFFIC_FACTOR).find(([key]) => norm.includes(key))?.[1] ?? 1.4;
  return Math.max(5, Math.round((distanceKm / BASE_SPEED_KMH) * 60 * trafficFactor));
}

function buildRouteSegments(activities) {
  const segments = [];
  // Lấy city từ activity đầu tiên có city để áp traffic factor.
  const city = activities.find((a) => a.city)?.city || '';

  for (let i = 1; i < activities.length; i++) {
    const from = activities[i - 1];
    const to = activities[i];
    const distanceKm = haversineKm(from, to);
    if (!Number.isFinite(distanceKm)) continue;

    segments.push({
      fromAttractionId: from.attractionId,
      fromTitle: from.title,
      toAttractionId: to.attractionId,
      toTitle: to.title,
      distanceKm: Math.round(distanceKm * 10) / 10,
      estimatedTravelMinutes: estimateTravelMinutes(distanceKm, city),
      travelMode: 'driving_estimate',
      travelNote: 'Ước tính theo khoảng cách và điều kiện giao thông khu vực.',
    });
  }

  return segments;
}

function buildRouteSummary(routeSegments) {
  if (!Array.isArray(routeSegments) || routeSegments.length === 0) {
    return { totalDistanceKm: 0, totalTravelMinutes: 0, note: 'Chưa đủ tọa độ để ước tính tuyến đường.' };
  }

  return {
    totalDistanceKm: Math.round(routeSegments.reduce((sum, item) => sum + item.distanceKm, 0) * 10) / 10,
    totalTravelMinutes: routeSegments.reduce((sum, item) => sum + (item.estimatedTravelMinutes || 0), 0),
    note: 'Ước tính dựa trên khoảng cách thực tế và hệ số giao thông theo khu vực. Thời gian có thể dao động tuỳ tình trạng đường.',
  };
}

function withRouteInfo(dayPlan) {
  const routeSegments = buildRouteSegments(dayPlan.activities || []);
  return {
    ...dayPlan,
    routeSegments,
    routeSummary: buildRouteSummary(routeSegments),
  };
}

function buildRankedEntries(catalog, party, priorityKey, companionKey, budget, preferences) {
  return catalog
    .map((a) => {
      const pricing = buildGroupPricing(a, party);
      const groupPrice = pricing ? pricing.total : null;
      const score = scoreAttraction(a, { priority: priorityKey, companion: companionKey, groupPrice, budget, preferences });
      return { attraction: a, pricing, groupPrice, score };
    })
    .filter((entry) => entry.pricing && entry.groupPrice != null)
    .sort((x, y) => y.score - x.score);
}

function buildActivity(entry, party, slotIndex, visitDateKey) {
  return {
    attractionId: entry.attraction.id,
    title: entry.attraction.title,
    city: entry.attraction.city || null,
    district: entry.attraction.district || null,
    categories: entry.attraction.categories || [],
    latitude: entry.attraction.latitude ?? null,
    longitude: entry.attraction.longitude ?? null,
    visitDate: visitDateKey || null,
    timeSlot: DAY_SLOTS[slotIndex] || `Hoạt động ${slotIndex + 1}`,
    suggestedTime: DAY_TIMES[slotIndex] || 'Thời gian linh hoạt',
    estimatedCost: entry.groupPrice,
    // P1-A: Truyền slotIndex để pickSlotForIndex chọn đúng khung giờ cho từng vé.
    ticketItems: buildTicketPackageItems(entry.pricing, party, slotIndex),
    notes: entry.attraction.openTime
      ? `Mở cửa ${entry.attraction.openTime} - ${entry.attraction.closeTime || '17:00'}`
      : 'Kiểm tra giờ mở cửa trước khi đến',
  };
}

async function buildDateAwareDayPlans({
  baseCatalog,
  budget,
  city,
  companionKey,
  days,
  maxPerDay,
  party,
  preferences,
  priorityKey,
  startDate,
}) {
  const dayPlans = [];
  const dayCentroids = [];
  const usedAttractionIds = new Set();
  const budgetLimit = Number(budget);
  let remainingBudget = Number.isFinite(budgetLimit) && budgetLimit > 0
    ? budgetLimit
    : Number.POSITIVE_INFINITY;

  const rankForDate = async (visitDate) => {
    const availableBase = baseCatalog.filter((attraction) => !usedAttractionIds.has(attraction.id));
    const datedCatalog = await decorateCatalogAvailability(availableBase, visitDate);
    return buildRankedEntries(datedCatalog, party, priorityKey, companionKey, budget, preferences);
  };

  for (let d = 1; d <= days; d++) {
    const visitDate = addDays(startDate, d - 1);
    const visitDateKey = dateOnlyKey(visitDate);
    const available = await rankForDate(visitDate);
    if (available.length === 0) break;

    const dayEntries = [];
    const activities = [];
    let lastAttraction = null;

    for (let s = 0; s < maxPerDay; s++) {
      const idx = pickEntryForSlot(available, s, remainingBudget, lastAttraction, party);
      if (idx === -1) continue;
      const entry = available.splice(idx, 1)[0];
      remainingBudget -= entry.groupPrice;
      lastAttraction = entry.attraction;
      usedAttractionIds.add(entry.attraction.id);
      dayEntries.push(entry);
      activities.push(buildActivity(entry, party, s, visitDateKey));
    }

    if (activities.length === 0) break;

    dayCentroids.push(dayCentroid(dayEntries) || lastAttraction);
      dayPlans.push(withRouteInfo({
        day: d,
        visitDate: visitDateKey,
        theme: `Ngày ${d} tại ${city}`,
        activities,
        alternatives: [],
      }));
  }

  for (let i = 0; i < dayPlans.length; i++) {
    const plan = dayPlans[i];
    const visitDate = parseDateOnly(plan.visitDate);
    const centroid = dayCentroids[i];
    const alternatives = await rankForDate(visitDate);
    alternatives.sort((x, y) => {
      const dx = haversineKm(centroid, x.attraction);
      const dy = haversineKm(centroid, y.attraction);
      if (dx === dy) return y.score - x.score;
      return dx - dy;
    });

    for (const alt of alternatives) {
      if (plan.alternatives.length >= 2) break;
      usedAttractionIds.add(alt.attraction.id);
      plan.alternatives.push({
        attractionId: alt.attraction.id,
        title: alt.attraction.title,
        visitDate: plan.visitDate,
        reason: `Phương án thay thế còn vé ngày ${plan.visitDate}, đánh giá ${alt.attraction.rating || 0}/5`,
      });
    }
  }

  // P2-A: Tạo cảnh báo rõ ràng khi không đủ điểm để lấp đủ số ngày yêu cầu.
  let generationWarning = null;
  if (dayPlans.length < days) {
    const reason = remainingBudget <= 0
      ? 'đã vượt ngân sách'
      : 'không còn điểm tham quan phù hợp còn vé';
    generationWarning = `Chỉ tạo được ${dayPlans.length}/${days} ngày do ${reason}. Bạn có thể tăng ngân sách, chọn khu vực khác hoặc giảm số ngày.`;
  }

  return { dayPlans, budgetLimit, generationWarning };
}

async function generateItineraryTitleAndTips({ city, days, party, paceKey, interests }) {
  const fallback = {
    title: `Khám phá ${city} ${days} ngày`,
    tips: [],
    provider: 'rule-based',
  };

  const tipsPrompt = `Bạn là hướng dẫn viên du lịch. Trả về JSON ngắn gọn:
{"title":"Tên kế hoạch hấp dẫn cho ${days} ngày tại ${city}","tips":["mẹo 1","mẹo 2","mẹo 3"]}`;

  try {
    const { data: llmData, provider } = await generateJSON(
      tipsPrompt,
      `Khu vực: ${city}, Số ngày: ${days}, Nhóm: ${describeParty(party)}, Nhịp độ: ${paceKey}, Sở thích: ${interests || 'đa dạng'}`,
      { temperature: 0.5, maxOutputTokens: 256 },
    );

    return {
      title: typeof llmData?.title === 'string' && llmData.title.trim()
        ? llmData.title.trim()
        : fallback.title,
      tips: Array.isArray(llmData?.tips)
        ? llmData.tips.filter((tip) => typeof tip === 'string' && tip.trim()).slice(0, 5)
        : fallback.tips,
      provider: provider || fallback.provider,
    };
  } catch {
    return fallback;
  }
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
  startDate,
  visitDate,
  date,
  userId,
}) {
  if (!city || !city.trim()) throw new Error('Vui lòng cung cấp khu vực/thành phố (city)');
  if (!days || days <= 0) throw new Error('Vui lòng cung cấp số ngày (days) hợp lệ');

  const party = normalizeParty({ people, adults, children });
  const priorityKey = normalizeEnum(priority, ALLOWED_PRIORITY, 'balanced');
  const companionKey = normalizeEnum(companion, ALLOWED_COMPANION, 'solo');
  const paceKey = normalizeEnum(pace, ALLOWED_PACE, 'normal');
  const itineraryStartDate = parseDateOnly(startDate || visitDate || date);
  const itineraryStartDateKey = dateOnlyKey(itineraryStartDate);

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
  const maxPerDay = PACE_MAX_PER_DAY[paceKey] || 3;
  const preferences = await loadUserTravelPreferences(userId);

  if (itineraryStartDate) {
    const { dayPlans, generationWarning } = await buildDateAwareDayPlans({
      baseCatalog: catalog,
      budget,
      city,
      companionKey,
      days,
      maxPerDay,
      party,
      preferences,
      priorityKey,
      startDate: itineraryStartDate,
    });

    const usedActivities = dayPlans.flatMap((d) => d.activities);
    const totalGroupCost = usedActivities.reduce((sum, a) => sum + (a.estimatedCost || 0), 0);
    const perPerson = party.total > 0 ? Math.round(totalGroupCost / party.total) : totalGroupCost;
    const estimatedCost = {
      perPerson,
      total: totalGroupCost,
      note: `Đã kiểm tra còn vé từ ngày ${itineraryStartDateKey}. Chỉ tính giá vé tham quan cho ${describeParty(party)}, chưa gồm ăn uống và di chuyển.`,
    };

    dayPlans.forEach((d) => {
      if (d.activities.length > 0) {
        d.theme = `Tham quan ${d.activities.map((a) => a.title).join(' & ')}`;
      }
    });

    const aiCopy = await generateItineraryTitleAndTips({
      city,
      days,
      party,
      paceKey,
      interests,
    });

    const result = {
      data: {
        title: aiCopy.title,
        days: dayPlans,
        estimatedCost,
        tips: aiCopy.tips,
        availabilityChecked: true,
        startDate: itineraryStartDateKey,
      },
      provider: aiCopy.provider,
    };
    // P2-A: Đính kèm cảnh báo vào data nếu không tạo đủ số ngày.
    if (generationWarning) result.data.generationWarning = generationWarning;
    return result;
  }

  const ranked = catalog
    .map((a) => {
      const pricing = buildGroupPricing(a, party);
      const groupPrice = pricing ? pricing.total : null;
      const score = scoreAttraction(a, { priority: priorityKey, companion: companionKey, groupPrice, budget, preferences });
      return { attraction: a, pricing, groupPrice, score };
    })
    .sort((x, y) => y.score - x.score);

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
      const idx = pickEntryForSlot(available, s, remainingBudget, lastAttraction, party);
      if (idx === -1) continue; // không có điểm hợp khung giờ/ngân sách -> để trống khung này
      const entry = available.splice(idx, 1)[0];
      remainingBudget -= entry.groupPrice;
      lastAttraction = entry.attraction;
      dayEntries.push(entry);
      activities.push(buildActivity(entry, party, s, null));
    }

    if (activities.length === 0) break; // hết điểm hợp lệ -> tránh tạo ngày rỗng

    dayCentroids.push(dayCentroid(dayEntries) || lastAttraction);
    dayPlans.push(withRouteInfo({
      day: d,
      theme: `Ngày ${d} tại ${city}`,
      activities,
      alternatives: [],
    }));
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

  // P2-A: Cảnh báo khi không tạo đủ số ngày yêu cầu.
  let generationWarning = null;
  if (dayPlans.length < days) {
    const reason = remainingBudget <= 0
      ? 'đã vượt ngân sách'
      : 'không còn điểm tham quan phù hợp còn vé';
    generationWarning = `Chỉ tạo được ${dayPlans.length}/${days} ngày do ${reason}. Bạn có thể tăng ngân sách, chọn khu vực khác hoặc giảm số ngày.`;
  }

  const aiCopy = await generateItineraryTitleAndTips({
    city,
    days,
    party,
    paceKey,
    interests,
  });

  // Cập nhật theme cho từng ngày bằng tên attraction nổi bật.
  dayPlans.forEach((d) => {
    if (d.activities.length > 0) {
      d.theme = `Tham quan ${d.activities.map((a) => a.title).join(' & ')}`;
    }
  });

  const finalData = { title: aiCopy.title, days: dayPlans, estimatedCost, tips: aiCopy.tips };
  if (generationWarning) finalData.generationWarning = generationWarning;

  return {
    data: finalData,
    provider: aiCopy.provider,
  };
}

module.exports = {
  chatWithUser,
  recommendAttractions,
  generateItinerary,
};
