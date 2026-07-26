function vietnamTimeKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function selectLiveTripPressure(pressure, item) {
  const summary = pressure?.summary || null
  if (!summary) return { basis: 'UNAVAILABLE', metrics: null, slot: null }

  const slots = Array.isArray(pressure?.slots) ? pressure.slots : []
  const timeSlotId = String(
    item?.snapshot?.timeSlotId
      || item?.snapshot?.activity?.suggestedTimeSlot?.timeSlotId
      || '',
  ).trim()
  const scheduledTime = vietnamTimeKey(item?.scheduledStart)
  const slot = slots.find((candidate) => (
    (timeSlotId && candidate?.timeSlotId === timeSlotId)
      || (!timeSlotId && scheduledTime && candidate?.startTime === scheduledTime)
  )) || null

  if (!slot) return { basis: 'DAY', metrics: summary, slot: null }
  return {
    basis: 'TIME_SLOT',
    metrics: { ...summary, ...slot },
    slot,
  }
}
