import { apiRequest } from './api.js'

export function getPartners(status) {
  const query = status && status !== 'all' ? `?status=${status.toUpperCase()}` : ''
  return apiRequest(`/admin/partners${query}`, { method: 'GET' })
}

export function reviewPartner(id, action, rejectionReason) {
  return apiRequest(`/admin/partners/${id}/review`, {
    method: 'PUT',
    body: { action, rejectionReason },
  })
}

export function getAttractions(status) {
  const query = status && status !== 'all' ? `?status=${status.toUpperCase()}` : ''
  return apiRequest(`/admin/attractions${query}`, { method: 'GET' })
}

export function reviewAttraction(id, action, rejectionReason) {
  return apiRequest(`/admin/attractions/${id}/review`, {
    method: 'PUT',
    body: { action, rejectionReason },
  })
}

export function hideAttraction(id, reason) {
  return apiRequest(`/admin/attractions/${id}/hide`, {
    method: 'PUT',
    body: { reason },
  })
}

export function getDashboard(period = 'month') {
  return apiRequest(`/admin/dashboard?period=${encodeURIComponent(period)}`, { method: 'GET' })
}

export function getCategories() {
  return apiRequest('/admin/categories', { method: 'GET' })
}

export function createCategory(payload) {
  return apiRequest('/admin/categories', { method: 'POST', body: payload })
}

export function updateCategory(id, payload) {
  return apiRequest(`/admin/categories/${id}`, { method: 'PUT', body: payload })
}

export function deleteCategory(id) {
  return apiRequest(`/admin/categories/${id}`, { method: 'DELETE' })
}

export const listPartners = getPartners;
export const listAttractions = getAttractions;
