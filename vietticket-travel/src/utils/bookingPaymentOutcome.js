const PAID_BOOKING_STATUSES = new Set([
  'pending_partner',
  'confirmed',
  'completed',
  'no_show',
])

const normalizeStatus = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

/**
 * Resolve the payment result from authenticated booking data.
 *
 * Callback query parameters are only used to explain an already-unpaid
 * booking. They are never sufficient to turn a result into "success".
 */
export function deriveBookingPaymentOutcome({
  booking,
  bookingId,
  callbackStatus,
  isLoading,
  loadError,
  responseCode,
}) {
  if (!bookingId) return 'unknown'
  if (isLoading) return 'verifying'
  if (loadError || !booking) return 'unknown'

  const bookingStatus = normalizeStatus(booking.status)
  const paymentStatus = normalizeStatus(booking.paymentStatus)

  if (
    paymentStatus === 'success'
    && PAID_BOOKING_STATUSES.has(bookingStatus)
  ) {
    return 'success'
  }

  if (bookingStatus === 'unpaid' && paymentStatus !== 'success') {
    if (normalizeStatus(callbackStatus) === 'invalid' || responseCode === '00') {
      return 'invalid'
    }

    if (
      normalizeStatus(callbackStatus) === 'failed'
      || (responseCode && responseCode !== '00')
    ) {
      return 'failed'
    }

    return 'pending'
  }

  // CANCELLED/REFUNDED/REFUND_REQUESTED or inconsistent data must never
  // render a newly successful payment based on a browser-controlled URL.
  return 'invalid'
}

export function canRetryBookingPayment(booking) {
  return (
    normalizeStatus(booking?.status) === 'unpaid'
    && normalizeStatus(booking?.paymentStatus) !== 'success'
  )
}
