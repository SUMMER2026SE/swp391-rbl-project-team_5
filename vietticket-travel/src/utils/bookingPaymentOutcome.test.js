import { describe, expect, it } from 'vitest'
import {
  canRetryBookingPayment,
  deriveBookingPaymentOutcome,
} from './bookingPaymentOutcome.js'

const resolve = (overrides = {}) =>
  deriveBookingPaymentOutcome({
    booking: null,
    bookingId: 'booking-1',
    callbackStatus: 'success',
    isLoading: false,
    loadError: null,
    responseCode: '00',
    ...overrides,
  })

describe('booking payment outcome', () => {
  it('never trusts a success query when the server booking is unpaid', () => {
    expect(
      resolve({
        booking: { status: 'unpaid', paymentStatus: 'pending' },
      }),
    ).toBe('invalid')
  })

  it('accepts success only for a paid server-side booking state', () => {
    expect(
      resolve({
        booking: { status: 'confirmed', paymentStatus: 'success' },
        callbackStatus: 'failed',
        responseCode: '24',
      }),
    ).toBe('success')
  })

  it('keeps a partner-approval booking as a verified success', () => {
    expect(
      resolve({
        booking: { status: 'pending_partner', paymentStatus: 'success' },
      }),
    ).toBe('success')
  })

  it('does not complete success while authenticated booking data is loading', () => {
    expect(resolve({ isLoading: true })).toBe('verifying')
  })

  it('does not trust callback data when the booking cannot be loaded', () => {
    expect(resolve({ loadError: new Error('Forbidden') })).toBe('unknown')
  })

  it('only allows payment retry for an unpaid booking', () => {
    expect(canRetryBookingPayment({ status: 'unpaid', paymentStatus: 'failed' })).toBe(true)
    expect(canRetryBookingPayment({ status: 'cancelled', paymentStatus: 'failed' })).toBe(false)
    expect(canRetryBookingPayment({ status: 'confirmed', paymentStatus: 'success' })).toBe(false)
  })
})
