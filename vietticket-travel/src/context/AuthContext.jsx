import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL, apiRequest } from '../services/api.js'
import AuthContext from './authContextObject.js'
import {
  AUTH_STORAGE_KEY,
  PENDING_EMAIL_STORAGE_KEY,
  USER_STORAGE_KEY,
  defaultUser,
} from './authConstants.js'

function readStorage(key, fallback = null) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch (error) {
    console.warn(`Không thể đọc ${key} từ localStorage`, error)
    return fallback
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function normalizeApiUser(apiUser) {
  if (!apiUser) return null

  const safeUser = { ...apiUser }
  delete safeUser.passwordHash

  const profile = apiUser.profile || {}

  return {
    ...safeUser,
    phone: profile.phoneNumber || '',
    avatar: profile.avatarUrl || defaultUser.avatar,
    emailVerified: Boolean(apiUser.isEmailVerified),
    roleLabel:
      apiUser.role === 'CUSTOMER'
        ? 'Khách hàng'
        : apiUser.role === 'ADMIN'
        ? 'Quản trị viên'
        : apiUser.role === 'PARTNER'
        ? 'Đối tác'
        : apiUser.role === 'STAFF'
        ? 'Nhân viên'
        : apiUser.role,
    statusLabel: apiUser.status === 'ACTIVE' ? 'Hoạt động' : 'Bị khóa',
    dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : '',
    gender: profile.gender || '',
    address: profile.address || '',
  }
}

function getErrorResult(error) {
  return {
    ok: false,
    status: error.status,
    message: error.message || 'Không thể kết nối đến máy chủ.',
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStorage(USER_STORAGE_KEY, null))
  const [auth, setAuth] = useState(() => readStorage(AUTH_STORAGE_KEY, null))
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  const persistSession = useCallback((apiUser) => {
    const normalizedUser = normalizeApiUser(apiUser)
    const nextAuth = {
      authenticated: true,
      loggedInAt: new Date().toISOString(),
    }

    setUser(normalizedUser)
    setAuth(nextAuth)
    writeStorage(USER_STORAGE_KEY, normalizedUser)
    writeStorage(AUTH_STORAGE_KEY, nextAuth)
    localStorage.removeItem(PENDING_EMAIL_STORAGE_KEY)

    return normalizedUser
  }, [])

  const persistUser = useCallback((apiUser) => {
    const normalizedUser = normalizeApiUser(apiUser)
    setUser(normalizedUser)
    writeStorage(USER_STORAGE_KEY, normalizedUser)
    return normalizedUser
  }, [])

  const clearSession = useCallback(() => {
    setUser(null)
    setAuth(null)
    localStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(USER_STORAGE_KEY)
    localStorage.removeItem(PENDING_EMAIL_STORAGE_KEY)
    sessionStorage.removeItem('vietticket_demo_verification_token')
    sessionStorage.removeItem('vietticket_demo_reset_token')
  }, [])

  useEffect(() => {
    let isMounted = true

    async function hydrateSession() {
      // Chế độ demo (vd: đăng nhập admin demo) — bỏ qua việc gọi server.
      if (localStorage.getItem('vietticket_demo_mode') === 'true') {
        setIsAuthLoading(false)
        return
      }

      // Nếu đã có phiên đăng nhập lưu trong localStorage, giữ lại khi server
      // tạm thời không phản hồi (tránh đăng xuất ngoài ý muốn).
      const cachedAuth = readStorage(AUTH_STORAGE_KEY, null)
      const cachedUser = readStorage(USER_STORAGE_KEY, null)
      const hasCachedSession = cachedAuth?.authenticated && cachedUser

      try {
        const data = await apiRequest('/auth/me', { method: 'GET' })

        if (!isMounted) return

        persistSession(data.user)
      } catch {
        if (!isMounted) return
        // If the server is unreachable but we have a cached session, keep it so the user
        // isn't unexpectedly logged out when the backend is temporarily down.
        if (!hasCachedSession) {
          clearSession()
        }
      } finally {
        if (isMounted) {
          setIsAuthLoading(false)
        }
      }
    }

    hydrateSession()

    return () => {
      isMounted = false
    }
  }, [clearSession, persistSession])

  const login = async (credentials) => {
    // Demo Mode Bypass
    if (credentials.email === 'admin@vietticket.com' && credentials.password === 'AdminPassword123@') {
      localStorage.setItem('vietticket_demo_mode', 'true')
      const mockAdminUser = {
        id: 'mock-admin-id',
        email: 'admin@vietticket.com',
        fullName: 'Admin',
        role: 'ADMIN',
        roleLabel: 'Quản trị viên',
        status: 'ACTIVE',
        statusLabel: 'Hoạt động',
        provider: 'LOCAL',
        emailVerified: true,
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&h=128&q=80',
        phone: '0123 456 789',
      }
      const nextUser = persistSession(mockAdminUser)
      return { ok: true, user: nextUser, message: 'Đăng nhập Admin (Chế độ Demo) thành công!' }
    }

    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: {
          email: credentials.email,
          password: credentials.password,
          remember: credentials.remember,
        },
      })

      const nextUser = persistSession(data.user)
      return { ok: true, user: nextUser, message: data.message }
    } catch (error) {
      // Forward error code and data so pages can handle specific cases (e.g. EMAIL_NOT_VERIFIED)
      const result = getErrorResult(error)
      result.code = error.data?.code || null
      result.data = error.data || null
      return result
    }
  }

  const loginWithGoogle = async ({ credential } = {}) => {
    try {
      const data = await apiRequest('/auth/google', {
        method: 'POST',
        body: { credential },
      })

      const nextUser = persistSession(data.user)
      return { ok: true, user: nextUser, message: data.message }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const register = async (payload) => {
    try {
      const cleanPhone = payload.phone ? payload.phone.replace(/[\s.-]+/g, '') : ''
      const data = await apiRequest('/auth/register', {
        method: 'POST',
        body: {
          fullName: payload.fullName,
          email: payload.email,
          phoneNumber: cleanPhone,
          password: payload.password,
        },
      })

      clearSession()
      localStorage.setItem(PENDING_EMAIL_STORAGE_KEY, payload.email)

      return {
        ok: true,
        message: data.message,
        user: normalizeApiUser(data.user),
      }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const verifyEmail = async (payload) => {
    try {
      const data = await apiRequest('/auth/verify-email', {
        method: 'POST',
        body: {
          token: payload.token,
        },
      })

      localStorage.removeItem(PENDING_EMAIL_STORAGE_KEY)

      return { ok: true, message: data.message, user: normalizeApiUser(data.user) }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const resendVerification = async (payload) => {
    try {
      const data = await apiRequest('/auth/resend-verification', {
        method: 'POST',
        body: { email: payload.email },
      })

      return { ok: true, message: data.message }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const forgotPassword = async (payload) => {
    try {
      const data = await apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: { email: payload.email },
      })

      return {
        ok: true,
        message: data.message,
      }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const resetPassword = async (payload) => {
    try {
      const data = await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: {
          token: payload.token,
          newPassword: payload.newPassword,
        },
      })

      return { ok: true, message: data.message }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const getProfile = useCallback(async () => {
    try {
      const data = await apiRequest('/users/profile', {
        method: 'GET',
      })

      const nextUser = persistUser(data.user)
      return { ok: true, user: nextUser }
    } catch (error) {
      if (error.status === 401) {
        clearSession()
      }

      return getErrorResult(error)
    }
  }, [clearSession, persistUser])

  const updateProfile = async (payload) => {
    try {
      const cleanPhone = payload.phone ? payload.phone.replace(/[\s.-]+/g, '') : ''
      const data = await apiRequest('/users/profile', {
        method: 'PUT',
        body: {
          fullName: payload.fullName,
          phoneNumber: cleanPhone,
          avatarUrl: payload.avatar,
          dateOfBirth: payload.dateOfBirth,
          gender: payload.gender,
          address: payload.address,
        },
      })

      const nextUser = persistUser(data.user)
      return { ok: true, user: nextUser, message: data.message }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const uploadAvatar = async (file) => {
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const response = await fetch(`${API_BASE_URL}/users/upload-avatar`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const error = new Error(data.message || 'Không thể tải ảnh đại diện.')
        error.status = response.status
        throw error
      }

      persistUser(data.user)
      return { ok: true, avatarUrl: data.avatarUrl, user: normalizeApiUser(data.user), message: data.message }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  const changePassword = async (payload) => {
    try {
      const data = await apiRequest('/users/change-password', {
        method: 'PUT',
        body: {
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        },
      })

      return { ok: true, message: data.message }
    } catch (error) {
      return getErrorResult(error)
    }
  }

  // Dev/demo helper — bypass real auth when backend is unavailable
  const demoLogin = (mockUserData = {}) => {
    const mockUser = {
      fullName: 'Đối tác Demo',
      email: 'demo@vietticket.com',
      role: 'PARTNER',
      avatar: '',
      emailVerified: true,
      ...mockUserData,
    }
    const nextAuth = { authenticated: true, loggedInAt: new Date().toISOString() }
    setUser(mockUser)
    setAuth(nextAuth)
    writeStorage(USER_STORAGE_KEY, mockUser)
    writeStorage(AUTH_STORAGE_KEY, nextAuth)
  }

  const logout = async () => {
    try {
      if (localStorage.getItem('vietticket_demo_mode') !== 'true') {
        await apiRequest('/auth/logout', { method: 'POST' })
      }
    } catch {
      // Local cleanup still matters if the network is unavailable.
    } finally {
      localStorage.removeItem('vietticket_demo_mode')
      clearSession()
    }
  }

  const value = {
    user,
    isAuthLoading,
    isAuthenticated: Boolean(auth?.authenticated),
    login,
    loginWithGoogle,
    register,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    getProfile,
    updateProfile,
    uploadAvatar,
    changePassword,
    logout,
    demoLogin,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
