import { describe, expect, it } from 'vitest'
import { normalizeInitialQuantity } from '../utils/bookingQuantity.js'

describe('normalizeInitialQuantity', () => {
  it('keeps valid positive quantities', () => {
    expect(normalizeInitialQuantity(3)).toBe(3)
    expect(normalizeInitialQuantity('2')).toBe(2)
  })

  it('falls back to one for empty or invalid values', () => {
    expect(normalizeInitialQuantity(0)).toBe(1)
    expect(normalizeInitialQuantity(-4)).toBe(1)
    expect(normalizeInitialQuantity('abc')).toBe(1)
  })

  it('uses a whole ticket quantity', () => {
    expect(normalizeInitialQuantity(2.9)).toBe(2)
  })
})
