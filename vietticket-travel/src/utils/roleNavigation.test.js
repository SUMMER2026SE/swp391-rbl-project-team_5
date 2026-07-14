import { describe, expect, it } from 'vitest'
import { getSafeLoginRedirect } from './roleNavigation.js'

describe('getSafeLoginRedirect', () => {
  it('uses the highest-priority effective role for the default portal', () => {
    expect(getSafeLoginRedirect({
      role: 'CUSTOMER',
      roles: ['CUSTOMER', 'PARTNER', 'ADMIN'],
    })).toBe('/admin')
  })

  it('allows a secondary partner membership to return to a partner route', () => {
    expect(getSafeLoginRedirect(
      { role: 'CUSTOMER', roles: ['CUSTOMER', 'PARTNER'] },
      { pathname: '/partner/bookings', search: '?status=pending' },
    )).toBe('/partner/bookings?status=pending')
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
})
