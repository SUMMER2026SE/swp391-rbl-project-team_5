'use strict';

const crypto = require('crypto');
const prisma = require('../config/prisma');
const {
  getBankTransferConfig,
  getSepayWebhookConfig,
} = require('../config/runtimeConfig');
const {
  confirmBankTransfer,
} = require('../services/bankTransferService');
const {
  emitBookingStatusUpdated,
  queueNewBookingNotification,
} = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');
const { formatBookingReference } = require('../utils/bookingReference');

const PROVIDER = 'SEPAY';
const EVENT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_EVENT_STATUSES = new Set([
  'PROCESSED',
  'REVIEW_REQUIRED',
  'IGNORED',
]);

function normalizeAccountNumber(value) {
  return String(value || '').replace(/\D/gu, '');
}

function parseTransferDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const vietnamLocal = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(raw)
    ? `${raw.replace(' ', 'T')}+07:00`
    : raw;
  const parsed = new Date(vietnamLocal);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTransferAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount;
}

function extractBookingSuffix(payload = {}) {
  const matches = new Set();
  for (const source of [payload.code, payload.content]) {
    const text = String(source || '').toUpperCase();
    for (const match of text.matchAll(/VT[\s-]*([A-F0-9]{12})(?![A-F0-9])/gu)) {
      matches.add(match[1]);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function buildProviderEventId(payload, rawBody) {
  const explicitId = String(payload?.id ?? '').trim();
  if (explicitId && explicitId !== '0') return explicitId;

  const digest = crypto
    .createHash('sha256')
    .update(rawBody)
    .digest('hex')
    .slice(0, 40);
  return `test-${digest}`;
}

function buildStoredPayload(payload = {}) {
  return {
    id: payload.id ?? null,
    gateway: payload.gateway ?? null,
    transactionDate: payload.transactionDate ?? null,
    accountNumber: payload.accountNumber ?? null,
    subAccount: payload.subAccount ?? null,
    code: payload.code ?? null,
    content: payload.content ?? null,
    transferType: payload.transferType ?? null,
    transferAmount: payload.transferAmount ?? null,
    referenceCode: payload.referenceCode ?? null,
  };
}

function verifySepaySignature({
  rawBody,
  signature,
  timestamp,
  secret,
  toleranceSeconds,
  nowMs = Date.now(),
}) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  if (!secret) return false;

  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - parsedTimestamp) > toleranceSeconds) {
    return false;
  }

  const providedHex = String(signature || '').replace(/^sha256=/iu, '');
  if (!/^[a-f0-9]{64}$/iu.test(providedHex)) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parsedTimestamp}.`)
    .update(rawBody)
    .digest();
  const provided = Buffer.from(providedHex, 'hex');
  return provided.length === expected.length
    && crypto.timingSafeEqual(expected, provided);
}

async function findOrCreateWebhookEvent({
  providerEventId,
  payload,
  amount,
  transferredAt,
}) {
  try {
    return await prisma.bankTransferWebhookEvent.create({
      data: {
        provider: PROVIDER,
        providerEventId,
        status: 'RECEIVED',
        externalReference: String(payload.referenceCode || '').trim() || null,
        accountNumber: normalizeAccountNumber(payload.accountNumber) || null,
        transferAmount: amount,
        transferContent: String(payload.content || '').trim() || null,
        transferredAt,
        payload: buildStoredPayload(payload),
      },
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    return prisma.bankTransferWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId,
        },
      },
    });
  }
}

async function claimWebhookEvent(event) {
  if (!event || TERMINAL_EVENT_STATUSES.has(event.status)) return false;

  const now = new Date();
  const staleBefore = new Date(now.getTime() - EVENT_PROCESSING_TIMEOUT_MS);
  const claimed = await prisma.bankTransferWebhookEvent.updateMany({
    where: {
      id: event.id,
      OR: [
        { status: { in: ['RECEIVED', 'FAILED'] } },
        {
          status: 'PROCESSING',
          processingStartedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      status: 'PROCESSING',
      processingStartedAt: now,
      failureReason: null,
      attemptCount: { increment: 1 },
    },
  });
  return claimed.count === 1;
}

async function finishWebhookEvent(eventId, {
  status,
  bookingId = null,
  reason = null,
}) {
  await prisma.bankTransferWebhookEvent.update({
    where: { id: eventId },
    data: {
      status,
      bookingId,
      failureReason: reason,
      processedAt: new Date(),
    },
  });
}

function acknowledge(res) {
  return res.status(200).json({ success: true });
}

async function notifyCustomerAndPartner(result, bookingId) {
  if (result.alreadyConfirmed) return;

  if (result.latePayment) {
    emitBookingStatusUpdated({
      customerId: result.booking.userId,
      bookingId,
      status: 'CANCELLED',
      message:
        `VietTicket đã nhận chuyển khoản cho đơn ${formatBookingReference(bookingId)} `
        + 'sau khi hết giữ chỗ. Yêu cầu hoàn 100% đã được tạo.',
    });
    return;
  }

  emitBookingStatusUpdated({
    customerId: result.booking.userId,
    bookingId,
    status: result.bookingStatus,
    message:
      result.bookingStatus === 'CONFIRMED'
        ? `Đơn ${formatBookingReference(bookingId)} đã thanh toán thành công. Vé điện tử đã sẵn sàng.`
        : `Đơn ${formatBookingReference(bookingId)} đã nhận tiền và đang chờ đối tác duyệt.`,
  });
  queueNewBookingNotification(bookingId);
  if (result.bookingStatus === 'CONFIRMED') {
    queueConfirmedTicketEmail(bookingId);
  }
}

async function sepayWebhook(req, res) {
  const config = getSepayWebhookConfig();
  if (!config.enabled || config.secret.length < 32) {
    return res.status(503).json({ success: false });
  }

  const signatureValid = verifySepaySignature({
    rawBody: req.rawBody,
    signature: req.get('x-sepay-signature'),
    timestamp: req.get('x-sepay-timestamp'),
    secret: config.secret,
    toleranceSeconds: config.toleranceSeconds,
  });
  if (!signatureValid) {
    return res.status(401).json({ success: false });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};

  // SePay's "Gửi thử" payload uses id=0. Acknowledge it after signature
  // verification without polluting the financial exception queue.
  if (String(payload.id ?? '').trim() === '0') {
    return acknowledge(res);
  }

  const rawBody = req.rawBody;
  const providerEventId = buildProviderEventId(payload, rawBody);
  const amount = parseTransferAmount(payload.transferAmount);
  const transferredAt = parseTransferDate(payload.transactionDate);
  let event = null;

  try {
    event = await findOrCreateWebhookEvent({
      providerEventId,
      payload,
      amount,
      transferredAt,
    });
    if (!event || TERMINAL_EVENT_STATUSES.has(event.status)) {
      return acknowledge(res);
    }
    if (!(await claimWebhookEvent(event))) {
      return acknowledge(res);
    }

    if (String(payload.transferType || '').toLowerCase() !== 'in') {
      await finishWebhookEvent(event.id, {
        status: 'IGNORED',
        reason: 'OUTGOING_TRANSFER',
      });
      return acknowledge(res);
    }

    const bankConfig = getBankTransferConfig();
    if (
      !bankConfig.configured
      || normalizeAccountNumber(payload.accountNumber) !== bankConfig.accountNumber
    ) {
      await finishWebhookEvent(event.id, {
        status: 'REVIEW_REQUIRED',
        reason: 'RECEIVING_ACCOUNT_MISMATCH',
      });
      return acknowledge(res);
    }

    const bookingSuffix = extractBookingSuffix(payload);
    if (!bookingSuffix) {
      await finishWebhookEvent(event.id, {
        status: 'REVIEW_REQUIRED',
        reason: 'BOOKING_REFERENCE_MISSING_OR_AMBIGUOUS',
      });
      return acknowledge(res);
    }

    const bookings = await prisma.booking.findMany({
      where: {
        id: { endsWith: bookingSuffix, mode: 'insensitive' },
        paymentMethod: 'bank_transfer',
        isForecastTrainingSample: false,
      },
      select: {
        id: true,
        totalAmount: true,
      },
      take: 2,
    });
    if (bookings.length !== 1) {
      await finishWebhookEvent(event.id, {
        status: 'REVIEW_REQUIRED',
        reason: bookings.length === 0
          ? 'BOOKING_NOT_FOUND'
          : 'BOOKING_REFERENCE_AMBIGUOUS',
      });
      return acknowledge(res);
    }

    const booking = bookings[0];
    if (amount === null || amount !== Number(booking.totalAmount)) {
      await finishWebhookEvent(event.id, {
        status: 'REVIEW_REQUIRED',
        bookingId: booking.id,
        reason: 'BANK_TRANSFER_AMOUNT_MISMATCH',
      });
      return acknowledge(res);
    }
    if (!transferredAt) {
      await finishWebhookEvent(event.id, {
        status: 'REVIEW_REQUIRED',
        bookingId: booking.id,
        reason: 'INVALID_TRANSACTION_DATE',
      });
      return acknowledge(res);
    }

    const externalReference =
      String(payload.referenceCode || '').trim()
      || String(payload.code || '').trim()
      || `SEPAY-${providerEventId}`;
    const result = await confirmBankTransfer({
      bookingId: booking.id,
      actorId: null,
      req,
      note: 'Xác nhận tự động từ webhook SePay đã kiểm tra chữ ký HMAC-SHA256.',
      evidence: {
        provider: PROVIDER,
        providerEventId,
        externalReference,
        receivedAmount: amount,
        receivedAt: transferredAt.toISOString(),
        payerName: null,
      },
    });

    await finishWebhookEvent(event.id, {
      status: 'PROCESSED',
      bookingId: booking.id,
      reason: result.latePayment
        ? 'LATE_PAYMENT_REFUND_QUEUED'
        : result.alreadyConfirmed
          ? 'BOOKING_ALREADY_CONFIRMED'
          : null,
    });
    await notifyCustomerAndPartner(result, booking.id);
    return acknowledge(res);
  } catch (error) {
    if (event?.id) {
      await prisma.bankTransferWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          failureReason: String(error.code || error.message || 'PROCESSING_FAILED').slice(0, 1000),
        },
      }).catch(() => {});
    }
    console.error('[SePay] Webhook processing failed:', error);
    return res.status(500).json({ success: false });
  }
}

module.exports = {
  buildProviderEventId,
  extractBookingSuffix,
  parseTransferDate,
  sepayWebhook,
  verifySepaySignature,
};
