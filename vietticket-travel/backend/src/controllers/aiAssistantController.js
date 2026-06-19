'use strict';

// ============================================================
// aiAssistantController.js
// ------------------------------------------------------------
// Controller cho 3 chức năng AI:
//   POST /api/ai/chat               - chatbot tư vấn
//   POST /api/ai/recommend          - gợi ý địa điểm + combo vé
//   POST /api/ai/itinerary          - tạo kế hoạch tham quan
// ============================================================

const {
  chatWithUser,
  recommendAttractions,
  generateItinerary,
} = require('../services/aiAssistantService');

// Cận trên cho số ngày tạo kế hoạch (khớp giới hạn 1-7 ở frontend,
// nới rộng đôi chút cho chuyến dài; chặn lạm dụng API gọi thẳng).
const MAX_ITINERARY_DAYS = 14;

/**
 * Tách số người lớn/trẻ em từ body, có suy ra tổng số người.
 * Trả về { adults, children, total } hoặc null nếu không hợp lệ.
 */
function parseParty({ people, adults, children }) {
  const toCount = (v) => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : NaN;
  };

  const adultsNum = toCount(adults);
  const childrenNum = toCount(children);
  const peopleNum = toCount(people);

  if (Number.isNaN(adultsNum) || Number.isNaN(childrenNum) || Number.isNaN(peopleNum)) {
    return null;
  }

  const splitTotal = (adultsNum || 0) + (childrenNum || 0);
  const total = splitTotal > 0 ? splitTotal : (peopleNum || 0);
  if (total <= 0) return null;

  return {
    adults: adultsNum,
    children: childrenNum,
    people: peopleNum,
    total,
  };
}

/**
 * POST /api/ai/chat
 * Body: { message: string, history?: Array<{ role, content }> }
 */
async function chat(req, res, next) {
  try {
    const { message, history } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Thiếu trường "message" (string).',
      });
    }

    const result = await chatWithUser(message, Array.isArray(history) ? history : []);

    return res.status(200).json({
      success: true,
      data: {
        reply: result.reply,
        provider: result.provider,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/ai/recommend
 * Body: { budget, people?|adults?|children?, city?, interests?, priority?, companion? }
 */
async function recommend(req, res, next) {
  try {
    const { budget, people, adults, children, city, interests, priority, companion } = req.body || {};

    const budgetNum = Number(budget);
    if (!budgetNum || budgetNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "budget" (số tiền, VND).',
      });
    }

    const party = parseParty({ people, adults, children });
    if (!party) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai số người (people hoặc adults/children).',
      });
    }

    const result = await recommendAttractions({
      budget: budgetNum,
      adults: party.adults,
      children: party.children,
      people: party.people,
      city: city ? String(city) : undefined,
      interests: interests ? String(interests) : undefined,
      priority: priority ? String(priority) : undefined,
      companion: companion ? String(companion) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      provider: result.provider,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/ai/itinerary
 * Body: { city, days, people?|adults?|children?, budget?, interests?, pace?, priority?, companion? }
 */
async function itinerary(req, res, next) {
  try {
    const { city, days, people, adults, children, budget, interests, pace, priority, companion } = req.body || {};

    const daysNum = Number(days);
    const budgetNum = budget == null || budget === '' ? undefined : Number(budget);

    if (!city || typeof city !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Thiếu trường "city" (string).',
      });
    }
    if (!daysNum || daysNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "days" (số ngày).',
      });
    }
    if (!Number.isInteger(daysNum) || daysNum > MAX_ITINERARY_DAYS) {
      return res.status(400).json({
        success: false,
        message: `Số ngày phải là số nguyên từ 1 đến ${MAX_ITINERARY_DAYS}.`,
      });
    }

    if (budgetNum !== undefined && (!Number.isFinite(budgetNum) || budgetNum <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "budget" (số tiền, VND).',
      });
    }

    const party = parseParty({ people, adults, children }) || { adults: 1, children: 0, people: 1 };

    const result = await generateItinerary({
      city,
      days: daysNum,
      adults: party.adults,
      children: party.children,
      people: party.people,
      budget: budgetNum,
      interests: interests ? String(interests) : undefined,
      pace: pace ? String(pace) : undefined,
      priority: priority ? String(priority) : undefined,
      companion: companion ? String(companion) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      provider: result.provider,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  chat,
  recommend,
  itinerary,
};
