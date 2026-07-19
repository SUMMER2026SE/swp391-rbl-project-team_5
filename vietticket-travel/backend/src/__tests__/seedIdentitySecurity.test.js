'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ensureSeedPartnerIdentity,
  ensureSeedPartnerKycDocument,
} = require('../../prisma/seedPartnerIdentity');
const {
  assertRotatablePlatformStaff,
  rotateExistingStaff,
} = require('../../create-staff');

function existingPartner(overrides = {}) {
  return {
    id: 'partner-user-1',
    email: 'partner@example.com',
    role: 'PARTNER',
    provider: 'LOCAL',
    status: 'ACTIVE',
    employerPartnerId: null,
    roleMemberships: [{ role: 'CUSTOMER' }, { role: 'PARTNER' }],
    partnerProfile: { id: 'partner-1' },
    oauthAccounts: [],
    ...overrides,
  };
}

function transactionClient() {
  const tx = {
    user: {
      update: jest.fn().mockResolvedValue({
        id: 'partner-user-1',
        role: 'PARTNER',
        tokenVersion: 2,
      }),
    },
    authSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    userRoleMembership: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    tx,
    client: {
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((callback) => callback(tx)),
    },
  };
}

describe('seed partner identity rotation', () => {
  test('rotates the configured password and revokes sessions atomically', async () => {
    const { client, tx } = transactionClient();
    client.user.findUnique.mockResolvedValue(existingPartner());
    const hashPassword = jest.fn().mockResolvedValue('new-password-hash');

    const result = await ensureSeedPartnerIdentity({
      client,
      email: 'partner@example.com',
      password: 'NewPassword123',
      fullName: 'Demo Partner',
      phoneNumber: '0901234567',
      hashPassword,
    });

    expect(result.created).toBe(false);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'partner-user-1' },
      data: expect.objectContaining({
        passwordHash: 'new-password-hash',
        tokenVersion: { increment: 1 },
      }),
    }));
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'partner-user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.userRoleMembership.upsert).toHaveBeenCalledTimes(2);
  });

  test.each([
    { provider: 'GOOGLE' },
    { oauthAccounts: [{ id: 'oauth-1', provider: 'GOOGLE' }] },
    { role: 'ADMIN', roleMemberships: [{ role: 'ADMIN' }] },
    { role: 'STAFF', roleMemberships: [{ role: 'STAFF' }] },
    {
      role: 'CUSTOMER',
      roleMemberships: [{ role: 'CUSTOMER' }],
      partnerProfile: null,
    },
  ])('refuses a conflicting existing identity: %j', async (override) => {
    const { client } = transactionClient();
    client.user.findUnique.mockResolvedValue(existingPartner(override));
    const hashPassword = jest.fn();

    await expect(ensureSeedPartnerIdentity({
      client,
      email: 'partner@example.com',
      password: 'NewPassword123',
      fullName: 'Demo Partner',
      phoneNumber: '0901234567',
      hashPassword,
    })).rejects.toThrow();

    expect(hashPassword).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe('seed partner KYC fixture', () => {
  test('creates an owned PDF URL and idempotent private file', async () => {
    const documentsDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'vietticket-kyc-'),
    );

    try {
      const options = {
        userId: 'partner-user-1',
        backendUrl: 'http://localhost:5000/path-is-ignored',
        documentsDir,
      };
      const firstUrl = await ensureSeedPartnerKycDocument(options);
      const secondUrl = await ensureSeedPartnerKycDocument(options);
      const filename = 'partner-user-1-seed-business-license.pdf';
      const content = await fs.promises.readFile(path.join(documentsDir, filename));

      expect(firstUrl).toBe(
        `http://localhost:5000/api/upload/documents/${filename}`,
      );
      expect(secondUrl).toBe(firstUrl);
      expect(content.subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      await fs.promises.rm(documentsDir, { recursive: true, force: true });
    }
  });
});

describe('platform staff identity rotation', () => {
  const staff = {
    id: 'staff-1',
    role: 'STAFF',
    provider: 'LOCAL',
    employerPartnerId: null,
    roleMemberships: [{ role: 'STAFF' }],
    partnerProfile: null,
    oauthAccounts: [],
  };

  test('rejects partner staff, OAuth, or mixed ADMIN identities', () => {
    expect(() => assertRotatablePlatformStaff({
      ...staff,
      employerPartnerId: 'partner-1',
    })).toThrow();
    expect(() => assertRotatablePlatformStaff({
      ...staff,
      provider: 'GOOGLE',
    })).toThrow();
    expect(() => assertRotatablePlatformStaff({
      ...staff,
      roleMemberships: [{ role: 'STAFF' }, { role: 'ADMIN' }],
    })).toThrow();
  });

  test('rotates only a standalone LOCAL platform staff and revokes sessions', async () => {
    const tx = {
      user: {
        update: jest.fn().mockResolvedValue({ id: 'staff-1', tokenVersion: 2 }),
      },
      authSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userRoleMembership: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const client = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const hashPassword = jest.fn().mockResolvedValue('rotated-hash');

    await rotateExistingStaff(client, staff, {
      password: 'NewStaffPass123',
      fullName: 'Platform Staff',
    }, hashPassword);

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        passwordHash: 'rotated-hash',
        tokenVersion: { increment: 1 },
      }),
    }));
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'staff-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
