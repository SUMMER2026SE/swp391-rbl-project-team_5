jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  createTicket,
  getTicketDetail,
  listAllTickets,
  sendMessage,
  updateTicketStatus,
} = require('../controllers/supportController');

function makeReqRes(overrides = {}) {
  const req = {
    user: { id: 'cust-1', role: 'CUSTOMER', fullName: 'Khach A' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createTicket', () => {
  test('rejects a description shorter than 10 characters', async () => {
    const { req, res, next } = makeReqRes({
      body: { subject: 'Loi', description: 'ngan' },
    });

    await createTicket(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('creates an OPEN ticket with the description as the first message', async () => {
    prisma.supportTicket.create.mockResolvedValue({ id: 'tk-1', status: 'OPEN' });
    const { req, res, next } = makeReqRes({
      body: { subject: 'Loi thanh toan', description: 'Toi khong thanh toan duoc don hang' },
    });

    await createTicket(req, res, next);

    expect(prisma.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'cust-1',
          status: 'OPEN',
          messages: { create: { senderId: 'cust-1', message: 'Toi khong thanh toan duoc don hang' } },
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('getTicketDetail', () => {
  test('forbids partner staff from reading customer support tickets', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 'tk-1',
      userId: 'cust-1',
      messages: [],
    });
    const { req, res, next } = makeReqRes({
      user: { id: 'partner-staff-1', role: 'STAFF', employerPartnerId: 'partner-1' },
      params: { ticketId: 'tk-1' },
    });

    await getTicketDetail(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('forbids a customer who does not own the ticket', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 'tk-1',
      userId: 'someone-else',
      messages: [],
    });
    const { req, res, next } = makeReqRes({ params: { ticketId: 'tk-1' } });

    await getTicketDetail(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('listAllTickets', () => {
  test('forbids partner staff from listing the platform support queue', async () => {
    const { req, res, next } = makeReqRes({
      user: { id: 'partner-staff-1', role: 'STAFF', employerPartnerId: 'partner-1' },
    });

    await listAllTickets(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.supportTicket.findMany).not.toHaveBeenCalled();
  });
});

describe('sendMessage', () => {
  test('blocks sending into a RESOLVED ticket', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 'tk-1',
      userId: 'cust-1',
      status: 'RESOLVED',
    });
    const { req, res, next } = makeReqRes({
      params: { ticketId: 'tk-1' },
      body: { message: 'them cau hoi' },
    });

    await sendMessage(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('moves an OPEN ticket to IN_PROGRESS when staff replies first', async () => {
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 'tk-1',
      userId: 'cust-1',
      status: 'OPEN',
    });
    prisma.supportMessage.create.mockReturnValue(
      Promise.resolve({ id: 'msg-1', ticketId: 'tk-1', senderId: 'staff-1', message: 'Chao ban' }),
    );
    prisma.supportTicket.update.mockReturnValue(Promise.resolve({ id: 'tk-1', status: 'IN_PROGRESS' }));
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
    );

    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', role: 'STAFF', fullName: 'NV Ho Tro' },
      params: { ticketId: 'tk-1' },
      body: { message: 'Chao ban' },
    });

    await sendMessage(req, res, next);

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 'tk-1' },
      data: { status: 'IN_PROGRESS' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('updateTicketStatus', () => {
  test('rejects an invalid status value', async () => {
    const { req, res, next } = makeReqRes({
      user: { id: 'staff-1', role: 'STAFF' },
      params: { ticketId: 'tk-1' },
      body: { status: 'WHATEVER' },
    });

    await updateTicketStatus(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.supportTicket.update).not.toHaveBeenCalled();
  });
});
