import { apiRequest } from './api.js'

export const getReviews = async (attractionId) => {
  const result = await apiRequest(`/reviews?attractionId=${attractionId}`, {
    method: 'GET',
  })
  return result.data || []
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
