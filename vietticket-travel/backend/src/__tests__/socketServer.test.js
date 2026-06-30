process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const mockPrisma = require('./helpers/mockPrisma');
const { generateTestToken, mockValidSession } = require('./helpers/authHelper');
const {
  authenticateSocket,
  canJoinSupportTicket,
  parseCookies,
  readSocketToken,
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
    });
    mockValidSession(mockPrisma, 'partner-staff-01');

    await authenticateSocket(socket, next);

    expect(next.mock.calls[0]).toEqual([]);
    expect(socket.user).toEqual({
      id: 'partner-staff-01',
      role: 'STAFF',
      employerPartnerId: 'partner-01',
      partnerProfileId: null,
    });
  });

  test('allows platform staff to join support ticket rooms without owner lookup', async () => {
    const allowed = await canJoinSupportTicket(
      { id: 'staff-01', role: 'STAFF', employerPartnerId: null },
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
});
