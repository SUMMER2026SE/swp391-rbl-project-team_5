function toNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function hasItineraryMapPoint(activity) {
  const latitude = toNumber(activity?.latitude)
  const longitude = toNumber(activity?.longitude)
  return latitude != null && longitude != null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

export function getItineraryMapPoints(activities = []) {
  return activities
    .filter(hasItineraryMapPoint)
    .map((activity, index) => ({
      id: activity.attractionId || `${activity.title || 'activity'}-${index}`,
      position: [Number(activity.latitude), Number(activity.longitude)],
      title: activity.title || activity.name || `Điểm ${index + 1}`,
      time: activity.suggestedTime || activity.timeSlot || '',
    }))
}
