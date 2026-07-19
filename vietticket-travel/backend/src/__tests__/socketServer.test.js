process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const { generateTestToken, mockValidSession } = require('./helpers/authHelper');
const {
  authenticateSocket,
  canJoinSupportTicket,
  parseCookies,
  readSocketToken,
  revalidateSocket,
} = require('../realtime/socketServer');

afterEach(() => jest.clearAllMocks());

describe('socketServer helpers', () => {
  test('keeps employerPartnerId on authenticated socket user', async () => {
    const token = generateTestToken('partner-staff-01', 'STAFF');
    const socket = {
      handshake: {
        headers: { authorization: `Bearer ${token}` },
        auth: {},
      },
    };
    const next = jest.fn();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'partner-staff-01',
      role: 'STAFF',
      status: 'ACTIVE',
      tokenVersion: 0,
      employerPartnerId: 'partner-01',
      roleMemberships: [{ role: 'STAFF' }],
    });
    mockValidSession(mockPrisma, 'partner-staff-01');

    await authenticateSocket(socket, next);

    expect(next.mock.calls[0]).toEqual([]);
    expect(socket.user).toEqual({
      id: 'partner-staff-01',
      role: 'STAFF',
      roles: ['STAFF'],
      employerPartnerId: 'partner-01',
      partnerProfileId: null,
    });
  });

  test('loads memberships so a secondary approved PARTNER role can join partner rooms', async () => {
    const token = generateTestToken('multi-role-01', 'CUSTOMER');
    const socket = {
      handshake: { headers: { authorization: `Bearer ${token}` }, auth: {} },
    };
    const next = jest.fn();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'multi-role-01',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      tokenVersion: 0,
      employerPartnerId: null,
      roleMemberships: [{ role: 'CUSTOMER' }, { role: 'PARTNER' }],
      partnerProfile: { id: 'partner-01', status: 'APPROVED' },
    });
    mockValidSession(mockPrisma, 'multi-role-01');

    await authenticateSocket(socket, next);

    expect(next.mock.calls[0]).toEqual([]);
    expect(socket.user).toEqual(expect.objectContaining({
      role: 'CUSTOMER',
      roles: ['CUSTOMER', 'PARTNER'],
      partnerProfileId: 'partner-01',
    }));
  });

  test('allows platform staff to join support ticket rooms without owner lookup', async () => {
    const allowed = await canJoinSupportTicket(
      { id: 'staff-01', role: 'STAFF', employerPartnerId: null },
      'ticket-01',
    );

    expect(allowed).toBe(true);
    expect(mockPrisma.supportTicket.findUnique).not.toHaveBeenCalled();
  });

  test('recognizes platform STAFF from a secondary membership', async () => {
    const allowed = await canJoinSupportTicket(
      {
        id: 'staff-01',
        role: 'CUSTOMER',
        roles: ['CUSTOMER', 'STAFF'],
        employerPartnerId: null,
      },
      'ticket-01',
    );

    expect(allowed).toBe(true);
    expect(mockPrisma.supportTicket.findUnique).not.toHaveBeenCalled();
  });

  test('blocks partner staff from joining another customer support ticket room', async () => {
    mockPrisma.supportTicket.findUnique.mockResolvedValue({ userId: 'customer-01' });

    const allowed = await canJoinSupportTicket(
      { id: 'partner-staff-01', role: 'STAFF', employerPartnerId: 'partner-01' },
      'ticket-01',
    );

    expect(allowed).toBe(false);
    expect(mockPrisma.supportTicket.findUnique).toHaveBeenCalledWith({
      where: { id: 'ticket-01' },
      select: { userId: true },
    });
  });

  test('allows customers to join their own support ticket room', async () => {
    mockPrisma.supportTicket.findUnique.mockResolvedValue({ userId: 'customer-01' });

    const allowed = await canJoinSupportTicket(
      { id: 'customer-01', role: 'CUSTOMER', employerPartnerId: null },
      'ticket-01',
    );

    expect(allowed).toBe(true);
  });

  test('reads socket tokens from cookie, bearer header, or auth payload', () => {
    expect(parseCookies('a=1; b=hello%20world')).toEqual({ a: '1', b: 'hello world' });
    expect(readSocketToken({
      handshake: { headers: { cookie: 'token=cookie-token' }, auth: {} },
    })).toBe('cookie-token');
    expect(readSocketToken({
      handshake: { headers: { authorization: 'Bearer bearer-token' }, auth: {} },
    })).toBe('bearer-token');
    expect(readSocketToken({
      handshake: { headers: {}, auth: { token: 'auth-token' } },
    })).toBe('auth-token');
  });

  test('disconnects an already-connected socket after its account is locked', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-locked',
      role: 'CUSTOMER',
      status: 'LOCKED',
      tokenVersion: 0,
      employerPartnerId: null,
      roleMemberships: [{ role: 'CUSTOMER' }],
      partnerProfile: null,
    });
    mockPrisma.authSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-locked',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const socket = {
      authContext: {
        userId: 'user-locked',
        sessionId: 'session-1',
        tokenVersion: 0,
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await expect(revalidateSocket(socket)).resolves.toBeNull();

    expect(socket.emit).toHaveBeenCalledWith(
      'AUTHORIZATION_REVOKED',
      expect.any(Object),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
