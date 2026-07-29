import { apiRequest } from './api.js'

// Trả về { data, meta, breakdown } — meta phục vụ phân trang "Xem thêm",
// breakdown là phân bố số sao (histogram) trên toàn bộ review hiển thị.
export const getReviews = async (
  attractionId,
  { page = 1, limit = 6, rating, sort, travelerType, withPhotos } = {},
) => {
  const params = new URLSearchParams({
    attractionId,
    page: String(page),
    limit: String(limit),
  })
  if (rating) params.set('rating', String(rating))
  if (sort) params.set('sort', sort)
  if (travelerType) params.set('travelerType', travelerType)
  if (withPhotos) params.set('withPhotos', 'true')

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

export const toggleHelpfulVote = async (reviewId) => {
  const result = await apiRequest(`/reviews/${reviewId}/helpful`, {
    method: 'POST',
  })
  return result.data
}

export const uploadReviewImages = async (files) => {
  const formData = new FormData()
  for (const file of files) formData.append('images', file)
  const baseUrl = import.meta.env.VITE_API_URL || '/api'
  const response = await fetch(`${baseUrl}/upload/review-images`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.message || result.error?.message || 'Không thể tải ảnh đánh giá.')
  }
  return Array.isArray(result.data?.urls) ? result.data.urls : []
}

export const replyReview = async (reviewId, replyComment) => {
  const result = await apiRequest(`/reviews/${reviewId}/reply`, {
    method: 'POST',
    body: { replyComment },
  })
  return result.data
}

export const moderateReview = async (reviewId, isHidden, reason) => {
  const result = await apiRequest(`/reviews/${reviewId}/moderate`, {
    method: 'PATCH',
    body: { isHidden, reason },
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

export const getAdminReviews = async ({ page = 1, limit = 10, search, rating } = {}) => {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  })
  if (search) params.set('search', String(search))
  if (rating && rating !== 'all') params.set('rating', String(rating))

  const result = await apiRequest(`/reviews/moderation?${params.toString()}`, {
    method: 'GET',
  })
  return {
    data: result.data || [],
    pagination: result.pagination || {
      total: (result.data || []).length,
      page,
      limit,
      totalPages: 1,
    },
    stats: result.stats || {
      total: (result.data || []).length,
      visible: (result.data || []).filter((review) => !review.isHidden).length,
      hidden: (result.data || []).filter((review) => review.isHidden).length,
    },
  }
}

const reviewService = {
  getReviews,
  toggleHelpfulVote,
  uploadReviewImages,
  createReview,
  replyReview,
  moderateReview,
  getPartnerReviews,
  getPartnerReviewStats,
  getAdminReviews,
}

export default reviewService
