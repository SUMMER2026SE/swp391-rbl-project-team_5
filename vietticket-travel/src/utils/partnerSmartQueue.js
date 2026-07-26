export function getPartnerAttractionRows(response) {
  const rows = response?.attractions ?? response?.data
  return Array.isArray(rows) ? rows : []
}

export function getPartnerAttractionLabel(attraction) {
  const name = String(attraction?.name ?? attraction?.title ?? '').trim()
  const city = String(attraction?.city ?? '').trim()

  if (!name) return city
  return city ? `${name} · ${city}` : name
}
