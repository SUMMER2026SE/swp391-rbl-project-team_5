export const DEFAULT_ATTRACTION_PRICE_RANGE = 5_000_000

export function normalizeAttractionPriceRange(
  value,
  maximum = DEFAULT_ATTRACTION_PRICE_RANGE,
) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return maximum
  }

  const price = Number(value)
  if (!Number.isFinite(price)) return maximum

  return Math.max(0, Math.min(maximum, price))
}

export function parseAttractionPriceRange(
  search,
  maximum = DEFAULT_ATTRACTION_PRICE_RANGE,
) {
  const params = new URLSearchParams(search)
  const value = params.get('maxPrice') ?? params.get('priceRange')

  return normalizeAttractionPriceRange(value, maximum)
}
