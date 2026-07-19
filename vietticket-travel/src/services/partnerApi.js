import { API_BASE_URL, apiRequest } from './api.js'

// Lớp gọi API cho Partner Portal.

// ----- Hồ sơ đối tác & KYC -----
export function submitKyc(payload) {
  return apiRequest('/partners/register', { method: 'POST', body: payload })
}

export function getMyPartner() {
  return apiRequest('/partners/me', { method: 'GET' })
}

export async function uploadKycDocument(file) {
  const formData = new FormData()
  formData.append('document', file)

  const response = await fetch(`${API_BASE_URL}/upload/document`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(
      data.message || data.error?.message || 'Không thể tải tài liệu lên.',
    )
    error.status = response.status
    error.data = data
    throw error
  }

  return data.data?.url
}

export function updatePartnerSettings(payload) {
  return apiRequest('/partners/settings', { method: 'PUT', body: payload })
}

export function getDashboard() {
  return apiRequest('/partners/dashboard', { method: 'GET' })
}

export function getReports(period = 'month') {
  return apiRequest(`/partners/reports?period=${encodeURIComponent(period)}`, { method: 'GET' })
}

export function getPartnerSettlements(params = {}) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  const qs = query.toString()
  return apiRequest(`/partners/settlements${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function getCategories() {
  return apiRequest('/partners/categories', { method: 'GET' })
}

// ----- Điểm tham quan -----
export function listAttractions(params = {}) {
  const query = new URLSearchParams()
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  if (params.city) query.set('city', params.city)
  const qs = query.toString()
  return apiRequest(`/partners/attractions${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function getAttraction(id) {
  return apiRequest(`/partners/attractions/${id}`, { method: 'GET' })
}

export function createAttraction(payload) {
  return apiRequest('/partners/attractions', { method: 'POST', body: payload })
}

export function submitAttraction(id) {
  return apiRequest(`/attractions/${id}/submit`, { method: 'PUT' })
}

export function updateAttraction(id, payload) {
  return apiRequest(`/partners/attractions/${id}`, { method: 'PUT', body: payload })
}

export function deleteAttraction(id) {
  return apiRequest(`/partners/attractions/${id}`, { method: 'DELETE' })
}

export function setAttractionPublication(id, publicationStatus) {
  return apiRequest(`/partners/attractions/${id}/publication`, {
    method: 'PATCH',
    body: { publicationStatus },
  })
}

// Upload nhiều ảnh (multipart) — không dùng apiRequest vì cần FormData
export async function uploadAttractionImages(id, files) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('images', file)
  }

  const response = await fetch(`${API_BASE_URL}/partners/attractions/${id}/images`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data.message || 'Không thể tải ảnh lên.')
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

export function deleteAttractionImage(attractionId, imageId) {
  return apiRequest(`/partners/attractions/${attractionId}/images/${imageId}`, {
    method: 'DELETE',
  })
}

export function setAttractionPrimaryImage(attractionId, imageId) {
  return apiRequest(
    `/partners/attractions/${attractionId}/images/${imageId}/primary`,
    { method: 'PATCH' },
  )
}

// ----- Vé -----
export function listTickets(attractionId) {
  return apiRequest(`/partners/attractions/${attractionId}/tickets`, { method: 'GET' })
}

export function createTicket(attractionId, payload) {
  return apiRequest(`/partners/attractions/${attractionId}/tickets`, {
    method: 'POST',
    body: payload,
  })
}

export function getTicket(ticketId) {
  return apiRequest(`/partners/tickets/${ticketId}`, { method: 'GET' })
}

export function updateTicket(ticketId, payload) {
  return apiRequest(`/partners/tickets/${ticketId}`, { method: 'PUT', body: payload })
}

export function deleteTicket(ticketId) {
  return apiRequest(`/partners/tickets/${ticketId}`, { method: 'DELETE' })
}

// ----- Lịch & sức chứa -----
export function getSchedule(attractionId) {
  return apiRequest(`/partners/attractions/${attractionId}/schedule`, { method: 'GET' })
}

export function saveSchedule(attractionId, payload) {
  return apiRequest(`/partners/attractions/${attractionId}/schedule`, {
    method: 'PUT',
    body: payload,
  })
}

// ----- Đặt vé (quản lý phía đối tác) -----
export function getPartnerBookings(params = {}) {
  const query = new URLSearchParams()
  if (params.page) query.set('page', params.page)
  if (params.limit) query.set('limit', params.limit)
  if (params.status && params.status !== 'all') query.set('status', params.status)
  if (params.search) query.set('search', params.search)
  const qs = query.toString()
  return apiRequest(`/partners/bookings${qs ? `?${qs}` : ''}`, { method: 'GET' })
}

export function approveBooking(id) {
  return apiRequest(`/partners/bookings/${id}/approve`, { method: 'PATCH' })
}

export function rejectBooking(id, reason) {
  return apiRequest(`/partners/bookings/${id}/reject`, {
    method: 'PATCH',
    body: { reason },
  })
}

export function cancelConfirmedBooking(id, reason) {
  return apiRequest(`/partners/bookings/${id}/cancel`, {
    method: 'PATCH',
    body: { reason },
  })
}

// ----- Nhân viên (mỗi đối tác tự quản lý nhân viên của mình) -----
export function listStaff() {
  return apiRequest('/partners/staff', { method: 'GET' })
}

export function createStaff(payload) {
  return apiRequest('/partners/staff', { method: 'POST', body: payload })
}

export function resendStaffInvite(staffId) {
  return apiRequest(`/partners/staff/${staffId}/invite`, { method: 'POST' })
}

export function changeStaffStatus(staffId, status) {
  return apiRequest(`/partners/staff/${staffId}/status`, {
    method: 'PATCH',
    body: { status },
  })
}

export function getStaffAssignments(staffId) {
  return apiRequest(`/partners/staff/${staffId}/assignments`, { method: 'GET' })
}

export function replaceStaffAssignments(staffId, attractionIds) {
  return apiRequest(`/partners/staff/${staffId}/assignments`, {
    method: 'PUT',
    body: { attractionIds },
  })
}

export function removeStaff(staffId) {
  return apiRequest(`/partners/staff/${staffId}`, { method: 'DELETE' })
}
