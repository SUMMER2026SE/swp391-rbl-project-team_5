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

  const trimmedHistory = history.slice(-10);
  const historyText = trimmedHistory
    .map((h) => `${h.role === 'user' ? 'Khách' : 'Trợ lý'}: ${h.content}`)
    .join('\n');

  const userPrompt = [
    historyText ? `LỊCH SỬ HỘI THOẠI:\n${historyText}\n` : '',
    `CÂU HỎI MỚI CỦA KHÁCH:\n${message.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { text, provider } = await generateText(CHATBOT_SYSTEM_PROMPT, userPrompt, {
    temperature: 0.5,
    maxOutputTokens: 1024,
  });

  return { reply: text.trim(), provider };
}

// ------------------------------------------------------------
// 2. Gợi ý địa điểm + combo vé theo budget & số người
// ------------------------------------------------------------

const RECOMMEND_ATTRACTIONS_PROMPT = `
Bạn là tư vấn viên du lịch. Chọn TỐI ĐA 3 điểm tham quan phù hợp nhất từ danh sách.
Trả về JSON ngắn gọn, KHÔNG giải thích thêm:
{"recommendedAttractions":[{"attractionId":"...","title":"...","reason":"..."}]}
`.trim();

const RECOMMEND_COMBO_PROMPT = `
Tư vấn viên vé tham quan. Chọn combo vé tối ưu cho khách trong budget.
Trả về JSON ngắn gọn, KHÔNG giải thích:
{"combos":[{"attractionId":"...","attractionTitle":"...","items":[{"ticketId":"...","ticketName":"...","quantity":1,"unitPrice":0,"subtotal":0}],"totalPrice":0}],"overallSummary":"..."}
`.trim();

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
    let score = (a.rating || 0) * 10 + (a.totalReviews || 0) * 0.01;
    if (a.minPrice && a.minPrice * people <= budget) score += 20;
    return { ...a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3);

  const recommended = top3.map((a) => ({
    attractionId: a.id,
    title: a.title,
    reason: `Đánh giá ${a.rating}/5, giá từ ${a.minPrice ? a.minPrice.toLocaleString('vi-VN') : '?'}đ/người`,
  }));

  let provider = 'rule-based';

  // Bước 2: tính combo vé bằng code (không dùng LLM để tránh token limit)
  provider = 'rule-based';
  const selectedIds = recommended.map((r) => r.attractionId);
  const selectedCatalog = catalog.filter((a) => selectedIds.includes(a.id));

  const combos = selectedCatalog
    .filter((a) => a.tickets && a.tickets.length > 0)
    .map((a) => {
      // Chọn vé rẻ nhất có sẵn
      const cheapest = a.tickets.reduce((min, t) => t.price < min.price ? t : min, a.tickets[0]);
      const quantity = people;
      const subtotal = cheapest.price * quantity;
      return {
        attractionId: a.id,
        attractionTitle: a.title,
        items: [{
          ticketId: cheapest.id,
          ticketName: cheapest.name,
          quantity,
          unitPrice: cheapest.price,
          subtotal,
        }],
        totalPrice: subtotal,
      };
    })
    .filter((c) => c.totalPrice <= budget); // chỉ giữ combo trong budget

  const grandTotal = combos.reduce((sum, c) => sum + c.totalPrice, 0);
  const overallSummary = `Đề xuất ${combos.length} điểm tham quan với tổng chi phí vé ước tính ${grandTotal.toLocaleString('vi-VN')}đ cho ${people} người (ngân sách ${budget.toLocaleString('vi-VN')}đ).`;

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

const ITINERARY_SYSTEM_PROMPT = `
Bạn là hướng dẫn viên du lịch chuyên nghiệp của VietTicket Travel.
Nhiệm vụ: dựa trên DANH SÁCH ĐIỂM THAM QUAN được cung cấp (kèm giờ mở/đóng cửa, giá vé),
hãy xây dựng một KẾ HOẠCH THAM QUAN chi tiết theo số ngày khách yêu cầu.

QUY TẮC QUAN TRỌNG:
- CHỈ dùng các điểm tham quan có trong danh sách được cung cấp (dùng đúng attractionId, title).
- Mỗi ngày nên có 1-3 điểm tham quan, sắp xếp theo thời gian hợp lý (sáng/chiều/tối),
  lưu ý giờ mở/đóng cửa (openTime/closeTime) của từng điểm.
- Không lặp lại 1 điểm tham quan ở nhiều ngày trừ khi danh sách quá ít điểm.
- Ước tính sơ bộ tổng chi phí vé dựa trên minPrice * số người, ghi vào "estimatedCost".
- Trả lời CHỈ bằng JSON theo đúng schema sau, không thêm text nào khác ngoài JSON:

{
  "title": "Tên kế hoạch (ví dụ: Khám phá Đà Nẵng 3 ngày 2 đêm)",
  "days": [
    {
      "day": 1,
      "theme": "chủ đề ngắn cho ngày này",
      "activities": [
        {
          "attractionId": "...",
          "title": "...",
          "timeSlot": "Sáng | Chiều | Tối",
          "suggestedTime": "08:00 - 12:00",
          "notes": "gợi ý ngắn gọn cho hoạt động này"
        }
      ]
    }
  ],
  "estimatedCost": {
    "perPerson": 0,
    "total": 0,
    "note": "ghi chú về cách ước tính (chỉ tính giá vé, chưa gồm ăn uống/di chuyển)"
  },
  "tips": ["mẹo du lịch ngắn gọn 1", "mẹo 2"]
}
`.trim();

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
async function generateItinerary({ city, days, people = 1, interests }) {
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

  for (let d = 1; d <= days; d++) {
    const activities = [];
    for (let s = 0; s < maxPerDay && available.length > 0; s++) {
      const attraction = available.shift();
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
    note: 'Chỉ tính giá vé tham quan, chưa gồm ăn uống và di chuyển',
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
  } catch (_) {
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
