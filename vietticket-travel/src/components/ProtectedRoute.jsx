import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../context/useAuth.js'
import { hasAnyRole, hasRole } from '../utils/userRoles.js'
import AccessDenied from './AccessDenied.jsx'

function isPlatformStaff(user) {
  return hasRole(user, 'ADMIN') || (
    hasRole(user, 'STAFF')
    && !user?.employerPartnerId
    && (user.staffAccessLevel || 'MANAGER') === 'MANAGER'
  )
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
  requiredStaffAccess,
}) {
  const location = useLocation()
  const { isAuthenticated, isAuthLoading, user } = useAuth()

  if (isAuthLoading) {
    return <RouteLoading />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (allowedRoles && !hasAnyRole(user, allowedRoles)) {
    return <AccessDenied user={user} />
  }

  if (requirePlatformStaff && !isPlatformStaff(user)) {
    return (
      <AccessDenied
        user={user}
        description="Chức năng này chỉ dành cho nhân viên vận hành nền tảng VietTicket."
      />
    )
  }

  if (requirePartnerStaff && hasRole(user, 'STAFF') && !user?.employerPartnerId) {
    return (
      <AccessDenied
        user={user}
        description="Chức năng này chỉ dành cho nhân viên đã được một đối tác điểm đến phân công."
      />
    )
  }

  if (
    requiredStaffAccess
    && hasRole(user, 'STAFF')
    && (user.staffAccessLevel || (user.employerPartnerId ? 'SCANNER' : 'MANAGER'))
      !== requiredStaffAccess
  ) {
    return (
      <AccessDenied
        user={user}
        description="Tài khoản nhân viên hiện tại chưa có quyền trưởng ca để thực hiện chức năng này."
      />
    )
  }

  return children
}

export default ProtectedRoute
