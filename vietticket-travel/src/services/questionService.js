import { apiRequest } from './api.js'

export async function getQuestions(attractionId, { page = 1, limit = 10 } = {}) {
  const params = new URLSearchParams({
    attractionId,
    page: String(page),
    limit: String(limit),
  })
  return apiRequest(`/questions?${params.toString()}`, { method: 'GET' })
}

export async function createQuestion(attractionId, question) {
  const result = await apiRequest('/questions', {
    method: 'POST',
    body: { attractionId, question },
  })
  return result.data
}

export async function getPartnerQuestions() {
  const result = await apiRequest('/partners/questions', { method: 'GET' })
  return Array.isArray(result.data) ? result.data : []
}

export async function answerPartnerQuestion(questionId, answer) {
  const result = await apiRequest(`/partners/questions/${questionId}/answer`, {
    method: 'POST',
    body: { answer },
  })
  return result.data
}

export async function reportQuestion(questionId, reason = '') {
  const result = await apiRequest(`/questions/${questionId}/report`, {
    method: 'POST',
    body: { reason },
  })
  return result
}

export default {
  answerPartnerQuestion,
  createQuestion,
  getPartnerQuestions,
  getQuestions,
  reportQuestion,
}
