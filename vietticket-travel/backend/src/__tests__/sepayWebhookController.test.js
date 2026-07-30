'use strict';

const crypto = require('crypto');

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/bankTransferService', () => ({
  confirmBankTransfer: jest.fn(),
}));
jest.mock('../realtime/events', () => ({
  emitBookingStatusUpdated: jest.fn(),
  queueNewBookingNotification: jest.fn(),
}));
jest.mock('../services/ticketEmailService', () => ({
  queueConfirmedTicketEmail: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
const {
  confirmBankTransfer,
} = require('../services/bankTransferService');
const {
  emitBookingStatusUpdated,
  queueNewBookingNotification,
} = require('../realtime/events');
const {
  queueConfirmedTicketEmail,
} = require('../services/ticketEmailService');
const {
  extractBookingSuffix,
  parseTransferDate,
  sepayWebhook,
  verifySepaySignature,
} = require('../controllers/sepayWebhookController');

const SECRET = 'sepay-test-secret-that-is-longer-than-32-characters';
const BOOKING_ID = '3f3b0dc4-b077-4c11-bded-0123456789ab';

function sign(rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const hash = crypto
    .createHmac('sha256', SECRET)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return { signature: `sha256=${hash}`, timestamp: String(timestamp) };
}

function createRequest(payload, { validSignature = true } = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signed = sign(rawBody);
  const headers = {
    'x-sepay-signature': validSignature ? signed.signature : `sha256=${'0'.repeat(64)}`,
    'x-sepay-timestamp': signed.timestamp,
  };
  return {
    body: payload,
    rawBody,
    get: (name) => headers[String(name).toLowerCase()],
    headers,
    ip: '127.0.0.1',
  };
}

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function incomingPayload(overrides = {}) {
  return {
    id: 92704,
    gateway: 'Vietcombank',
    transactionDate: '2026-07-30 15:30:00',
    accountNumber: '123456789',
    subAccount: '',
    code: 'VT0123456789AB',
    content: 'VT0123456789AB chuyen tien',
    transferType: 'in',
    transferAmount: 250000,
    referenceCode: 'FT24012345678',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SEPAY_WEBHOOK_ENABLED = 'true';
  process.env.SEPAY_WEBHOOK_SECRET = SECRET;
  process.env.SEPAY_WEBHOOK_TOLERANCE_SECONDS = '300';
  process.env.BANK_BIN = '970436';
  process.env.BANK_ACCOUNT_NUMBER = '123456789';
  process.env.BANK_ACCOUNT_NAME = 'VIETTICKET TRAVEL';

  prisma.bankTransferWebhookEvent.create.mockResolvedValue({
    id: 'event-1',
    provider: 'SEPAY',
    providerEventId: '92704',
    status: 'RECEIVED',
  });
  prisma.bankTransferWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
  prisma.bankTransferWebhookEvent.update.mockResolvedValue({});
  prisma.booking.findMany.mockResolvedValue([
    { id: BOOKING_ID, totalAmount: 250000 },
  ]);
  confirmBankTransfer.mockResolvedValue({
    alreadyConfirmed: false,
    latePayment: false,
    bookingStatus: 'CONFIRMED',
    booking: { id: BOOKING_ID, userId: 'customer-1' },
  });
});

describe('SePay webhook helpers', () => {
  test('verifies the HMAC over timestamp and exact raw body', () => {
    const rawBody = Buffer.from('{"id":92704}');
    const signed = sign(rawBody);

    expect(verifySepaySignature({
      rawBody,
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret: SECRET,
      toleranceSeconds: 300,
    })).toBe(true);
    expect(verifySepaySignature({
      rawBody: Buffer.from('{"id":92705}'),
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret: SECRET,
      toleranceSeconds: 300,
    })).toBe(false);
  });

  test('extracts the VietTicket suffix and parses SePay Vietnam time', () => {
    expect(extractBookingSuffix({
      content: 'Thanh toan VT-0123456789AB',
    })).toBe('0123456789AB');
    expect(parseTransferDate('2026-07-30 15:30:00').toISOString())
      .toBe('2026-07-30T08:30:00.000Z');
  });
});

describe('SePay webhook processing', () => {
  test('rejects a forged signature before touching financial data', async () => {
    const req = createRequest(incomingPayload(), { validSignature: false });
    const res = createResponse();

    await sepayWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prisma.bankTransferWebhookEvent.create).not.toHaveBeenCalled();
    expect(confirmBankTransfer).not.toHaveBeenCalled();
  });

  test('automatically confirms an exact incoming transfer and notifies the customer', async () => {
    const req = createRequest(incomingPayload());
    const res = createResponse();

    await sepayWebhook(req, res);

    expect(confirmBankTransfer).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: BOOKING_ID,
      actorId: null,
      evidence: expect.objectContaining({
        provider: 'SEPAY',
        providerEventId: '92704',
        externalReference: 'FT24012345678',
        receivedAmount: 250000,
      }),
    }));
    expect(prisma.bankTransferWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'PROCESSED',
        bookingId: BOOKING_ID,
      }),
    });
    expect(emitBookingStatusUpdated).toHaveBeenCalled();
    expect(queueNewBookingNotification).toHaveBeenCalledWith(BOOKING_ID);
    expect(queueConfirmedTicketEmail).toHaveBeenCalledWith(BOOKING_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('sends a mismatched amount to review without issuing a ticket', async () => {
    const req = createRequest(incomingPayload({ transferAmount: 249000 }));
    const res = createResponse();

    await sepayWebhook(req, res);

    expect(confirmBankTransfer).not.toHaveBeenCalled();
    expect(prisma.bankTransferWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'REVIEW_REQUIRED',
        bookingId: BOOKING_ID,
        failureReason: 'BANK_TRANSFER_AMOUNT_MISMATCH',
      }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
