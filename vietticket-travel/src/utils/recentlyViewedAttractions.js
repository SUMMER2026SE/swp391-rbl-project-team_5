export const RECENTLY_VIEWED_ATTRACTIONS_KEY = 'vietticket_recently_viewed_attractions_v1'
export const RECENTLY_VIEWED_ATTRACTIONS_LIMIT = 6

const getDefaultStorage = () => {
  if (typeof window === 'undefined') return null
  return window.localStorage || null
}

const safeParseItems = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function normalizeViewedAttraction(attraction, viewedAt = Date.now()) {
  const id = String(attraction?.id || '').trim()
  const title = String(attraction?.title || attraction?.name || '').trim()

  if (!id || !title) return null

  return {
    id,
    title,
    city: attraction?.city || '',
    minPrice: Number(attraction?.minPrice || attraction?.price || attraction?.startingPrice || 0),
    averageRating: Number(attraction?.averageRating || attraction?.rating || 0),
    totalReviews: Number(attraction?.totalReviews || attraction?.reviewCount || 0),
    primaryImage: attraction?.primaryImage || attraction?.imageUrl || '',
    viewedAt,
  }
}

export function getRecentlyViewedAttractions(storage = getDefaultStorage()) {
  if (!storage) return []

  let rawItems
  try {
    rawItems = storage.getItem(RECENTLY_VIEWED_ATTRACTIONS_KEY)
  } catch {
    return []
  }

  const items = safeParseItems(rawItems)
  return items
    .map((item) => normalizeViewedAttraction(item, Number(item?.viewedAt) || Date.now()))
    .filter(Boolean)
    .slice(0, RECENTLY_VIEWED_ATTRACTIONS_LIMIT)
}

export function saveRecentlyViewedAttraction(
  attraction,
  storage = getDefaultStorage(),
  viewedAt = Date.now(),
) {
  if (!storage) return []

  const normalized = normalizeViewedAttraction(attraction, viewedAt)
  if (!normalized) return getRecentlyViewedAttractions(storage)

  const currentItems = getRecentlyViewedAttractions(storage)
  const nextItems = [
    normalized,
    ...currentItems.filter((item) => item.id !== normalized.id),
  ].slice(0, RECENTLY_VIEWED_ATTRACTIONS_LIMIT)

  try {
    storage.setItem(RECENTLY_VIEWED_ATTRACTIONS_KEY, JSON.stringify(nextItems))
  } catch {
    return currentItems
  }

  return nextItems
}
