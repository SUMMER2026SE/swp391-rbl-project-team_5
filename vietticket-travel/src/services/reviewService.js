import { apiRequest } from './api.js'

// Trả về { data, meta, breakdown } — meta phục vụ phân trang "Xem thêm",
// breakdown là phân bố số sao (histogram) trên toàn bộ review hiển thị.
export const getReviews = async (attractionId, { page = 1, limit = 6, rating } = {}) => {
  const params = new URLSearchParams({
    attractionId,
    page: String(page),
    limit: String(limit),
  })
  if (rating) params.set('rating', String(rating))

  const result = await apiRequest(`/reviews?${params.toString()}`, {
    method: 'GET',
  })
  return {
    data: result.data || [],
    meta: result.meta || { total: (result.data || []).length, page: 1, limit, totalPages: 1 },
    breakdown: result.breakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  }
}

export const createReview = async (payload) => {
  const result = await apiRequest('/reviews', {
    method: 'POST',
    body: payload,
  })
  return result.data
}

export const replyReview = async (reviewId, replyComment) => {
  const result = await apiRequest(`/reviews/${reviewId}/reply`, {
    method: 'POST',
    body: { replyComment },
  })
  return result.data
}

export const moderateReview = async (reviewId, isHidden) => {
  const result = await apiRequest(`/reviews/${reviewId}/moderate`, {
    method: 'PATCH',
    body: { isHidden },
  })
  return result.data
}

export const getPartnerReviews = async () => {
  const result = await apiRequest('/partners/reviews', {
    method: 'GET',
  })
  return result.data || []
}

export const getPartnerReviewStats = async () => {
  const result = await apiRequest('/partners/reviews/stats', {
    method: 'GET',
  })
  return result.data || { averageRating: 0, totalReviews: 0, unrepliedReviews: 0 }
}

export const getAdminReviews = async () => {
  const result = await apiRequest('/admin/reviews', {
    method: 'GET',
  })
  return result.data || []
}

const reviewService = {
  getReviews,
  createReview,
  replyReview,
  moderateReview,
  getPartnerReviews,
  getPartnerReviewStats,
  getAdminReviews,
}

export default reviewService
