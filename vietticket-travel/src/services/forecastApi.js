import { apiRequest } from './api.js'

// Lớp gọi API cho tính năng AI Dự báo Doanh thu.
// Quyền: PARTNER (chỉ attraction của mình) và ADMIN (toàn nền tảng).

export function getAttractionForecast(attractionId, { days = 7, refresh = false } = {}) {
  const params = new URLSearchParams({ days: String(days) })
  if (refresh) params.set('refresh', 'true')
  return apiRequest(`/forecast/attractions/${attractionId}?${params.toString()}`, { method: 'GET' })
}

export function getPartnerForecastOverview({ days = 7 } = {}) {
  const params = new URLSearchParams({ days: String(days) })
  return apiRequest(`/forecast/partner/overview?${params.toString()}`, { method: 'GET' })
}

export function getAdminForecastOverview({ days = 7, city, partnerId, refresh = false } = {}) {
  const params = new URLSearchParams({ days: String(days) })
  if (city) params.set('city', city)
  if (partnerId) params.set('partnerId', partnerId)
  if (refresh) params.set('refresh', 'true')
  return apiRequest(`/forecast/admin/overview?${params.toString()}`, { method: 'GET' })
}
