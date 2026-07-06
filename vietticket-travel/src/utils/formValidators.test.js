import { describe, expect, it } from 'vitest'
import { validateEmail, validateOptionalPhone, validatePhone } from './formValidators.js'

describe('form validators', () => {
  it('validates email format consistently', () => {
    expect(validateEmail('customer@example.com')).toBe('')
    expect(validateEmail('customer.example.com')).toContain('Email')
    expect(validateEmail('')).toContain('email')
  })

  it('accepts valid Vietnamese phone numbers with common separators', () => {
    expect(validatePhone('0901234567')).toBe('')
    expect(validateOptionalPhone('+84 901 234 567')).toBe('')
    expect(validateOptionalPhone('090-123-4567')).toBe('')
  })

  it('allows empty optional phone but rejects invalid filled values', () => {
    expect(validateOptionalPhone('')).toBe('')
    expect(validateOptionalPhone('abcdefg')).toContain('không hợp lệ')
    expect(validateOptionalPhone('1234567')).toContain('không hợp lệ')
  })
})
