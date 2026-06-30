import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth.js'

function isPlatformStaff(user) {
  return user?.role === 'ADMIN' || (user?.role === 'STAFF' && !user.employerPartnerId)
}

function ProtectedRoute({ children, allowedRoles, requirePlatformStaff = false }) {
  const location = useLocation()
  const { isAuthenticated, isAuthLoading, user } = useAuth()

  if (isAuthLoading) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/" replace />
  }

  if (requirePlatformStaff && !isPlatformStaff(user)) {
    return <Navigate to="/staff/checkin" replace />
  }

  return children
}

export default ProtectedRoute
