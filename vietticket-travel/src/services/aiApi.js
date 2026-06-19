import { apiRequest } from './api.js'

export async function aiChat(message, history = []) {
  return apiRequest('/ai/chat', {
    method: 'POST',
    body: { message, history },
  })
}

export async function aiRecommend({ budget, adults, children, city, interests, priority, companion }) {
  return apiRequest('/ai/recommend', {
    method: 'POST',
    body: { budget, adults, children, city, interests, priority, companion },
  })
}

export async function aiItinerary({ city, days, adults, children, interests, budget, pace, priority, companion }) {
  return apiRequest('/ai/itinerary', {
    method: 'POST',
    body: { city, days, adults, children, interests, budget, pace, priority, companion },
  })
}
