import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth.js'

function isPlatformStaff(user) {
  return user?.role === 'ADMIN' || (user?.role === 'STAFF' && !user.employerPartnerId)
}

function RouteLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9fc] px-5">
      <div
        className="rounded-lg border border-[#bec8ca]/60 bg-white px-6 py-5 text-sm font-semibold text-[#3f484a] shadow-[0_8px_30px_rgba(0,40,50,0.08)]"
        role="status"
      >
        Đang kiểm tra phiên đăng nhập...
      </div>
    </main>
  )
}

function ProtectedRoute({
  children,
  allowedRoles,
  requirePlatformStaff = false,
  requirePartnerStaff = false,
}) {
  const location = useLocation()
  const { isAuthenticated, isAuthLoading, user } = useAuth()

  if (isAuthLoading) {
    return <RouteLoading />
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

  if (requirePartnerStaff && user?.role === 'STAFF' && !user?.employerPartnerId) {
    return <Navigate to="/staff/tickets" replace />
  }

  return children
}

export default ProtectedRoute
