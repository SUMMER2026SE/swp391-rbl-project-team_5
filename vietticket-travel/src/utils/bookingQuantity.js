export function normalizeInitialQuantity(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.floor(numeric))
}
