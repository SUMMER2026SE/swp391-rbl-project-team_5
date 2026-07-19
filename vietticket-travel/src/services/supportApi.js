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
export const getAllTickets = async ({
  status,
  search,
  priority,
  assignment,
  page = 1,
  limit = 25,
} = {}) => {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (search) params.set('search', search)
  if (priority) params.set('priority', priority)
  if (assignment) params.set('assignment', assignment)
  params.set('page', String(page))
  params.set('limit', String(limit))
  const query = params.toString()
  const result = await apiRequest(`/support/tickets${query ? `?${query}` : ''}`, {
    method: 'GET',
  })
  return {
    data: Array.isArray(result.data) ? result.data : [],
    stats: result.stats || { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 },
    pagination: result.pagination || { page: 1, limit, total: 0, totalPages: 1 },
  }
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

export const updateTicketStatus = async (ticketId, status, details = {}) => {
  const result = await apiRequest(`/support/tickets/${ticketId}/status`, {
    method: 'PATCH',
    body: { status, ...details },
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
