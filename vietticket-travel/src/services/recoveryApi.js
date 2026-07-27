import { apiRequest } from './api.js'

export async function listRecoveryCases(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const response = await apiRequest(`/recovery-cases${query}`, { method: 'GET' })
  return Array.isArray(response.data) ? response.data : []
}

export async function getRecoveryCase(id) {
  const response = await apiRequest(`/recovery-cases/${id}`, { method: 'GET' })
  return response.data
}

export async function acceptRecoveryOption(id, option) {
  const response = await apiRequest(`/recovery-cases/${id}/accept`, {
    method: 'POST',
    body: {
      ticketProductId: option.ticketProductId,
      timeSlotId: option.timeSlotId || null,
    },
  })
  return response.data
}

export async function declineRecoveryCase(id) {
  const response = await apiRequest(`/recovery-cases/${id}/decline`, {
    method: 'POST',
  })
  return response.data
}
