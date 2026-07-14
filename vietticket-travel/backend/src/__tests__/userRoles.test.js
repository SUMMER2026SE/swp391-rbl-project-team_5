'use strict';

const {
  getEffectiveRoles,
  grantRole,
  hasAnyRole,
  hasRole,
  revokeRole,
} = require('../utils/userRoles');

describe('userRoles', () => {
  test('keeps the legacy primary role when memberships have not been loaded', () => {
    const user = { role: 'CUSTOMER' };

    expect(getEffectiveRoles(user)).toEqual(['CUSTOMER']);
    expect(hasRole(user, 'CUSTOMER')).toBe(true);
  });

  test('allows an approved partner to retain customer capabilities', () => {
    const user = {
      role: 'PARTNER',
      roleMemberships: [{ role: 'PARTNER' }, { role: 'CUSTOMER' }],
    };

    expect(getEffectiveRoles(user)).toEqual(['PARTNER', 'CUSTOMER']);
    expect(hasRole(user, 'PARTNER')).toBe(true);
    expect(hasRole(user, 'CUSTOMER')).toBe(true);
    expect(hasAnyRole(user, ['ADMIN', 'CUSTOMER'])).toBe(true);
    expect(hasRole(user, 'ADMIN')).toBe(false);
  });

  test('accepts serialized role arrays used by authenticated socket users', () => {
    const user = {
      role: 'CUSTOMER',
      roles: ['CUSTOMER', 'ADMIN'],
    };

    expect(getEffectiveRoles(user)).toEqual(['CUSTOMER', 'ADMIN']);
    expect(hasRole(user, 'ADMIN')).toBe(true);
  });

  test('ignores malformed and duplicate memberships', () => {
    const user = {
      role: 'PARTNER',
      roleMemberships: [{ role: 'PARTNER' }, { role: 'UNKNOWN' }, null],
    };

    expect(getEffectiveRoles(user)).toEqual(['PARTNER']);
  });

  test('grants and revokes roles through idempotent persistence operations', async () => {
    const client = {
      userRoleMembership: {
        upsert: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'CUSTOMER' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await grantRole(client, 'user-1', 'CUSTOMER');
    await revokeRole(client, 'user-1', 'PARTNER');

    expect(client.userRoleMembership.upsert).toHaveBeenCalledWith({
      where: { userId_role: { userId: 'user-1', role: 'CUSTOMER' } },
      update: {},
      create: { userId: 'user-1', role: 'CUSTOMER' },
    });
    expect(client.userRoleMembership.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', role: 'PARTNER' },
    });
  });

  test('rejects unsupported roles before writing to the database', async () => {
    const client = { userRoleMembership: { upsert: jest.fn() } };

    await expect(grantRole(client, 'user-1', 'SUPERUSER')).rejects.toThrow(
      'Unsupported user role',
    );
    expect(client.userRoleMembership.upsert).not.toHaveBeenCalled();
  });
});
