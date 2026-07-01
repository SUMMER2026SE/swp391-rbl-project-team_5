import { apiRequest } from './api.js'

// Lớp gọi API công khai cho Điểm tham quan & Khung giờ vé (luồng khách/guest).
// Gom các lời gọi vốn nằm rải rác trong SearchAttractionsPage / AttractionDetailPage /
// BookingModal để dùng lại nhất quán như các service khác trong dự án.

// ----- Tìm kiếm & chi tiết (Guest) -----
// params: { search, city, category, minPrice, maxPrice, minRating, sort, page, limit }
export function searchAttractions(params = {}) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.city) query.set('city', params.city)
  if (params.category) query.set('category', params.category)
  if (params.minPrice != null && params.minPrice !== '') query.set('minPrice', params.minPrice)
  if (params.maxPrice != null && params.maxPrice !== '') query.set('maxPrice', params.maxPrice)
  if (params.minRating != null && params.minRating !== '') query.set('minRating', params.minRating)
  if (params.sort) query.set('sort', params.sort)
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/attractions${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

// Toàn bộ điểm có toạ độ để vẽ bản đồ.
export function getMapPoints() {
  return apiRequest('/attractions/map-points', { method: 'GET' })
}

export function getAttractionDetail(id) {
  return apiRequest(`/attractions/${id}`, { method: 'GET' })
}

// ----- Khung giờ & giữ chỗ vé -----
// Kiểm tra sức chứa còn lại của một gói vé theo ngày (YYYY-MM-DD).
export function checkAvailability(ticketProductId, date) {
  return apiRequest(
    `/tickets/${ticketProductId}/availability?date=${encodeURIComponent(date)}`,
    { method: 'GET' },
  )
}

// Khóa giữ vé tạm thời (10 phút) trong lúc thanh toán.
// payload: { date, timeSlotId?, quantity }
export function reserveTickets(ticketProductId, payload) {
  return apiRequest(`/tickets/${ticketProductId}/reserve`, {
    method: 'POST',
    body: payload,
  })
}

const attractionApi = {
  searchAttractions,
  getMapPoints,
  getAttractionDetail,
  checkAvailability,
  reserveTickets,
}

export default attractionApi
