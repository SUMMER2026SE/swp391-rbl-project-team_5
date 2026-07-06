import { apiRequest } from './api.js'

export async function aiChat(message, history = []) {
  return apiRequest('/ai/chat', {
    method: 'POST',
    body: { message, history },
  })
}

export async function aiRecommend({ budget, adults, children, city, interests, priority, companion, visitDate }) {
  return apiRequest('/ai/recommend', {
    method: 'POST',
    body: { budget, adults, children, city, interests, priority, companion, visitDate },
  })
}

export async function aiItinerary({ city, days, adults, children, interests, budget, pace, priority, companion, startDate }) {
  return apiRequest('/ai/itinerary', {
    method: 'POST',
    body: { city, days, adults, children, interests, budget, pace, priority, companion, startDate },
  })
}

// ----------------------------------------------------------------
// P1-C: Server-side itinerary persistence API
// ----------------------------------------------------------------

/**
 * Lưu hoặc cập nhật lịch trình vào tài khoản.
 * @param {{ planId: string, title: string, plan: object, criteria?: object }} params
 */
export async function saveAiItinerary({ planId, title, plan, criteria } = {}) {
  return apiRequest('/ai/itinerary/save', {
    method: 'POST',
    body: { planId, title, plan, criteria },
  })
}

/**
 * Lấy danh sách lịch trình đã lưu (không có field data nặng).
 * @returns {{ success: boolean, data: Array }}
 */
export async function getSavedAiItineraries() {
  return apiRequest('/ai/itinerary/saved', { method: 'GET' })
}

/**
 * Lấy chi tiết đầy đủ của 1 lịch trình (có field data).
 * @param {string} planId
 */
export async function getSavedAiItineraryById(planId) {
  return apiRequest(`/ai/itinerary/saved/${encodeURIComponent(planId)}`, { method: 'GET' })
}

/**
 * Xóa 1 lịch trình đã lưu.
 * @param {string} planId
 */
export async function deleteAiItinerary(planId) {
  return apiRequest(`/ai/itinerary/saved/${encodeURIComponent(planId)}`, { method: 'DELETE' })
}
