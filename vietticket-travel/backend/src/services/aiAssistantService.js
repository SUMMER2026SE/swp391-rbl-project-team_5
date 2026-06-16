'use strict';

// ============================================================
// aiAssistantService.js
// ------------------------------------------------------------
// 3 chức năng AI chính (không tính dự đoán doanh thu):
//
//   1. chatWithUser(message, history)
//      - Chatbot tư vấn dịch vụ & chính sách nền tảng.
//
//   2. recommendAttractions({ city, budget, people, interests })
//      - Gợi ý địa điểm tham quan + combo vé phù hợp với
//        số tiền và số người.
//
//   3. generateItinerary({ city, days, budget, people, interests })
//      - Tạo kế hoạch tham quan nhiều ngày.
//
// Tất cả đều: lấy dữ liệu thật từ DB (qua aiCatalogService) ->
// đưa vào prompt -> LLM trả JSON có cấu trúc -> service trả về
// cho controller.
// ============================================================

const { generateJSON, generateText } = require('./llmClient');
const { getCatalogSummary } = require('./aiCatalogService');
const { PLATFORM_POLICY_TEXT } = require('./platformPolicy');

const AI_UNAVAILABLE_REPLY =
  'Trợ lý AI hiện chưa được cấu hình hoặc đang tạm thời không khả dụng. Bạn vẫn có thể xem chính sách đặt vé, hoàn vé trong phần trợ giúp hoặc tạo Support Ticket để nhân viên hỗ trợ trực tiếp.';

function getCheapestTicket(attraction) {
  if (!Array.isArray(attraction?.tickets) || attraction.tickets.length === 0) {
    return null;
  }

  return attraction.tickets.reduce(
    (min, ticket) => (Number(ticket.price) < Number(min.price) ? ticket : min),
    attraction.tickets[0],
  );
}

function estimateAttractionGroupCost(attraction, people) {
  const cheapest = getCheapestTicket(attraction);
  return cheapest ? Number(cheapest.price) * people : Number.POSITIVE_INFINITY;
}

function takeNextAffordableAttraction(attractions, people, remainingBudget) {
  const index = attractions.findIndex((attraction) =>
    estimateAttractionGroupCost(attraction, people) <= remainingBudget
  );
  if (index === -1) return null;
  return attractions.splice(index, 1)[0];
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
// 2. Gợi ý địa điểm + combo vé theo budget & số người
// ------------------------------------------------------------

/**
 * Gợi ý địa điểm tham quan + combo vé theo budget và số người.
 *
 * @param {object} params
 * @param {number} params.budget - Tổng số tiền khách có (VND).
 * @param {number} params.people - Số người tham quan.
 * @param {string} [params.city] - Thành phố/khu vực mong muốn.
 * @param {string} [params.interests] - Sở thích (ví dụ: "thiên nhiên, mạo hiểm").
 * @returns {Promise<{ data: object, provider: string }>}
 */
async function recommendAttractions({ budget, people, city, interests }) {
  if (!budget || budget <= 0) throw new Error('Vui lòng cung cấp ngân sách (budget) hợp lệ');
  if (!people || people <= 0) throw new Error('Vui lòng cung cấp số người (people) hợp lệ');

  const catalog = await getCatalogSummary({ city, category: interests, limit: 6 });

  if (catalog.length === 0) {
    return {
      data: { recommendedAttractions: [], combos: [], overallSummary: 'Hiện chưa có điểm tham quan phù hợp. Vui lòng thử khu vực khác.' },
      provider: 'none',
    };
  }

  // Bước 1: chọn địa điểm bằng rule-based scoring (không dùng LLM để tránh token limit)
  const scored = catalog.map((a) => {
    const cheapestTicket = getCheapestTicket(a);
    const groupPrice = cheapestTicket ? cheapestTicket.price * people : null;
    let score = (a.rating || 0) * 10 + (a.totalReviews || 0) * 0.01;
    if (groupPrice && groupPrice <= budget) score += 20;
    return { ...a, cheapestTicket, groupPrice, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const provider = 'rule-based';
  const selected = [];
  let remainingBudget = budget;

  for (const attraction of scored) {
    if (selected.length >= 3) break;
    if (!attraction.cheapestTicket || !attraction.groupPrice) continue;
    if (attraction.groupPrice > remainingBudget) continue;

    selected.push(attraction);
    remainingBudget -= attraction.groupPrice;
  }

  const recommended = selected.map((a) => ({
    attractionId: a.id,
    title: a.title,
    reason: `Đánh giá ${a.rating || 0}/5, giá từ ${a.cheapestTicket.price.toLocaleString('vi-VN')}đ/người`,
  }));

  const combos = selected.map((a) => ({
    attractionId: a.id,
    attractionTitle: a.title,
    items: [{
      ticketId: a.cheapestTicket.id,
      ticketName: a.cheapestTicket.name,
      quantity: people,
      unitPrice: a.cheapestTicket.price,
      subtotal: a.groupPrice,
    }],
    totalPrice: a.groupPrice,
  }));

  const grandTotal = combos.reduce((sum, c) => sum + c.totalPrice, 0);
  const overallSummary = combos.length > 0
    ? `Đề xuất ${combos.length} điểm tham quan với tổng chi phí vé ước tính ${grandTotal.toLocaleString('vi-VN')}đ cho ${people} người, trong ngân sách ${budget.toLocaleString('vi-VN')}đ.`
    : `Chưa tìm thấy combo vé phù hợp trong ngân sách ${budget.toLocaleString('vi-VN')}đ cho ${people} người. Bạn có thể tăng ngân sách hoặc thử khu vực khác.`;

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
 * Tạo kế hoạch tham quan nhiều ngày.
 *
 * @param {object} params
 * @param {string} params.city - Thành phố/khu vực muốn tham quan.
 * @param {number} params.days - Số ngày tham quan.
 * @param {number} [params.people] - Số người (để ước tính chi phí), mặc định 1.
 * @param {string} [params.interests] - Sở thích/loại hình tham quan ưa thích.
 * @returns {Promise<{ data: object, provider: string }>}
 */
async function generateItinerary({ city, days, budget, people = 1, interests }) {
  if (!city || !city.trim()) throw new Error('Vui lòng cung cấp khu vực/thành phố (city)');
  if (!days || days <= 0) throw new Error('Vui lòng cung cấp số ngày (days) hợp lệ');

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

  // Rule-based: xếp tối đa 2-3 điểm/ngày, tuần tự từ catalog
  const maxPerDay = 2;
  const slots = ['Sáng', 'Chiều'];
  const times = ['08:00 - 11:30', '13:00 - 17:00'];
  const available = [...catalog];
  const dayPlans = [];
  const budgetLimit = Number(budget);
  let remainingBudget = Number.isFinite(budgetLimit) && budgetLimit > 0
    ? budgetLimit
    : Number.POSITIVE_INFINITY;

  for (let d = 1; d <= days; d++) {
    const activities = [];
    for (let s = 0; s < maxPerDay && available.length > 0; s++) {
      const attraction = takeNextAffordableAttraction(available, people, remainingBudget);
      if (!attraction) break;
      const cost = estimateAttractionGroupCost(attraction, people);
      remainingBudget -= cost;
      activities.push({
        attractionId: attraction.id,
        title: attraction.title,
        timeSlot: slots[s],
        suggestedTime: times[s],
        notes: attraction.openTime
          ? `Mở cửa ${attraction.openTime} - ${attraction.closeTime || '17:00'}`
          : 'Kiểm tra giờ mở cửa trước khi đến',
      });
    }
    if (activities.length > 0) {
      dayPlans.push({ day: d, theme: `Ngày ${d} tại ${city}`, activities });
    }
  }

  // Ước tính chi phí
  const usedAttractions = dayPlans.flatMap((d) => d.activities);
  const totalCostPerPerson = usedAttractions.reduce((sum, a) => {
    const found = catalog.find((c) => c.id === a.attractionId);
    return sum + (found?.minPrice || 0);
  }, 0);
  const estimatedCost = {
    perPerson: totalCostPerPerson,
    total: totalCostPerPerson * people,
    note: Number.isFinite(budgetLimit) && budgetLimit > 0
      ? `Chỉ tính giá vé tham quan, chưa gồm ăn uống và di chuyển. Ngân sách dự kiến: ${budgetLimit.toLocaleString('vi-VN')}đ.`
      : 'Chỉ tính giá vé tham quan, chưa gồm ăn uống và di chuyển',
  };

  // Dùng LLM chỉ để generate title + tips (output ngắn, ít token)
  const TIPS_PROMPT = `Bạn là hướng dẫn viên du lịch. Trả về JSON ngắn gọn:
{"title":"Tên kế hoạch hấp dẫn cho ${days} ngày tại ${city}","tips":["mẹo 1","mẹo 2","mẹo 3"]}`;

  let title = `Khám phá ${city} ${days} ngày`;
  let tips = [];
  let provider = 'rule-based';

  try {
    const { data: llmData, provider: llmProvider } = await generateJSON(
      TIPS_PROMPT,
      `Khu vực: ${city}, Số ngày: ${days}, Sở thích: ${interests || 'đa dạng'}`,
      { temperature: 0.5, maxOutputTokens: 256 }
    );
    title = llmData.title || title;
    tips = llmData.tips || [];
    provider = llmProvider;
  } catch {
    // fallback: giữ title/tips mặc định nếu LLM lỗi
  }

  // Cập nhật theme cho từng ngày bằng tên attraction nổi bật
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
