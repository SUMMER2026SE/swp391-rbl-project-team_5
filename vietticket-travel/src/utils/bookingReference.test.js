import { describe, expect, it } from 'vitest'
import {
  bookingReferenceSearchTerm,
  formatBookingReference,
  formatRefundRequestReference,
  formatReservationReference,
} from './bookingReference'

describe('formatBookingReference', () => {
  it('keeps opaque customer-facing references distinguishable', () => {
    const approved = formatBookingReference('7ac041ae-f36b-4a3d-ac91-c3e71a9b520f')
    const refund = formatBookingReference('afe2108c-27bd-40a3-af51-d2a7f9406e1c')

    expect(approved).not.toBe(refund)
    expect(approved).toBe('VT-C3E71A9B520F')
    expect(refund).toBe('VT-D2A7F9406E1C')
  })

  it('uses the searchable UUID tail', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const reference = formatBookingReference(id)

    expect(reference).toBe('VT-426614174000')
    expect(id).toContain(bookingReferenceSearchTerm(reference).toLowerCase())
  })

  it('formats refund request identifiers without exposing the full UUID', () => {
    expect(formatRefundRequestReference('ddf3517a-a4cd-4c91-ad27-2e9a61c4b7d0')).toBe('RF-2E9A61C4B7D0')
  })

  it('formats temporary reservation identifiers separately from bookings', () => {
    expect(formatReservationReference('6cb82510-1a7e-4da1-a839-8e43a1c7d2f5')).toBe('RS-8E43A1C7D2F5')
  })
})
