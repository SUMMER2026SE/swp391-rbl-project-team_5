'use strict';

const mockPrisma = {
  notificationOutbox: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  refundRequest: { findUnique: jest.fn() },
  recoveryCase: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
};

jest.mock('../config/prisma', () => mockPrisma);
jest.mock('../utils/mailer', () => ({
  sendRefundStatusEmail: jest.fn(),
}));
jest.mock('../realtime/events', () => ({
  emitBookingStatusUpdated: jest.fn(),
  emitRecoveryCaseEvent: jest.fn(),
  emitRefundStatusUpdated: jest.fn(),
}));
jest.mock('../utils/auditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue({}),
}));
jest.mock('../utils/jobLease', () => ({
  runWithJobLease: jest.fn((_name, _ttl, task) => task()),
}));

const { sendRefundStatusEmail } = require('../utils/mailer');
const {
  deliverRefundNotificationNow,
  enqueueRefundNotification,
} = require('../services/refundNotificationService');
const {
  sweepNotificationOutbox,
} = require('../utils/notificationOutboxWorker');

function outboxRow(overrides = {}) {
  return {
    id: 'outbox-1',
    dedupeKey: 'refund:refund-1:APPROVED',
    topic: 'REFUND_STATUS_UPDATED',
    aggregateId: 'refund-1',
    payload: {
      status: 'APPROVED',
      amount: 90000,
      refundTransactionId: 'refund-txn-1',
    },
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date('2026-07-28T01:00:00.000Z'),
    lockedAt: null,
    createdAt: new Date('2026-07-28T00:59:00.000Z'),
    ...overrides,
  };
}

function approvedRequest() {
  return {
    id: 'refund-1',
    status: 'APPROVED',
    amount: 90000,
    requestKey: 'recovery-full:case-1',
    targetBookingId: 'booking-target',
    booking: {
      id: 'booking-source',
      userId: 'user-1',
      email: 'customer@example.com',
      fullName: 'Nguyen Van A',
      status: 'REFUNDED',
    },
    targetBooking: {
      id: 'booking-target',
      userId: 'user-1',
      email: 'customer@example.com',
      fullName: 'Nguyen Van A',
      status: 'REFUNDED',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.refundRequest.findUnique.mockResolvedValue(approvedRequest());
  mockPrisma.recoveryCase.findUnique.mockResolvedValue({
    id: 'case-1',
    status: 'REFUNDED',
    originalBookingId: 'booking-target',
    replacementBookingId: null,
    userId: 'user-1',
  });
  sendRefundStatusEmail.mockResolvedValue({ sent: true });
});

test('enqueues the approved notification atomically with an idempotency key', async () => {
  const client = {
    notificationOutbox: {
      upsert: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
  };

  await enqueueRefundNotification(client, {
    refundRequestId: 'refund-1',
    amount: 90000,
    refundTransactionId: 'refund-txn-1',
  });

  expect(client.notificationOutbox.upsert).toHaveBeenCalledWith({
    where: { dedupeKey: 'refund:refund-1:APPROVED' },
    update: {},
    create: expect.objectContaining({
      dedupeKey: 'refund:refund-1:APPROVED',
      aggregateId: 'refund-1',
      payload: expect.objectContaining({
        amount: 90000,
        refundTransactionId: 'refund-txn-1',
      }),
    }),
    select: { id: true, dedupeKey: true, status: true },
  });
});

test('claims, delivers and marks an outbox notification SENT', async () => {
  const row = outboxRow();
  mockPrisma.notificationOutbox.findUnique.mockResolvedValue(row);

  const delivered = await deliverRefundNotificationNow({
    refundRequestId: 'refund-1',
    amount: 90000,
    refundTransactionId: 'refund-txn-1',
  });

  expect(delivered).toBe(true);
  expect(sendRefundStatusEmail).toHaveBeenCalledTimes(1);
  expect(mockPrisma.notificationOutbox.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'outbox-1', status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'SENT' }),
    }),
  );
});

test('returns a failed email delivery to PENDING with backoff for automatic retry', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const now = new Date('2026-07-28T02:00:00.000Z');
  const row = outboxRow({ nextAttemptAt: new Date('2026-07-28T01:00:00.000Z') });
  mockPrisma.notificationOutbox.findMany.mockResolvedValue([row]);
  mockPrisma.notificationOutbox.findUnique.mockResolvedValue(row);
  sendRefundStatusEmail.mockRejectedValue(new Error('SMTP unavailable'));

  const delivered = await sweepNotificationOutbox({ now });

  expect(delivered).toBe(0);
  expect(mockPrisma.notificationOutbox.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'outbox-1', status: 'PROCESSING' },
      data: expect.objectContaining({
        status: 'PENDING',
        lastError: 'SMTP unavailable',
        nextAttemptAt: expect.any(Date),
      }),
    }),
  );
  consoleError.mockRestore();
});
