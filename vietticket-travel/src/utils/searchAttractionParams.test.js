import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ATTRACTION_PRICE_RANGE,
  normalizeAttractionPriceRange,
  parseAttractionPriceRange,
} from './searchAttractionParams.js'

describe('attraction price search params', () => {
  it.each([null, undefined, '', '   ', 'abc'])(
    'uses the full default range for a missing or invalid value: %s',
    (value) => {
      expect(normalizeAttractionPriceRange(value)).toBe(DEFAULT_ATTRACTION_PRICE_RANGE)
    },
  )

  it('does not turn a missing maxPrice query into zero', () => {
    expect(parseAttractionPriceRange('?city=Hanoi')).toBe(DEFAULT_ATTRACTION_PRICE_RANGE)
  })

  it('accepts either supported query key and clamps the range', () => {
    expect(parseAttractionPriceRange('?maxPrice=500000')).toBe(500000)
    expect(parseAttractionPriceRange('?priceRange=700000')).toBe(700000)
    expect(parseAttractionPriceRange('?maxPrice=-10')).toBe(0)
    expect(parseAttractionPriceRange('?maxPrice=999999999')).toBe(
      DEFAULT_ATTRACTION_PRICE_RANGE,
    )
  })
})
