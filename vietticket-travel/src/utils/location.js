function comparable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(thanh pho|tp\.?|city)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function canonicalizeCity(value) {
  const raw = String(value || '').trim()
  const key = comparable(raw)
  if (['ho chi minh', 'hcm', 'sai gon'].includes(key)) return 'Thành phố Hồ Chí Minh'
  return raw
}

export function formatAttractionLocation(attraction = {}, { includeCountry = false } = {}) {
  const parts = []
  const values = [
    attraction.address,
    attraction.district,
    canonicalizeCity(attraction.city || attraction.province),
    includeCountry ? 'Việt Nam' : '',
  ]

  values.forEach((value) => {
    const part = String(value || '').trim()
    const key = comparable(part)
    if (!part || !key) return
    if (parts.some((existing) => {
      const existingKey = comparable(existing)
      return existingKey === key || existingKey.includes(key) || key.includes(existingKey)
    })) return
    parts.push(part)
  })

  return parts.join(', ') || (includeCountry ? 'Việt Nam' : 'Chưa cập nhật địa chỉ')
}
