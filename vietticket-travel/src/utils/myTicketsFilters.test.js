import { describe, expect, it } from 'vitest'
import {
  filterBookingsByTicketTab,
  getRemainingPaymentTime,
  isPaymentExpired,
} from './myTicketsFilters.js'

const NOW = new Date('2026-07-09T03:00:00.000Z').getTime()

describe('my tickets filters', () => {
  const bookings = [
    { id: 'unpaid-open', status: 'unpaid', expiresAt: '2026-07-09T03:15:00.000Z' },
    { id: 'unpaid-expired', status: 'PENDING_PAYMENT', expiresAt: '2026-07-09T02:59:00.000Z' },
    { id: 'confirmed', status: 'confirmed' },
    { id: 'pending-partner', status: 'PENDING_PARTNER' },
    { id: 'refund-requested', status: 'refund_requested' },
    { id: 'completed', status: 'completed' },
    { id: 'cancelled', status: 'cancelled' },
    { id: 'refunded', status: 'refunded' },
    { id: 'no-show', status: 'NO_SHOW' },
  ]

  it('keeps only non-expired unpaid bookings in the unpaid tab', () => {
    expect(filterBookingsByTicketTab(bookings, 'unpaid', NOW).map((b) => b.id)).toEqual([
      'unpaid-open',
    ])
  })

  it('keeps active operational bookings in the active tab', () => {
    expect(filterBookingsByTicketTab(bookings, 'active', NOW).map((b) => b.id)).toEqual([
      'confirmed',
      'pending-partner',
      'refund-requested',
    ])
  })

  it('keeps expired payments and terminal outcomes in the history tab', () => {
    expect(filterBookingsByTicketTab(bookings, 'history', NOW).map((b) => b.id)).toEqual([
      'unpaid-expired',
      'completed',
      'cancelled',
      'refunded',
      'no-show',
    ])
  })

  it('calculates payment expiry safely', () => {
    expect(getRemainingPaymentTime('2026-07-09T03:01:00.000Z', NOW)).toBe(60_000)
    expect(isPaymentExpired(bookings[1], NOW)).toBe(true)
  })

  it('treats missing or invalid payment expiry as expired', () => {
    expect(getRemainingPaymentTime('', NOW)).toBe(0)
    expect(getRemainingPaymentTime('not-a-date', NOW)).toBe(0)
    expect(isPaymentExpired({ status: 'unpaid', expiresAt: 'not-a-date' }, NOW)).toBe(true)
  })
})
