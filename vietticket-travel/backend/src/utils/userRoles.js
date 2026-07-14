'use strict';

const VALID_ROLES = new Set(['CUSTOMER', 'PARTNER', 'ADMIN', 'STAFF']);

function getEffectiveRoles(user) {
  if (!user) return [];

  const roles = new Set();
  if (VALID_ROLES.has(user.role)) roles.add(user.role);

  for (const role of user.roles || []) {
    if (VALID_ROLES.has(role)) roles.add(role);
  }

  for (const membership of user.roleMemberships || []) {
    const role = typeof membership === 'string' ? membership : membership?.role;
    if (VALID_ROLES.has(role)) roles.add(role);
  }

  return [...roles];
}

function hasRole(user, role) {
  return getEffectiveRoles(user).includes(role);
}

function hasAnyRole(user, roles) {
  const effectiveRoles = new Set(getEffectiveRoles(user));
  return roles.some((role) => effectiveRoles.has(role));
}

async function grantRole(client, userId, role) {
  if (!VALID_ROLES.has(role)) throw new Error(`Unsupported user role: ${role}`);

  return client.userRoleMembership.upsert({
    where: { userId_role: { userId, role } },
    update: {},
    create: { userId, role },
  });
}

async function revokeRole(client, userId, role) {
  if (!VALID_ROLES.has(role)) throw new Error(`Unsupported user role: ${role}`);

  return client.userRoleMembership.deleteMany({ where: { userId, role } });
}

module.exports = {
  getEffectiveRoles,
  grantRole,
  hasAnyRole,
  hasRole,
  revokeRole,
};
