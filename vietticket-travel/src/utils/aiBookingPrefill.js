export const AI_BOOKING_SOURCE = 'ai'

const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateInputValue(value) {
  return typeof value === 'string' && DATE_INPUT_RE.test(value)
}

export function buildAiBookingUrl({
  attractionId,
  fallbackDate = '',
  ticketLine = null,
  extraParams = {},
}) {
  if (!attractionId) return ''

  const params = new URLSearchParams({
    bookNow: '1',
    source: AI_BOOKING_SOURCE,
  })

  if (ticketLine?.ticketId) {
    params.set('ticketId', String(ticketLine.ticketId))
  }

  const visitDate = ticketLine?.availabilityDate || fallbackDate
  if (isDateInputValue(visitDate)) {
    params.set('date', visitDate)
  }

  const quantity = Number(ticketLine?.quantity)
  if (Number.isFinite(quantity) && quantity > 0) {
    params.set('qty', String(Math.floor(quantity)))
  }

  const timeSlotId = ticketLine?.suggestedTimeSlot?.timeSlotId
  if (timeSlotId) {
    params.set('timeSlotId', String(timeSlotId))
  }

  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value == null || value === '') return
    params.set(key, String(value))
  })

  return `/attractions/${attractionId}?${params.toString()}`
}
