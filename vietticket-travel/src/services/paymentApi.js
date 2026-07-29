import { apiRequest } from './api.js'

// Phương thức thanh toán đang mở (chuyển khoản chỉ xuất hiện khi nền tảng
// đã cấu hình tài khoản ngân hàng nhận tiền).
export function getPaymentMethods() {
  return apiRequest('/payments/methods', { method: 'GET' })
}

// Mã VietQR + hướng dẫn chuyển khoản cho một đơn (chỉ chủ đơn xem được).
export function getBankTransferInstruction(bookingId) {
  return apiRequest(`/payments/bank-transfer/${encodeURIComponent(bookingId)}`, {
    method: 'GET',
  })
}

// ----- Admin: đối chiếu sao kê -----
export function listBankTransferQueue() {
  return apiRequest('/admin/bank-transfers', { method: 'GET' })
}

export function confirmBankTransfer(bookingId, payload = {}) {
  return apiRequest(
    `/admin/bank-transfers/${encodeURIComponent(bookingId)}/confirm`,
    { method: 'POST', body: payload },
  )
}
