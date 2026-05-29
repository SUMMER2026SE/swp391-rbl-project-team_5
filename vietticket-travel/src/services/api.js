const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export async function apiRequest(path, options = {}) {
  const { body, token, headers = {}, ...fetchOptions } = options

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data.message || 'Không thể kết nối đến máy chủ.')
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

export { API_BASE_URL }
