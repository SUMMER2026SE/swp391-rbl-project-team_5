import { apiRequest } from './api.js'

export function getPartners(status) {
  const query = status && status !== 'all' ? `?status=${status.toUpperCase()}` : ''
  return apiRequest(`/admin/partners${query}`, { method: 'GET' })
}

export function reviewPartner(id, action, rejectionReason) {
  return apiRequest(`/admin/partners/${id}/review`, {
    method: 'PUT',
    body: { action, rejectionReason },
  })
}

export function changePartnerStatus(id, status, reason) {
  return apiRequest(`/admin/partners/${id}/status`, {
    method: 'PATCH',
    body: { status, reason },
  })
}

export function getAttractions(params = {}) {
  const normalized = typeof params === 'string' ? { status: params } : params
  const query = new URLSearchParams()
  if (normalized.status && normalized.status !== 'all') query.set('status', normalized.status.toUpperCase())
  if (normalized.page) query.set('page', normalized.page)
  if (normalized.limit) query.set('limit', normalized.limit)
  if (normalized.search) query.set('search', normalized.search)
  const qs = query.toString()
  return apiRequest(`/admin/attractions${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function reviewAttraction(id, action, rejectionReason) {
  return apiRequest(`/admin/attractions/${id}/review`, {
    method: 'PUT',
    body: { action, rejectionReason },
  })
}

export function hideAttraction(id, reason) {
  return apiRequest(`/admin/attractions/${id}/hide`, {
    method: 'PUT',
    body: { reason },
  })
}

export function restoreAttraction(id) {
  return apiRequest(`/admin/attractions/${id}/restore`, { method: 'PUT' })
}

export function getDashboard(period = 'month') {
  return apiRequest(`/admin/dashboard?period=${encodeURIComponent(period)}`, { method: 'GET' })
}

export function getFinancialReport(period = 'month') {
  return apiRequest(`/admin/financial-report?period=${encodeURIComponent(period)}`, { method: 'GET' })
}

export function getFinancialTransactions(params = {}) {
  const query = new URLSearchParams()
  if (params.period) query.set('period', params.period)
  if (params.type && params.type !== 'ALL') query.set('type', params.type)
  if (params.status) query.set('status', params.status)
  if (params.search) query.set('search', params.search)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/financial-transactions${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function changePartnerCommissionRate(id, commissionRatePercent) {
  return apiRequest(`/admin/partners/${id}/commission`, {
    method: 'PATCH',
    body: { commissionRatePercent },
  })
}

export function getCategories() {
  return apiRequest('/admin/categories', { method: 'GET' })
}

export function createCategory(payload) {
  return apiRequest('/admin/categories', { method: 'POST', body: payload })
}

export function updateCategory(id, payload) {
  return apiRequest(`/admin/categories/${id}`, { method: 'PUT', body: payload })
}

export function deleteCategory(id) {
  return apiRequest(`/admin/categories/${id}`, { method: 'DELETE' })
}

// ----- Quản lý người dùng -----
// params: { search, role, status, page, limit }
export function getUsers(params = {}) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.role && params.role !== 'all') query.set('role', params.role.toUpperCase())
  if (params.status && params.status !== 'all') query.set('status', params.status.toUpperCase())
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/users${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

// status: 'ACTIVE' | 'LOCKED'
export function changeUserStatus(id, { status, reason, sendEmail } = {}) {
  return apiRequest(`/admin/users/${id}/status`, {
    method: 'PATCH',
    body: { status, reason, sendEmail },
  })
}

// ----- Đặt vé toàn sàn -----
// params: { status, search, refundRequired, page, limit }
export function getAdminBookings(params = {}) {
  const query = new URLSearchParams()
  if (params.status && params.status !== 'all') query.set('status', params.status.toUpperCase())
  if (params.search) query.set('search', params.search)
  if (params.refundRequired) query.set('refundRequired', 'true')
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/bookings${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function getAdminReviews() {
  return apiRequest('/admin/reviews', { method: 'GET' })
}

export const listPartners = getPartners;
export const listAttractions = getAttractions;
