import { describe, expect, it } from 'vitest'
import { getSafeLoginRedirect } from './roleNavigation.js'

describe('getSafeLoginRedirect', () => {
  it('uses the highest-priority effective role for the default portal', () => {
    expect(getSafeLoginRedirect({
      role: 'CUSTOMER',
      roles: ['CUSTOMER', 'PARTNER', 'ADMIN'],
    })).toBe('/admin')
  })

  it('always sends a partner to the partner dashboard after login', () => {
    expect(getSafeLoginRedirect(
      { role: 'CUSTOMER', roles: ['CUSTOMER', 'PARTNER'] },
      { pathname: '/partner/bookings', search: '?status=pending' },
    )).toBe('/partner/dashboard')
  })

  it('keeps partner staff away from platform support queues', () => {
    expect(getSafeLoginRedirect(
      {
        role: 'CUSTOMER',
        roles: ['CUSTOMER', 'STAFF'],
        employerPartnerId: 'partner-1',
      },
      { pathname: '/staff/refunds' },
    )).toBe('/staff/checkin')
  })

  it('does not send an operational role back to a customer-facing page', () => {
    expect(getSafeLoginRedirect(
      { role: 'ADMIN', roles: ['CUSTOMER', 'ADMIN'] },
      { pathname: '/favorites' },
    )).toBe('/admin')
  })
})
