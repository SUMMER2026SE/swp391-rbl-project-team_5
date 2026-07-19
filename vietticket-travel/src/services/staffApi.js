import { apiRequest } from './api.js'

// Lớp gọi API cho cổng Nhân viên (Staff) & Admin.
// Gom các lời gọi vốn nằm rải rác trong CheckinPage / RefundManagementPage
// để dùng lại nhất quán như các service khác trong dự án.

// ----- Hoàn tiền (Staff/Admin) -----
// Hỗ trợ phân trang phía server: { status, search, page, limit }.
export function listRefundRequests({ status, search, page, limit } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (search) params.set('search', search)
  if (page) params.set('page', String(page))
  if (limit) params.set('limit', String(limit))
  const query = params.toString()
  return apiRequest(`/staff/refunds${query ? `?${query}` : ''}`, { method: 'GET' })
}

// action: 'APPROVED' | 'REJECTED' — staffNotes bắt buộc khi từ chối.
export function processRefundRequest(refundId, action, staffNotes) {
  return apiRequest(`/staff/refunds/${refundId}`, {
    method: 'PATCH',
    body: { action, staffNotes },
  })
}

export function reconcileRefundRequest(refundId) {
  return apiRequest(`/staff/refunds/${refundId}/reconcile`, { method: 'POST' })
}

// ----- Cấp lại vé -----
export function reissueTicket(bookingId, reasonCode, reason) {
  return apiRequest(`/staff/bookings/${bookingId}/reissue`, {
    method: 'POST',
    body: { reasonCode, reason },
  })
}

// ----- Check-in tại cổng -----
export function listTodayBookings() {
  return apiRequest('/staff/bookings/today', { method: 'GET' })
}

// Tra cứu vé theo mã QR (chỉ xem, không ghi DB).
export function lookupTicketByQr(token) {
  return apiRequest(`/staff/checkin/${encodeURIComponent(token)}`, { method: 'GET' })
}

// Check-in đúng một TicketInstance ứng với mã QR được quét.
export function checkInTicket(token) {
  return apiRequest(`/staff/checkin/${encodeURIComponent(token)}`, { method: 'POST' })
}

// ----- Phân công nhân viên (chỉ ADMIN) -----
export function getStaffAssignments(staffId) {
  return apiRequest(`/staff/assignments/${staffId}`, { method: 'GET' })
}

export function replaceStaffAssignments(staffId, attractionIds) {
  return apiRequest(`/staff/assignments/${staffId}`, {
    method: 'PUT',
    body: { attractionIds },
  })
}

const staffApi = {
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
  reissueTicket,
  listTodayBookings,
  lookupTicketByQr,
  checkInTicket,
  getStaffAssignments,
  replaceStaffAssignments,
}

export default staffApi
