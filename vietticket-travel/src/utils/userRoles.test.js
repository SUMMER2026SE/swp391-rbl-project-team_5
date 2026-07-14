import { describe, expect, it } from 'vitest'
import { getUserRoles, hasAnyRole, hasRole } from './userRoles.js'

describe('userRoles', () => {
  it('keeps the primary role as a backward-compatible fallback', () => {
    expect(getUserRoles({ role: 'CUSTOMER' })).toEqual(['CUSTOMER'])
  })

  it('recognizes both customer and partner capabilities', () => {
    const user = { role: 'PARTNER', roles: ['PARTNER', 'CUSTOMER'] }

    expect(hasRole(user, 'PARTNER')).toBe(true)
    expect(hasRole(user, 'CUSTOMER')).toBe(true)
    expect(hasAnyRole(user, ['ADMIN', 'CUSTOMER'])).toBe(true)
  })

  it('ignores malformed and duplicate roles', () => {
    expect(getUserRoles({ role: 'PARTNER', roles: ['PARTNER', 'UNKNOWN', null] })).toEqual([
      'PARTNER',
    ])
  })
})
