import { apiRequest } from './api.js'

const RESERVATION_STORAGE_KEY = 'vietticket_reservation_id'

const getStorage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const reserveTicket = (payload = {}) => {
  const reservationId =
    typeof payload === 'string'
      ? payload
      : payload.reservationId || payload.bookingId || payload.id || ''

  if (reservationId) {
    getStorage()?.setItem(RESERVATION_STORAGE_KEY, reservationId)
  }

  return reservationId
}

export const getLastReservationId = () =>
  getStorage()?.getItem(RESERVATION_STORAGE_KEY) || ''

export const getReservationDetails = async (reservationId) => {
  const result = await apiRequest(`/bookings/reservations/${reservationId}`, {
    method: 'GET',
  })
  return result.data
}

export const createBooking = async (payload) => {
  const result = await apiRequest('/bookings', {
    method: 'POST',
    body: payload,
  })
  return result.data
}

export const getBookings = async () => {
  const result = await apiRequest('/bookings', { method: 'GET' })
  return Array.isArray(result.data) ? result.data : []
}

export const getBookingDetails = async (bookingId) => {
  const result = await apiRequest(`/bookings/${bookingId}`, { method: 'GET' })
  return result.data
}

export const applyVoucher = async (
  bookingId,
  voucherCode,
  subtotalAmount,
) => {
  const result = await apiRequest('/bookings/apply-voucher', {
    method: 'POST',
    body: {
      bookingId,
      voucherCode,
      subtotalAmount,
    },
  })

  return result
}

// Tạo URL thanh toán VNPay thật; trả về paymentUrl để redirect trình duyệt.
export const createVNPayUrl = async (bookingId) => {
  const result = await apiRequest('/payments/create-vnpay-url', {
    method: 'POST',
    body: { bookingId },
  })
  return result.data?.paymentUrl
}

// Xem trước số tiền hoàn (chính sách, phí, thực nhận) cho modal hoàn tiền.
export const getRefundPreview = async (bookingId) => {
  const result = await apiRequest(`/payments/refund-preview/${bookingId}`, {
    method: 'GET',
  })
  return result.data
}

// Gửi yêu cầu hoàn tiền -> đơn chuyển sang REFUND_REQUESTED, Staff sẽ duyệt.
export const createRefundRequest = async (bookingId, reason) => {
  const result = await apiRequest('/payments/refund-request', {
    method: 'POST',
    body: { bookingId, reason },
  })
  return result.data
}

const bookingService = {
  applyVoucher,
  createBooking,
  createRefundRequest,
  createVNPayUrl,
  getBookingDetails,
  getBookings,
  getLastReservationId,
  getRefundPreview,
  getReservationDetails,
  reserveTicket,
}

export default bookingService
