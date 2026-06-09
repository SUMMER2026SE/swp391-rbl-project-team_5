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

export const confirmPayment = async (bookingId, status, details = {}) => {
  const result = await apiRequest(`/bookings/${bookingId}/payment-status`, {
    method: 'PATCH',
    body: {
      status,
      ...details,
    },
  })
  return result.data
}

const bookingService = {
  applyVoucher,
  confirmPayment,
  createBooking,
  getBookingDetails,
  getBookings,
  getLastReservationId,
  getReservationDetails,
  reserveTicket,
}

export default bookingService
