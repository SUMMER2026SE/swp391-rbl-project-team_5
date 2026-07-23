import { apiRequest } from './api.js'

export function activateLiveTrip(planId, { startDate } = {}) {
  const body = { planId }
  if (startDate) body.startDate = startDate

  return apiRequest('/live/trips', {
    method: 'POST',
    body,
  })
}

export function getLiveTrips() {
  return apiRequest('/live/trips', { method: 'GET' })
}

export function getLiveTrip(tripId) {
  return apiRequest(`/live/trips/${encodeURIComponent(tripId)}`, { method: 'GET' })
}

export function getAttractionPressure(attractionId, date) {
  const params = new URLSearchParams({ date })
  return apiRequest(
    `/live/attractions/${encodeURIComponent(attractionId)}/pressure?${params.toString()}`,
    { method: 'GET' },
  )
}

export function refreshLiveTripAutopilot(tripId) {
  return apiRequest(`/live/trips/${encodeURIComponent(tripId)}/autopilot/refresh`, {
    method: 'POST',
  })
}

export function simulateLiveTripAutopilot(tripId) {
  return apiRequest(`/live/trips/${encodeURIComponent(tripId)}/autopilot/simulate`, {
    method: 'POST',
  })
}

export function predictLiveArrivals(attractionId, date, horizonMinutes = 15) {
  const params = new URLSearchParams({ date, horizonMinutes: String(horizonMinutes) })
  return apiRequest(`/live/attractions/${encodeURIComponent(attractionId)}/predict-arrivals?${params.toString()}`, { method: 'GET' })
}

export function predictLiveWait(attractionId, date, guestsAhead, partySize) {
  const params = new URLSearchParams({
    date,
    guestsAhead: String(guestsAhead || 0),
    partySize: String(partySize || 1),
  })
  return apiRequest(`/live/attractions/${encodeURIComponent(attractionId)}/predict-wait?${params.toString()}`, { method: 'GET' })
}

export function decideLiveTripProposal(tripId, proposalId, decision) {
  return apiRequest(
    `/live/trips/${encodeURIComponent(tripId)}/proposals/${encodeURIComponent(proposalId)}/decision`,
    { method: 'POST', body: { decision } },
  )
}

function smartQueuePath(tripId, itemId) {
  return `/live/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}/queue`
}

export function getSmartQueue(tripId, itemId) {
  return apiRequest(smartQueuePath(tripId, itemId), { method: 'GET' })
}

export function joinSmartQueue(tripId, itemId) {
  return apiRequest(smartQueuePath(tripId, itemId), { method: 'POST' })
}

export function leaveSmartQueue(tripId, itemId) {
  return apiRequest(smartQueuePath(tripId, itemId), { method: 'DELETE' })
}
