'use strict';

// ============================================================
// aiAssistantController.js
// ------------------------------------------------------------
// Controller cho các chức năng AI:
//   POST /api/ai/chat                        - chatbot tư vấn
//   POST /api/ai/recommend                   - gợi ý địa điểm + gói vé
//   POST /api/ai/itinerary                   - tạo kế hoạch tham quan
//   POST /api/ai/itinerary/save              - lưu lịch trình vào tài khoản
//   GET  /api/ai/itinerary/saved             - danh sách lịch trình đã lưu
//   GET  /api/ai/itinerary/saved/:planId     - chi tiết 1 lịch trình
//   DELETE /api/ai/itinerary/saved/:planId   - xóa 1 lịch trình
// ============================================================

const {
  chatWithUser,
  recommendAttractions,
  generateItinerary,
} = require('../services/aiAssistantService');
const prisma = require('../config/prisma');
const { todayInVietnam } = require('../utils/refundService');

// Cận trên cho số ngày tạo kế hoạch (khớp giới hạn 1-7 ở frontend,
// nới rộng đôi chút cho chuyến dài; chặn lạm dụng API gọi thẳng).
const MAX_ITINERARY_DAYS = 14;
const MAX_CHAT_MESSAGE_LENGTH = 1200;
const MAX_CHAT_HISTORY_ITEMS = 12;
const MAX_CHAT_HISTORY_CONTENT_LENGTH = 1200;
const CHAT_HISTORY_ROLES = new Set(['assistant', 'user']);
const MAX_SAVED_ITINERARIES_PER_USER = 20;
const MAX_PARTY_SIZE = 50;
const MAX_BUDGET_VND = 1_000_000_000;
const MAX_CITY_LENGTH = 100;
const MAX_INTERESTS_LENGTH = 400;
const MAX_PLAN_ID_LENGTH = 120;
const MAX_PLAN_TITLE_LENGTH = 200;
const MAX_SAVED_PLAN_BYTES = 500_000;
const ALLOWED_PRIORITY = new Set(['balanced', 'rating', 'budget']);
const ALLOWED_COMPANION = new Set(['solo', 'couple', 'family', 'friends']);
const ALLOWED_PACE = new Set(['relaxed', 'normal', 'packed']);

function normalizeChatMessage(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_CHAT_HISTORY_ITEMS)
    .map((item) => {
      const role = CHAT_HISTORY_ROLES.has(item?.role) ? item.role : null;
      const content = normalizeChatMessage(item?.content);
      if (!role || !content) return null;
      return {
        role,
        content: content.slice(0, MAX_CHAT_HISTORY_CONTENT_LENGTH),
      };
    })
    .filter(Boolean);
}

function normalizeDateOnly(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

function normalizeOptionalText(value, maxLength) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= maxLength ? trimmed : null;
}

function isValidMoney(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_BUDGET_VND;
}

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function validateSavedPlan(plan) {
  if (!isPlainObject(plan)) return 'Trường "plan" phải là một object JSON.';
  if (!Array.isArray(plan.days) || plan.days.length > MAX_ITINERARY_DAYS) {
    return `Trường "plan.days" phải là mảng có tối đa ${MAX_ITINERARY_DAYS} ngày.`;
  }

  for (const day of plan.days) {
    if (!isPlainObject(day)) return 'Mỗi ngày trong lịch trình phải là một object.';
    if (day.activities != null && (!Array.isArray(day.activities) || day.activities.length > 4)) {
      return 'Mỗi ngày chỉ được lưu tối đa 4 hoạt động.';
    }
    if (day.alternatives != null && (!Array.isArray(day.alternatives) || day.alternatives.length > 2)) {
      return 'Mỗi ngày chỉ được lưu tối đa 2 địa điểm tham khảo.';
    }
  }

  try {
    if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > MAX_SAVED_PLAN_BYTES) {
      return 'Dữ liệu lịch trình quá lớn.';
    }
  } catch {
    return 'Dữ liệu lịch trình không thể chuyển thành JSON.';
  }
  return '';
}

/**
 * Tách số người lớn/trẻ em từ body, có suy ra tổng số người.
 * Trả về { adults, children, total } hoặc null nếu không hợp lệ.
 */
function parseParty({ people, adults, children }) {
  const toCount = (v) => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
  };

  const adultsNum = toCount(adults);
  const childrenNum = toCount(children);
  const peopleNum = toCount(people);

  if (Number.isNaN(adultsNum) || Number.isNaN(childrenNum) || Number.isNaN(peopleNum)) {
    return null;
  }

  const splitTotal = (adultsNum || 0) + (childrenNum || 0);
  const total = splitTotal > 0 ? splitTotal : (peopleNum || 0);
  if (total <= 0 || total > MAX_PARTY_SIZE) return null;

  return {
    adults: adultsNum ?? 0,
    children: childrenNum ?? 0,
    people: peopleNum ?? 0,
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
    const normalizedMessage = normalizeChatMessage(message);

    if (!normalizedMessage) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu trường "message" (string).',
      });
    }

    if (normalizedMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung chat quá dài. Vui lòng rút gọn câu hỏi.',
      });
    }

    const result = await chatWithUser(normalizedMessage, normalizeChatHistory(history), {
      userId: req.user?.id,
      role: req.user?.role,
      fullName: req.user?.fullName,
    });

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
    const { budget, people, adults, children, city, interests, priority, companion, visitDate } = req.body || {};

    const budgetNum = Number(budget);
    if (!isValidMoney(budgetNum)) {
      return res.status(400).json({
        success: false,
        message: `Ngân sách phải là số nguyên dương không quá ${MAX_BUDGET_VND.toLocaleString('vi-VN')} VND.`,
      });
    }

    const party = parseParty({ people, adults, children });
    if (!party) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai số người (people hoặc adults/children).',
      });
    }

    const normalizedCity = normalizeOptionalText(city, MAX_CITY_LENGTH);
    const normalizedInterests = normalizeOptionalText(interests, MAX_INTERESTS_LENGTH);
    if (normalizedCity === null || normalizedInterests === null) {
      return res.status(400).json({
        success: false,
        message: 'Thành phố hoặc sở thích không đúng định dạng/độ dài cho phép.',
      });
    }
    if (priority != null && !ALLOWED_PRIORITY.has(priority)) {
      return res.status(400).json({ success: false, message: 'Giá trị "priority" không hợp lệ.' });
    }
    if (companion != null && !ALLOWED_COMPANION.has(companion)) {
      return res.status(400).json({ success: false, message: 'Giá trị "companion" không hợp lệ.' });
    }

    const normalizedVisitDate = normalizeDateOnly(visitDate);
    if (normalizedVisitDate === null) {
      return res.status(400).json({
        success: false,
        message: 'Trường "visitDate" phải có định dạng YYYY-MM-DD.',
      });
    }
    if (normalizedVisitDate && normalizedVisitDate < todayInVietnam()) {
      return res.status(400).json({
        success: false,
        message: 'Trường "visitDate" phải từ hôm nay trở đi.',
      });
    }

    const result = await recommendAttractions({
      budget: budgetNum,
      adults: party.adults,
      children: party.children,
      people: party.people,
      city: normalizedCity,
      interests: normalizedInterests,
      priority,
      companion,
      visitDate: normalizedVisitDate,
      userId: req.user?.id,
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
    const { city, days, people, adults, children, budget, interests, pace, priority, companion, startDate } = req.body || {};

    const daysNum = Number(days);
    const budgetNum = budget == null || budget === '' ? undefined : Number(budget);

    const normalizedCity = normalizeOptionalText(city, MAX_CITY_LENGTH);
    if (!normalizedCity) {
      return res.status(400).json({
        success: false,
        message: `Trường "city" phải là chuỗi không rỗng, tối đa ${MAX_CITY_LENGTH} ký tự.`,
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

    if (budgetNum !== undefined && !isValidMoney(budgetNum)) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu hoặc sai trường "budget" (số tiền, VND).',
      });
    }

    const normalizedInterests = normalizeOptionalText(interests, MAX_INTERESTS_LENGTH);
    if (normalizedInterests === null) {
      return res.status(400).json({ success: false, message: 'Trường "interests" không hợp lệ.' });
    }
    if (pace != null && !ALLOWED_PACE.has(pace)) {
      return res.status(400).json({ success: false, message: 'Giá trị "pace" không hợp lệ.' });
    }
    if (priority != null && !ALLOWED_PRIORITY.has(priority)) {
      return res.status(400).json({ success: false, message: 'Giá trị "priority" không hợp lệ.' });
    }
    if (companion != null && !ALLOWED_COMPANION.has(companion)) {
      return res.status(400).json({ success: false, message: 'Giá trị "companion" không hợp lệ.' });
    }

    const normalizedStartDate = normalizeDateOnly(startDate);
    if (normalizedStartDate === null) {
      return res.status(400).json({
        success: false,
        message: 'Trường "startDate" phải có định dạng YYYY-MM-DD.',
      });
    }
    if (!normalizedStartDate) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn ngày bắt đầu để kiểm tra tình trạng còn vé.',
      });
    }
    if (normalizedStartDate && normalizedStartDate < todayInVietnam()) {
      return res.status(400).json({
        success: false,
        message: 'Trường "startDate" phải từ hôm nay trở đi.',
      });
    }

    const hasPartyInput = [people, adults, children].some(
      (value) => value != null && value !== '',
    );
    const party = hasPartyInput
      ? parseParty({ people, adults, children })
      : { adults: 1, children: 0, people: 1, total: 1 };
    if (!party) {
      return res.status(400).json({
        success: false,
        message: `Số khách phải là số nguyên, từ 1 đến ${MAX_PARTY_SIZE} người.`,
      });
    }

    const result = await generateItinerary({
      city: normalizedCity,
      days: daysNum,
      adults: party.adults,
      children: party.children,
      people: party.people,
      budget: budgetNum,
      interests: normalizedInterests,
      pace,
      priority,
      companion,
      startDate: normalizedStartDate,
      userId: req.user?.id,
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

// ------------------------------------------------------------
// P1-C: Lưu lịch trình AI vào tài khoản (server-side persistence)
// ------------------------------------------------------------

/**
 * POST /api/ai/itinerary/save
 * Body: { planId, title, plan, criteria? }
 * Yêu cầu: đăng nhập.
 * Dùng upsert để cho phép cập nhật lịch trình đã lưu (cùng planId).
 */
async function saveItinerary(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập.' });
    }

    const { planId, title, plan, criteria } = req.body || {};

    const normalizedPlanId = typeof planId === 'string' ? planId.trim() : '';
    if (
      !normalizedPlanId
      || normalizedPlanId.length > MAX_PLAN_ID_LENGTH
      || !/^[A-Za-z0-9_-]+$/.test(normalizedPlanId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Trường "planId" không hợp lệ.',
      });
    }
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    if (!normalizedTitle || normalizedTitle.length > MAX_PLAN_TITLE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Trường "title" phải có từ 1 đến ${MAX_PLAN_TITLE_LENGTH} ký tự.`,
      });
    }
    const planValidationError = validateSavedPlan(plan);
    if (planValidationError) {
      return res.status(400).json({ success: false, message: planValidationError });
    }
    if (criteria != null && !isPlainObject(criteria)) {
      return res.status(400).json({ success: false, message: 'Trường "criteria" phải là object JSON.' });
    }

    // Kiểm tra giới hạn số lượng (bỏ qua nếu đang cập nhật bản đã có).
    const existingCount = await prisma.savedItinerary.count({
      where: { userId, NOT: { planId: normalizedPlanId } },
    });
    if (existingCount >= MAX_SAVED_ITINERARIES_PER_USER) {
      return res.status(400).json({
        success: false,
        message: `Bạn đã lưu tối đa ${MAX_SAVED_ITINERARIES_PER_USER} lịch trình. Xin xóa bớt lịch trình cũ trước khi lưu mới.`,
      });
    }

    const saved = await prisma.savedItinerary.upsert({
      where: { userId_planId: { userId, planId: normalizedPlanId } },
      create: {
        userId,
        planId: normalizedPlanId,
        title: normalizedTitle,
        data: plan,
        criteria: criteria || null,
      },
      update: {
        title: normalizedTitle,
        data: plan,
        criteria: criteria || null,
        updatedAt: new Date(),
      },
      select: { id: true, planId: true, title: true, createdAt: true, updatedAt: true },
    });

    return res.status(200).json({ success: true, data: saved });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/ai/itinerary/saved
 * Trả về danh sách lịch trình đã lưu của user, mới nhất trước.
 * Không trả field `data` (nặng) để tối ưu list view; dùng GET by planId để lấy full.
 */
async function getSavedItineraries(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập.' });
    }

    const itineraries = await prisma.savedItinerary.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: MAX_SAVED_ITINERARIES_PER_USER,
      select: {
        id: true,
        planId: true,
        title: true,
        criteria: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({ success: true, data: itineraries });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/ai/itinerary/saved/:planId
 * Trả về full data của 1 lịch trình (bao gồm field `data`).
 */
async function getSavedItineraryById(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập.' });
    }

    const { planId } = req.params;
    if (!planId) {
      return res.status(400).json({ success: false, message: 'Thiếu planId.' });
    }

    const savedItinerary = await prisma.savedItinerary.findUnique({
      where: { userId_planId: { userId, planId } },
    });

    if (!savedItinerary) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lịch trình.' });
    }

    return res.status(200).json({ success: true, data: savedItinerary });
  } catch (error) {
    return next(error);
  }
}

/**
 * DELETE /api/ai/itinerary/saved/:planId
 * Xóa 1 lịch trình đã lưu. Chỉ xóa của đúng user đó.
 */
async function deleteItinerary(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập.' });
    }

    const { planId } = req.params;
    if (!planId) {
      return res.status(400).json({ success: false, message: 'Thiếu planId.' });
    }

    const deleted = await prisma.savedItinerary.deleteMany({
      where: { userId, planId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lịch trình hoặc bạn không có quyền xóa.' });
    }

    return res.status(200).json({ success: true, message: 'Đã xóa lịch trình.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  chat,
  recommend,
  itinerary,
  saveItinerary,
  getSavedItineraries,
  getSavedItineraryById,
  deleteItinerary,
};
