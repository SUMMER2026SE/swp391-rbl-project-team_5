import { apiRequest } from './api.js'

// Ví điểm thưởng của khách hàng.
export function getLoyaltySummary() {
  return apiRequest('/loyalty/me', { method: 'GET' })
}

export function getLoyaltyTransactions({ limit = 20, cursor } = {}) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return apiRequest(`/loyalty/transactions${query ? `?${query}` : ''}`, { method: 'GET' })
}

export function getRedemptionCatalog() {
  return apiRequest('/loyalty/catalog', { method: 'GET' })
}

export function redeemLoyaltyPoints(tierId) {
  return apiRequest('/loyalty/redeem', { method: 'POST', body: { tierId } })
}

export function getMyLoyaltyVouchers() {
  return apiRequest('/loyalty/vouchers', { method: 'GET' })
}
