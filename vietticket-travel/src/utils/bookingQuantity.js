export function normalizeInitialQuantity(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.floor(numeric))
}

export function updateSingleTicketQuantity(current, ticketId, delta) {
  const normalizedId = String(ticketId || '').trim()
  if (!normalizedId) return {}
  const currentQuantity = Number(current?.[normalizedId]) || 0
  const nextQuantity = Math.max(1, currentQuantity + Number(delta || 0))
  return { [normalizedId]: Math.floor(nextQuantity) }
}
