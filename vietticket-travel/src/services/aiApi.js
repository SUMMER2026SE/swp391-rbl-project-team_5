import { apiRequest } from './api.js'

export async function aiChat(message, history = []) {
  return apiRequest('/ai/chat', {
    method: 'POST',
    body: { message, history },
  })
}

export async function aiRecommend({ budget, people, city, interests }) {
  return apiRequest('/ai/recommend', {
    method: 'POST',
    body: { budget, people, city, interests },
  })
}

export async function aiItinerary({ city, days, people, interests }) {
  return apiRequest('/ai/itinerary', {
    method: 'POST',
    body: { city, days, people, interests },
  })
}
