const DAY_MS = 24 * 60 * 60 * 1000

export function getVietnamDateInput(offsetDays = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const vietnamMidnightUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  )
  return new Date(vietnamMidnightUtc + Number(offsetDays || 0) * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

export const getVietnamTodayInput = () => getVietnamDateInput(0)
export const getVietnamTomorrowInput = () => getVietnamDateInput(1)
