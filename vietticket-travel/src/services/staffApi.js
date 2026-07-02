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

// ----- Cấp lại vé -----
export function reissueTicket(bookingId) {
  return apiRequest(`/staff/bookings/${bookingId}/reissue`, { method: 'POST' })
}

// ----- Check-in tại cổng -----
export function listTodayBookings() {
  return apiRequest('/staff/bookings/today', { method: 'GET' })
}

// Tra cứu vé theo mã QR (chỉ xem, không ghi DB).
export function lookupTicketByQr(token) {
  return apiRequest(`/staff/checkin/${encodeURIComponent(token)}`, { method: 'GET' })
}

// Check-in cả đơn (mọi vé VALID -> USED).
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
  reissueTicket,
  listTodayBookings,
  lookupTicketByQr,
  checkInTicket,
  getStaffAssignments,
  replaceStaffAssignments,
}

export default staffApi
