import { apiRequest } from './api.js'

// --- Khách hàng ---
export const createTicket = async ({ subject, description, bookingId }) => {
  const result = await apiRequest('/support/tickets', {
    method: 'POST',
    body: { subject, description, bookingId: bookingId || undefined },
  })
  return result.data
}

export const getMyTickets = async () => {
  const result = await apiRequest('/support/tickets/my-tickets', { method: 'GET' })
  return Array.isArray(result.data) ? result.data : []
}

// --- Staff/Admin ---
export const getAllTickets = async ({ status, search } = {}) => {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (search) params.set('search', search)
  const query = params.toString()
  const result = await apiRequest(`/support/tickets${query ? `?${query}` : ''}`, {
    method: 'GET',
  })
  return Array.isArray(result.data) ? result.data : []
}

// --- Dùng chung ---
export const getTicketDetail = async (ticketId) => {
  const result = await apiRequest(`/support/tickets/${ticketId}`, { method: 'GET' })
  return result.data
}

export const sendTicketMessage = async (ticketId, message) => {
  const result = await apiRequest(`/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { message },
  })
  return result.data
}

export const updateTicketStatus = async (ticketId, status) => {
  const result = await apiRequest(`/support/tickets/${ticketId}/status`, {
    method: 'PATCH',
    body: { status },
  })
  return result.data
}

const supportApi = {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketDetail,
  sendTicketMessage,
  updateTicketStatus,
}

export default supportApi
