import { apiRequest } from './api.js'

// Lấy dự báo thời tiết theo toạ độ. Backend proxy tới Open-Meteo.
export function getWeather(lat, lng) {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng) })
  return apiRequest(`/weather?${query.toString()}`, { method: 'GET' })
}

const weatherApi = { getWeather }

export default weatherApi
