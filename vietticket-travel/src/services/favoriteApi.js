import { apiRequest } from './api.js'

export function getFavorites() {
  return apiRequest('/favorites', { method: 'GET' })
}

export function toggleFavorite(attractionId) {
  return apiRequest(`/attractions/${attractionId}/favorite`, { method: 'POST' })
}

export function getFavoriteItems(result) {
  return Array.isArray(result?.data)
    ? result.data
    : result?.data?.favorites || []
}
