/**
 * Human-facing booking reference.
 *
 * Persistence IDs are UUIDs. Using the opaque tail keeps references short,
 * stable and searchable without exposing the full internal identifier.
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
