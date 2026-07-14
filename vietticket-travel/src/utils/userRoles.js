const VALID_ROLES = new Set(['CUSTOMER', 'PARTNER', 'ADMIN', 'STAFF'])

export function getUserRoles(user) {
  if (!user) return []

  const roles = new Set()
  if (VALID_ROLES.has(user.role)) roles.add(user.role)

  for (const role of user.roles || []) {
    if (VALID_ROLES.has(role)) roles.add(role)
  }

  return [...roles]
}

export function hasRole(user, role) {
  return getUserRoles(user).includes(role)
}

export function hasAnyRole(user, roles) {
  const effectiveRoles = new Set(getUserRoles(user))
  return roles.some((role) => effectiveRoles.has(role))
}
