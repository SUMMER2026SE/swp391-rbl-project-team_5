'use strict';

const prisma = require('../config/prisma');
const {
  emitBookingStatusUpdated,
  emitRecoveryCaseEvent,
  emitRefundStatusUpdated,
} = require('../realtime/events');
const { sendRefundStatusEmail } = require('../utils/mailer');
const { writeAuditLog } = require('../utils/auditLog');

const REFUND_NOTIFICATION_TOPIC = 'REFUND_STATUS_UPDATED';
const OUTBOX_PENDING = 'PENDING';
const OUTBOX_PROCESSING = 'PROCESSING';
const OUTBOX_SENT = 'SENT';
const OUTBOX_CLAIM_TTL_MS = 5 * 60 * 1000;

function refundNotificationKey(refundRequestId, status = 'APPROVED') {
  return `refund:${refundRequestId}:${status}`;
}

async function enqueueRefundNotification(
  client,
  {
    refundRequestId,
    status = 'APPROVED',
    amount = null,
    refundTransactionId = null,
  },
) {
  if (!refundRequestId || !client?.notificationOutbox?.upsert) return null;
  const dedupeKey = refundNotificationKey(refundRequestId, status);
  return client.notificationOutbox.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      dedupeKey,
      topic: REFUND_NOTIFICATION_TOPIC,
      aggregateId: refundRequestId,
      payload: {
        status,
        amount: amount == null ? null : Number(amount),
        refundTransactionId,
      },
    },
    select: { id: true, dedupeKey: true, status: true },
  });
}

async function markRefundNotificationDelivered(
  client,
  {
    refundRequestId,
    status = 'APPROVED',
    now = new Date(),
  },
) {
  if (!refundRequestId || !client?.notificationOutbox?.updateMany) return false;
  const updated = await client.notificationOutbox.updateMany({
    where: {
      dedupeKey: refundNotificationKey(refundRequestId, status),
      status: { not: OUTBOX_SENT },
    },
    data: {
      status: OUTBOX_SENT,
      sentAt: now,
      lockedAt: null,
      lastError: null,
    },
  });
  return updated.count === 1;
}

async function loadRefundNotificationContext(refundRequestId) {
  const request = await prisma.refundRequest.findUnique({
    where: { id: refundRequestId },
    select: {
      id: true,
      status: true,
      amount: true,
      requestKey: true,
      targetBookingId: true,
      booking: {
        select: {
          id: true,
          userId: true,
          email: true,
          fullName: true,
          status: true,
        },
      },
      targetBooking: {
        select: {
          id: true,
          userId: true,
          email: true,
          fullName: true,
          status: true,
        },
      },
    },
  });
  if (!request) {
    const error = new Error(`Không tìm thấy yêu cầu hoàn tiền ${refundRequestId}.`);
    error.permanent = true;
    throw error;
  }
  return request;
}

async function deliverApprovedRefundNotification({
  refundRequestId,
  amount = null,
  refundTransactionId = null,
}) {
  const request = await loadRefundNotificationContext(refundRequestId);
  if (request.status !== 'APPROVED') {
    const error = new Error(
      `Yêu cầu ${refundRequestId} chưa ở trạng thái APPROVED (hiện tại: ${request.status}).`,
    );
    // A stale outbox event must not send a misleading customer message.
    error.permanent = ['REJECTED'].includes(request.status);
    throw error;
  }

  const customerBooking = request.targetBooking || request.booking;
  const customerId = customerBooking?.userId || request.booking?.userId;
  const requestKey = String(request.requestKey || '');
  const recoveryCaseId = (
    requestKey.startsWith('recovery-full:')
    || requestKey.startsWith('recovery-difference:')
  )
    ? requestKey.slice(requestKey.indexOf(':') + 1)
    : null;
  const recoveryCase = recoveryCaseId && prisma.recoveryCase?.findUnique
    ? await prisma.recoveryCase.findUnique({
      where: { id: recoveryCaseId },
      select: {
        id: true,
        status: true,
        originalBookingId: true,
        replacementBookingId: true,
        userId: true,
      },
    })
    : null;
  const resolvedAmount = Number(amount ?? request.amount ?? 0);
  const message = 'Cổng thanh toán đã xác nhận khoản hoàn. Ngân hàng có thể cần thêm thời gian để ghi có.';

  if (customerId) {
    emitRefundStatusUpdated({
      customerId,
      refundRequestId: request.id,
      status: 'APPROVED',
      amount: resolvedAmount,
      sourceBookingId: request.booking?.id || null,
      targetBookingId: request.targetBookingId || request.targetBooking?.id || null,
      recoveryCaseId: recoveryCase?.id || null,
      message,
    });

    const emittedBookingIds = new Set();
    for (const booking of [request.booking, request.targetBooking]) {
      if (!booking?.id || emittedBookingIds.has(booking.id)) continue;
      if (booking.status === 'REFUNDED') {
        emitBookingStatusUpdated({
          customerId,
          bookingId: booking.id,
          status: 'REFUNDED',
          message: 'Khoản hoàn tiền cho đơn của bạn đã được cổng thanh toán xác nhận.',
        });
      }
      emittedBookingIds.add(booking.id);
    }
    if (recoveryCase?.status === 'REFUNDED') {
      emitRecoveryCaseEvent({
        customerId,
        recoveryCaseId: recoveryCase.id,
        status: 'REFUNDED',
        message: 'Khoản hoàn tiền Rescue đã được cổng thanh toán xác nhận.',
        originalBookingId: recoveryCase.originalBookingId,
        replacementBookingId: recoveryCase.replacementBookingId,
      });
    }
  }

  if (customerBooking?.email) {
    await sendRefundStatusEmail({
      to: customerBooking.email,
      fullName: customerBooking.fullName,
      bookingId: customerBooking.id,
      action: 'APPROVED',
      refundAmount: resolvedAmount,
      staffNotes: 'Khoản hoàn đã được cổng thanh toán xác nhận.',
    });
  }

  if (prisma.auditLog?.create) {
    await writeAuditLog({
      client: prisma,
      actorId: null,
      action: 'REFUND_NOTIFICATION_DELIVERED',
      entityType: 'RefundRequest',
      entityId: request.id,
      metadata: {
        refundTransactionId,
        recoveryCaseId: recoveryCase?.id || null,
        amount: resolvedAmount,
      },
    }).catch((error) => {
      // Financial state and customer delivery are already complete; a
      // secondary audit write must not cause duplicate customer emails.
      console.error('[refund-notification] Không thể ghi audit giao nhận:', error.message);
    });
  }
  return true;
}

async function claimOutboxRow(dedupeKey, now = new Date()) {
  if (!prisma.notificationOutbox?.findUnique) return null;
  const row = await prisma.notificationOutbox.findUnique({ where: { dedupeKey } });
  if (!row || row.status === OUTBOX_SENT) return row;
  const staleBefore = new Date(now.getTime() - OUTBOX_CLAIM_TTL_MS);
  const claimed = await prisma.notificationOutbox.updateMany({
    where: {
      id: row.id,
      OR: [
        { status: OUTBOX_PENDING, nextAttemptAt: { lte: now } },
        { status: OUTBOX_PROCESSING, lockedAt: { lte: staleBefore } },
      ],
    },
    data: {
      status: OUTBOX_PROCESSING,
      lockedAt: now,
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  return { ...row, status: OUTBOX_PROCESSING, lockedAt: now };
}

function retryDelayMs(attempts) {
  const exponent = Math.min(Math.max(Number(attempts || 1) - 1, 0), 7);
  return Math.min(6 * 60 * 60 * 1000, 30 * 1000 * (2 ** exponent));
}

async function deliverClaimedOutboxRow(row, now = new Date()) {
  const payload = (
    row?.payload
    && typeof row.payload === 'object'
    && !Array.isArray(row.payload)
  ) ? row.payload : {};
  try {
    if (row.topic !== REFUND_NOTIFICATION_TOPIC || payload.status !== 'APPROVED') {
      const unsupported = new Error(`Loại thông báo không được hỗ trợ: ${row.topic}.`);
      unsupported.permanent = true;
      throw unsupported;
    }
    await deliverApprovedRefundNotification({
      refundRequestId: row.aggregateId,
      amount: payload.amount,
      refundTransactionId: payload.refundTransactionId,
    });
    if (prisma.notificationOutbox?.updateMany) {
      await prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: OUTBOX_PROCESSING },
        data: {
          status: OUTBOX_SENT,
          sentAt: now,
          lockedAt: null,
          lastError: null,
        },
      });
    }
    return true;
  } catch (error) {
    if (prisma.notificationOutbox?.updateMany) {
      const permanent = error.permanent === true;
      await prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: OUTBOX_PROCESSING },
        data: permanent
          ? {
            status: OUTBOX_SENT,
            sentAt: now,
            lockedAt: null,
            lastError: `SKIPPED: ${String(error.message || error).slice(0, 2000)}`,
          }
          : {
            status: OUTBOX_PENDING,
            nextAttemptAt: new Date(now.getTime() + retryDelayMs(row.attempts)),
            lockedAt: null,
            lastError: String(error.message || error).slice(0, 2000),
          },
      });
    }
    if (error.permanent === true) return false;
    throw error;
  }
}

async function deliverRefundNotificationNow({
  refundRequestId,
  status = 'APPROVED',
  amount = null,
  refundTransactionId = null,
}) {
  const dedupeKey = refundNotificationKey(refundRequestId, status);
  if (!prisma.notificationOutbox?.findUnique) {
    // Lightweight unit-test adapters and legacy deployments can still deliver
    // synchronously. Production always has the durable outbox migration.
    return deliverApprovedRefundNotification({
      refundRequestId,
      amount,
      refundTransactionId,
    });
  }
  const row = await claimOutboxRow(dedupeKey);
  if (!row || row.status === OUTBOX_SENT) return row?.status === OUTBOX_SENT;
  return deliverClaimedOutboxRow(row);
}

module.exports = {
  OUTBOX_CLAIM_TTL_MS,
  OUTBOX_PENDING,
  OUTBOX_PROCESSING,
  OUTBOX_SENT,
  REFUND_NOTIFICATION_TOPIC,
  claimOutboxRow,
  deliverApprovedRefundNotification,
  deliverClaimedOutboxRow,
  deliverRefundNotificationNow,
  enqueueRefundNotification,
  markRefundNotificationDelivered,
  refundNotificationKey,
  retryDelayMs,
};
