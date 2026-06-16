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
 * Body: { budget: number, people: number, city?: string, interests?: string }
 */
async function recommend(req, res, next) {
  try {
    const { budget, people, city, interests } = req.body || {};

    const budgetNum = Number(budget);
    const peopleNum = Number(people);

    if (!budgetNum || budgetNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "budget" (số tiền, VND).',
      });
    }
    if (!peopleNum || peopleNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "people" (số người).',
      });
    }

    const result = await recommendAttractions({
      budget: budgetNum,
      people: peopleNum,
      city: city ? String(city) : undefined,
      interests: interests ? String(interests) : undefined,
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
 * Body: { city: string, days: number, people?: number, budget?: number, interests?: string }
 */
async function itinerary(req, res, next) {
  try {
    const { city, days, people, budget, interests } = req.body || {};

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

    if (budgetNum !== undefined && (!Number.isFinite(budgetNum) || budgetNum <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "budget" (số tiền, VND).',
      });
    }

    const result = await generateItinerary({
      city,
      days: daysNum,
      people: people ? Number(people) : 1,
      budget: budgetNum,
      interests: interests ? String(interests) : undefined,
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
