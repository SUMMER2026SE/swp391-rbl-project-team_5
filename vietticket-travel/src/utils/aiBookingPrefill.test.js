import { describe, expect, it } from 'vitest'
import { buildAiBookingUrl, isDateInputValue } from './aiBookingPrefill.js'

describe('ai booking prefill helpers', () => {
  it('builds a booking URL with ticket, date, quantity and time slot prefill', () => {
    const url = buildAiBookingUrl({
      attractionId: 'attr-1',
      fallbackDate: '2026-07-15',
      ticketLine: {
        ticketId: 'ticket-1',
        quantity: 3,
        suggestedTimeSlot: { timeSlotId: 'slot-1' },
      },
    })

    expect(url).toBe(
      '/attractions/attr-1?bookNow=1&source=ai&ticketId=ticket-1&date=2026-07-15&qty=3&timeSlotId=slot-1',
    )
  })

  it('omits invalid optional values and requires an attraction id', () => {
    expect(buildAiBookingUrl({ attractionId: '', fallbackDate: '2026-07-15' })).toBe('')
    expect(
      buildAiBookingUrl({
        attractionId: 'attr-2',
        fallbackDate: 'not-a-date',
        ticketLine: { quantity: 0 },
      }),
    ).toBe('/attractions/attr-2?bookNow=1&source=ai')
  })

  it('appends safe extra params for AI booking queue tracking', () => {
    const url = buildAiBookingUrl({
      attractionId: 'attr-1',
      ticketLine: { ticketId: 'ticket-1', quantity: 2 },
      extraParams: {
        aiQueueId: 'queue-1',
        aiQueueItemId: 'item-1',
        emptyValue: '',
      },
    })

    expect(url).toBe(
      '/attractions/attr-1?bookNow=1&source=ai&ticketId=ticket-1&qty=2&aiQueueId=queue-1&aiQueueItemId=item-1',
    )
  })

  it('recognizes date input values only in yyyy-mm-dd format', () => {
    expect(isDateInputValue('2026-07-15')).toBe(true)
    expect(isDateInputValue('15/07/2026')).toBe(false)
  })
})
