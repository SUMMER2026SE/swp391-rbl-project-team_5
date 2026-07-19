export function getRemainingPaymentTime(expiresAt, nowMs) {
  const expiresAtMs = new Date(expiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return 0
  return Math.max(0, expiresAtMs - nowMs)
}

export function normalizeBookingStatus(status) {
  const normalized = String(status || '').toLowerCase()
  return ['pending', 'pending_payment'].includes(normalized) ? 'unpaid' : normalized
}

export function isPaymentExpired(booking, nowMs) {
  return (
    normalizeBookingStatus(booking?.status) === 'unpaid' &&
    getRemainingPaymentTime(booking?.expiresAt, nowMs) === 0
  )
}

export function filterBookingsByTicketTab(bookings, activeTab, nowMs) {
  const list = Array.isArray(bookings) ? bookings : []

  return list.filter((booking) => {
    const status = normalizeBookingStatus(booking.status)
    const expiredPayment = isPaymentExpired(booking, nowMs)

    if (activeTab === 'unpaid') return status === 'unpaid' && !expiredPayment
    if (activeTab === 'active') {
      return ['confirmed', 'pending_partner', 'refund_requested'].includes(status)
    }
    if (activeTab === 'history') {
      return (
        expiredPayment ||
        ['completed', 'cancelled', 'refunded', 'no_show'].includes(status)
      )
    }
    return true
  })
}
