import { describe, expect, it } from 'vitest'
import { canonicalizeCity, formatAttractionLocation } from './location'

describe('location formatting', () => {
  it.each(['Hồ Chí Minh', 'TP. Hồ Chí Minh', 'TP.HCM', 'Ho Chi Minh City', 'Sài Gòn'])(
    'normalizes %s to the canonical city name',
    (city) => {
      expect(canonicalizeCity(city)).toBe('Thành phố Hồ Chí Minh')
    },
  )

  it('does not repeat district or city components already present in the address', () => {
    expect(formatAttractionLocation({
      address: '65 Lý Tự Trọng, Quận 1',
      district: 'Quận 1',
      city: 'TP. Hồ Chí Minh',
    }, { includeCountry: true })).toBe(
      '65 Lý Tự Trọng, Quận 1, Thành phố Hồ Chí Minh, Việt Nam',
    )
  })
})
