export const SAVED_ITINERARIES_KEY = 'vietticket_saved_itineraries'
export const ITINERARY_FEEDBACK_KEY = 'vietticket_itinerary_feedback'

const MAX_SAVED_ITINERARIES = 20

function getDefaultStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readJsonArray(storage, key) {
  if (!storage) return []

  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizedOwnerId(ownerId) {
  return String(ownerId || '').trim()
}

function scopedStorageKey(baseKey, ownerId) {
  return `${baseKey}:${normalizedOwnerId(ownerId) || 'guest'}`
}

function readScopedArray(storage, baseKey, ownerId) {
  if (!storage) return []
  const owner = normalizedOwnerId(ownerId)
  const key = scopedStorageKey(baseKey, owner)

  if (storage.getItem(key) != null) {
    return readJsonArray(storage, key)
  }

  // Di chuyển an toàn dữ liệu cũ: tài khoản chỉ nhận các bản đã mang đúng
  // ownerId; bản không xác định chủ sở hữu chỉ được giữ trong vùng guest.
  const legacy = readJsonArray(storage, baseKey)
  const compatible = legacy.filter((item) =>
    owner ? item?.ownerId === owner : !item?.ownerId,
  )
  if (compatible.length > 0) storage.setItem(key, JSON.stringify(compatible))
  return compatible
}

export function createItinerarySnapshot(plan, criteria = {}, now = Date.now()) {
  if (!plan || typeof plan !== 'object') return null

  return {
    id: plan.clientPlanId || `itinerary-${now}`,
    createdAt: new Date(now).toISOString(),
    criteria,
    ownerId: criteria.ownerId || criteria.userId || null,
    plan,
    title: plan.title || criteria.city || 'Lịch trình AI',
  }
}

export function loadSavedItineraries(storage = getDefaultStorage(), ownerId = '') {
  return readScopedArray(storage, SAVED_ITINERARIES_KEY, ownerId)
}

export function saveItinerarySnapshot(
  snapshot,
  storage = getDefaultStorage(),
  ownerId = snapshot?.ownerId || '',
) {
  if (!storage || !snapshot?.id) return null

  const owner = normalizedOwnerId(ownerId)
  const scopedSnapshot = { ...snapshot, ownerId: owner || null }
  const current = loadSavedItineraries(storage, owner)
  const next = [
    scopedSnapshot,
    ...current.filter((item) => item?.id !== scopedSnapshot.id),
  ].slice(0, MAX_SAVED_ITINERARIES)

  storage.setItem(scopedStorageKey(SAVED_ITINERARIES_KEY, owner), JSON.stringify(next))
  return scopedSnapshot
}

export function removeItinerarySnapshot(
  planId,
  storage = getDefaultStorage(),
  ownerId = '',
) {
  if (!storage || !planId) return []

  const owner = normalizedOwnerId(ownerId)
  const next = loadSavedItineraries(storage, owner).filter((item) => item?.id !== planId)
  storage.setItem(scopedStorageKey(SAVED_ITINERARIES_KEY, owner), JSON.stringify(next))
  return next
}

export function saveItineraryFeedback(
  planId,
  value,
  storage = getDefaultStorage(),
  ownerId = '',
) {
  if (!storage || !planId || !['up', 'down'].includes(value)) return null

  const owner = normalizedOwnerId(ownerId)
  const current = readScopedArray(storage, ITINERARY_FEEDBACK_KEY, owner)
  const feedback = {
    planId,
    value,
    ownerId: owner || null,
    updatedAt: new Date().toISOString(),
  }
  const next = [feedback, ...current.filter((item) => item?.planId !== planId)]
  storage.setItem(scopedStorageKey(ITINERARY_FEEDBACK_KEY, owner), JSON.stringify(next))
  return feedback
}

export function getItineraryFeedback(
  planId,
  storage = getDefaultStorage(),
  ownerId = '',
) {
  if (!storage || !planId) return ''
  const found = readScopedArray(storage, ITINERARY_FEEDBACK_KEY, ownerId).find(
    (item) => item?.planId === planId,
  )
  return found?.value || ''
}

export function buildItineraryShareText(plan) {
  if (!plan) return ''

  const lines = [
    plan.title || 'Lịch trình VietTicket Travel',
    plan.description || plan.summary || '',
  ].filter(Boolean)

  if (Array.isArray(plan.days)) {
    plan.days.forEach((day, dayIndex) => {
      lines.push('')
      lines.push(day.day ? `Ngày ${day.day}: ${day.title || day.theme || ''}` : `Ngày ${dayIndex + 1}`)
      const activities = Array.isArray(day.activities) ? day.activities : day.items || []
      activities.slice(0, 5).forEach((activity) => {
        const title = activity.title || activity.name || activity.destination || 'Điểm tham quan'
        const time = activity.suggestedTime || activity.timeSlot || activity.time || ''
        lines.push(`- ${time ? `${time}: ` : ''}${title}`)
      })
    })
  }

  lines.push('')
  lines.push('Tạo bởi VietTicket Travel')
  return lines.join('\n').trim()
}

// ----------------------------------------------------------------
// P1-C: Server-side sync helpers
// Luôn giữ localStorage là nguồn sự thật offline / khách vãng lai.
// Server chỉ dùng để đồng bộ khi user đã đăng nhập và online.
// ----------------------------------------------------------------

/**
 * Đồng bộ 1 lịch trình vừa tạo/cập nhật lên server.
 * Silently fail nếu user chưa đăng nhập hoặc mạng lỗi.
 *
 * @param {object}   snapshot  - Snapshot đã lưu trong localStorage.
 * @param {Function} saveApiFn - Hàm API (saveAiItinerary từ aiApi.js), inject để tránh circular import.
 * @returns {Promise<boolean>} true nếu sync thành công.
 */
export async function syncItineraryToServer(snapshot, saveApiFn) {
  if (!snapshot?.id || typeof saveApiFn !== 'function') return false

  try {
    await saveApiFn({
      planId: snapshot.id,
      title: snapshot.title || snapshot.plan?.title || 'Lịch trình AI',
      plan: snapshot.plan,
      criteria: snapshot.criteria || null,
    })
    return true
  } catch {
    // Không throw — mất kết nối hoặc chưa đăng nhập là bình thường.
    return false
  }
}

/**
 * Load lịch trình từ server và merge vào localStorage.
 * - Các bản server mới hơn (updatedAt) sẽ ghi đè bản local.
 * - Các bản local-only (không có trên server) được giữ nguyên.
 * - Kết quả cuối lưu lại vào localStorage để dùng offline.
 *
 * @param {Function} getApiFn  - Hàm API (getSavedAiItineraries).
 * @param {Function} getByIdFn - Hàm API (getSavedAiItineraryById).
 * @param {object}   [storage] - localStorage instance (default).
 * @returns {Promise<Array>} Danh sách merged itineraries.
 */
export async function loadItinerariesFromServer(
  getApiFn,
  getByIdFn,
  storage = getDefaultStorage(),
  ownerId = '',
) {
  const owner = normalizedOwnerId(ownerId)
  if (!owner || typeof getApiFn !== 'function') {
    return loadSavedItineraries(storage, owner)
  }

  try {
    const response = await getApiFn()
    const serverList = Array.isArray(response?.data) ? response.data : []

    if (serverList.length === 0) return loadSavedItineraries(storage, owner)

    const localList = loadSavedItineraries(storage, owner)
    const localById = new Map(localList.map((item) => [item.id, item]))

    const merged = [...localList]
    const mergedIds = new Set(localList.map((i) => i.id))

    await Promise.all(
      serverList.map(async (serverItem) => {
        const planId = serverItem.planId
        const localItem = localById.get(planId)
        const serverUpdatedAt = serverItem.updatedAt ? new Date(serverItem.updatedAt).getTime() : 0
        const localUpdatedAt = localItem?.updatedAt ? new Date(localItem.updatedAt).getTime() : 0

        // Chỉ fetch data đầy đủ khi server mới hơn hoặc local chưa có.
        if (!localItem || serverUpdatedAt > localUpdatedAt) {
          try {
            if (typeof getByIdFn === 'function') {
              const detail = await getByIdFn(planId)
              if (detail?.data?.data) {
                const snapshot = {
                  id: planId,
                  title: detail.data.title,
                  createdAt: detail.data.createdAt,
                  updatedAt: detail.data.updatedAt,
                  criteria: detail.data.criteria || null,
                  ownerId: owner,
                  plan: detail.data.data,
                }
                if (mergedIds.has(planId)) {
                  const idx = merged.findIndex((i) => i.id === planId)
                  if (idx !== -1) merged[idx] = snapshot
                } else {
                  merged.unshift(snapshot)
                  mergedIds.add(planId)
                }
              }
            }
          } catch {
            // Giữ bản local nếu fetch thất bại.
          }
        }
      }),
    )

    // Sắp xếp mới nhất trước và persist lại vào localStorage.
    const sorted = merged
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0),
      )
      .slice(0, MAX_SAVED_ITINERARIES)

    if (storage) {
      storage.setItem(scopedStorageKey(SAVED_ITINERARIES_KEY, owner), JSON.stringify(sorted))
    }

    return sorted
  } catch {
    // Server offline hoặc chưa đăng nhập -> trả về bản local.
    return loadSavedItineraries(storage, owner)
  }
}
