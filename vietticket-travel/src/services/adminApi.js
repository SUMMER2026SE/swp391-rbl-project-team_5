import { apiRequest } from './api.js'

export function getPartners(params = {}) {
  const normalized = typeof params === 'string' ? { status: params } : params
  const query = new URLSearchParams()
  if (normalized.status && normalized.status !== 'all') {
    query.set('status', normalized.status.toUpperCase())
  }
  if (normalized.page) query.set('page', normalized.page)
  if (normalized.limit) query.set('limit', normalized.limit)
  if (normalized.search) query.set('search', normalized.search)
  const qs = query.toString()
  return apiRequest(`/admin/partners${qs ? `?${qs}` : ''}`, { method: 'GET' })
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
  if (Array.isArray(normalized.statuses) && normalized.statuses.length > 0) {
    query.set('statuses', normalized.statuses.map((status) => status.toUpperCase()).join(','))
  }
  if (normalized.publicationStatus) {
    query.set('publicationStatus', normalized.publicationStatus.toUpperCase())
  }
  if (normalized.operationalStatus) {
    query.set('operationalStatus', normalized.operationalStatus.toUpperCase())
  }
  if (normalized.published !== undefined && normalized.published !== '') {
    query.set('published', String(normalized.published))
  }
  if (normalized.partnerId) query.set('partnerId', normalized.partnerId)
  if (normalized.categoryId) query.set('categoryId', normalized.categoryId)
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

export function getVouchers(params = {}) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.isActive === true || params.isActive === false) {
    query.set('isActive', String(params.isActive))
  }
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/vouchers${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function createVoucher(payload) {
  return apiRequest('/admin/vouchers', { method: 'POST', body: payload })
}

export function updateVoucher(id, payload) {
  return apiRequest(`/admin/vouchers/${id}`, { method: 'PUT', body: payload })
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

export function getAdminReviews(params = {}) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.rating && params.rating !== 'all') query.set('rating', params.rating)
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/reviews${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function createPlatformStaff(payload) {
  return apiRequest('/admin/platform-staff', {
    method: 'POST',
    body: payload,
  })
}

export function resendPlatformStaffInvite(id) {
  return apiRequest(`/admin/platform-staff/${id}/invite`, { method: 'POST' })
}

export function getAuditLogs(params = {}) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.action) query.set('action', params.action)
  if (params.entityType) query.set('entityType', params.entityType)
  if (params.actorId) query.set('actorId', params.actorId)
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/audit-logs${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function getSettlements(params = {}) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.partnerId) query.set('partnerId', params.partnerId)
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/admin/settlements${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function getSettlement(id) {
  return apiRequest(`/admin/settlements/${id}`, { method: 'GET' })
}

export function createSettlement(payload) {
  return apiRequest('/admin/settlements', { method: 'POST', body: payload })
}

export function updateSettlementStatus(id, status, details = {}) {
  return apiRequest(`/admin/settlements/${id}/status`, {
    method: 'PATCH',
    body: { status, ...details },
  })
}

export const listPartners = getPartners;
export const listAttractions = getAttractions;
