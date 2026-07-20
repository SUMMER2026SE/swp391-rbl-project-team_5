import { describe, expect, it } from 'vitest'
import {
  bookingReferenceSearchTerm,
  formatBookingReference,
  formatRefundRequestReference,
  formatReservationReference,
} from './bookingReference'

describe('formatBookingReference', () => {
  it('keeps customer-facing numeric references with a shared prefix distinguishable', () => {
    const approved = formatBookingReference('defense-demo-v1-booking-260720000003')
    const refund = formatBookingReference('defense-demo-v1-booking-260720000009')

    expect(approved).not.toBe(refund)
    expect(approved).toBe('VT-260720000003')
    expect(refund).toBe('VT-260720000009')
  })

  it('uses the searchable UUID tail', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const reference = formatBookingReference(id)

    expect(reference).toBe('VT-426614174000')
    expect(id).toContain(bookingReferenceSearchTerm(reference).toLowerCase())
  })

  it('formats refund request identifiers without exposing fixture prefixes', () => {
    expect(formatRefundRequestReference('defense-demo-v1-refund-260720000101')).toBe('RF-260720000101')
  })

  it('formats temporary reservation identifiers separately from bookings', () => {
    expect(formatReservationReference('defense-demo-v1-reservation-260720000011')).toBe('RS-260720000011')
  })
})
