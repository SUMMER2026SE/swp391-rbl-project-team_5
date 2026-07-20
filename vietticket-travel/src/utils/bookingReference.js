/**
 * Human-facing booking reference.
 *
 * IDs in production are UUIDs, while demo fixtures intentionally share a long
 * prefix. Using the tail keeps references short and, importantly, distinct for
 * both kinds of IDs. The tail is also searchable against the original ID.
 */
export function formatBookingReference(value) {
  const id = String(value || '').trim()
  return id ? `VT-${id.slice(-12).toUpperCase()}` : '—'
}

export function formatRefundRequestReference(value) {
  const id = String(value || '').trim()
  return id ? `RF-${id.slice(-12).toUpperCase()}` : '—'
}

export function formatReservationReference(value) {
  const id = String(value || '').trim()
  return id ? `RS-${id.slice(-12).toUpperCase()}` : '—'
}

export function formatTicketReference(value) {
  const id = String(value || '').trim()
  return id ? `VE-${id.slice(-10).toUpperCase()}` : '—'
}

export function bookingReferenceSearchTerm(value) {
  return String(value || '')
    .trim()
    .replace(/^VT-/i, '')
}

export default formatBookingReference
