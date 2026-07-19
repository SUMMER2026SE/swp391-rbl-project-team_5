import { hasRole } from './userRoles.js'

export function getSafeLoginRedirect(user, redirectFrom) {
  const staffHome = user?.employerPartnerId ? '/staff/checkin' : '/staff/tickets'
  const defaultPath = hasRole(user, 'ADMIN')
    ? '/admin'
    : hasRole(user, 'STAFF')
      ? staffHome
      : hasRole(user, 'PARTNER') ? '/partner/dashboard' : '/'

  if (!redirectFrom) return defaultPath

  const targetPath = redirectFrom.pathname || '/'
  if (targetPath.startsWith('/admin') && !hasRole(user, 'ADMIN')) return defaultPath
  if (
    targetPath.startsWith('/staff')
    && !hasRole(user, 'STAFF')
    && !hasRole(user, 'ADMIN')
  ) return defaultPath
  if (
    hasRole(user, 'STAFF')
    && user?.employerPartnerId
    && (targetPath.startsWith('/staff/tickets') || targetPath.startsWith('/staff/refunds'))
  ) return defaultPath
  if (targetPath.startsWith('/partner') && !hasRole(user, 'PARTNER')) return defaultPath
  if (targetPath === '/login' || targetPath === '/register') return defaultPath

  return `${targetPath}${redirectFrom.search || ''}${redirectFrom.hash || ''}`
}
