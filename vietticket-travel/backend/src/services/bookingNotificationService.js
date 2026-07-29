'use strict';

const prisma = require('../config/prisma');
const {
  emitBookingStatusUpdated,
  emitNewBooking,
} = require('../realtime/events');
const {
  sendBookingApprovedForPaymentEmail,
  sendBookingCancelledForSafetyEmail,
  sendPartnerApprovalRequestEmail,
  sendRecoveryCaseCreatedEmail,
} = require('../utils/mailer');
const { writeAuditLog } = require('../utils/auditLog');
const {
  OUTBOX_PENDING,
  OUTBOX_PROCESSING,
  OUTBOX_SENT,
  claimOutboxRow,
  retryDelayMs,
} = require('./refundNotificationService');

const PARTNER_APPROVAL_REQUESTED_TOPIC = 'PARTNER_APPROVAL_REQUESTED';
const CUSTOMER_PAYMENT_WINDOW_OPENED_TOPIC = 'CUSTOMER_PAYMENT_WINDOW_OPENED';
const OPERATIONAL_CANCELLATION_TOPIC = 'OPERATIONAL_CANCELLATION';
const BOOKING_NOTIFICATION_TOPICS = [
  PARTNER_APPROVAL_REQUESTED_TOPIC,
  CUSTOMER_PAYMENT_WINDOW_OPENED_TOPIC,
  OPERATIONAL_CANCELLATION_TOPIC,
];

function bookingNotificationKey(bookingId, topic) {
  return `booking:${bookingId}:${String(topic || '').toLowerCase()}`;
}

async function enqueueBookingNotification(
  client,
  {
    bookingId,
    topic,
    paymentDeadline = null,
    reason = null,
    recoveryCaseId = null,
    recoveryExpiresAt = null,
    refundAmount = null,
  },
) {
  if (
    !bookingId
    || !BOOKING_NOTIFICATION_TOPICS.includes(topic)
    || !client?.notificationOutbox?.upsert
  ) {
    return null;
  }
  const dedupeKey = bookingNotificationKey(bookingId, topic);
  return client.notificationOutbox.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      dedupeKey,
      topic,
      aggregateId: bookingId,
      payload: {
        paymentDeadline: paymentDeadline
          ? new Date(paymentDeadline).toISOString()
          : null,
        reason,
        recoveryCaseId,
        recoveryExpiresAt: recoveryExpiresAt
          ? new Date(recoveryExpiresAt).toISOString()
          : null,
        refundAmount,
      },
    },
    select: { id: true, dedupeKey: true, status: true },
  });
}

async function loadBookingNotificationContext(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      reservation: {
        include: {
          timeSlot: true,
          ticketProduct: {
            include: {
              attraction: {
                include: {
                  partner: {
                    include: {
                      user: { select: { email: true, fullName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!booking || booking.isForecastTrainingSample) {
    const error = new Error(`Không tìm thấy booking ${bookingId}.`);
    error.permanent = true;
    throw error;
  }
  return booking;
}

async function deliverBookingNotification({
  bookingId,
  topic,
  paymentDeadline = null,
  reason = null,
  recoveryCaseId = null,
  recoveryExpiresAt = null,
  refundAmount = null,
}) {
  const booking = await loadBookingNotificationContext(bookingId);
  const attraction = booking.reservation?.ticketProduct?.attraction;

  if (topic === PARTNER_APPROVAL_REQUESTED_TOPIC) {
    if (booking.status !== 'PENDING_PARTNER' || !booking.partnerApprovalRequestedAt) {
      const error = new Error('Yêu cầu duyệt không còn chờ đối tác xử lý.');
      error.permanent = true;
      throw error;
    }
    emitNewBooking(booking);
    if (attraction?.partner?.user?.email) {
      await sendPartnerApprovalRequestEmail({
        to: attraction.partner.user.email,
        partnerName: attraction.partner.businessName || attraction.partner.user.fullName,
        bookingId: booking.id,
        customerName: booking.fullName,
        attractionTitle: attraction.title,
        visitDate: booking.reservation.date,
        approvalDeadline: booking.partnerApprovalDeadline,
      });
    }
  } else if (topic === CUSTOMER_PAYMENT_WINDOW_OPENED_TOPIC) {
    if (
      booking.status !== 'PENDING_PAYMENT'
      || !booking.partnerApprovedAt
      || booking.reservation?.status !== 'HELD'
    ) {
      const error = new Error('Cửa sổ thanh toán sau duyệt không còn hiệu lực.');
      error.permanent = true;
      throw error;
    }
    const resolvedDeadline =
      paymentDeadline
      || booking.reservation.paymentDeadline
      || booking.reservation.expiresAt;
    emitBookingStatusUpdated({
      customerId: booking.userId,
      bookingId: booking.id,
      status: 'PENDING_PAYMENT',
      message: 'Đối tác đã duyệt yêu cầu. Vui lòng thanh toán trước hạn để nhận vé.',
    });
    if (booking.email) {
      await sendBookingApprovedForPaymentEmail({
        to: booking.email,
        fullName: booking.fullName,
        bookingId: booking.id,
        reservationId: booking.reservationId,
        attractionTitle: attraction?.title,
        paymentDeadline: resolvedDeadline,
      });
    }
  } else if (topic === OPERATIONAL_CANCELLATION_TOPIC) {
    if (booking.status !== 'CANCELLED') {
      const error = new Error('Đơn không còn ở trạng thái hủy do sự cố vận hành.');
      error.permanent = true;
      throw error;
    }
    const resolvedReason = reason || booking.cancellationReason
      || 'Dịch vụ hiện không thể tiếp nhận khách.';
    emitBookingStatusUpdated({
      customerId: booking.userId,
      bookingId: booking.id,
      status: 'CANCELLED',
      message: recoveryCaseId
        ? `Đơn ${booking.id} đã bị hủy vì sự cố vận hành. VietTicket Rescue đã mở phương án thay thế; bạn vẫn có thể chọn hoàn 100%.`
        : `Đơn ${booking.id} đã bị hủy vì sự cố vận hành. Yêu cầu hoàn tiền 100% đang được xử lý.`,
    });
    if (booking.email) {
      if (recoveryCaseId) {
        await sendRecoveryCaseCreatedEmail({
          to: booking.email,
          fullName: booking.fullName,
          bookingId: booking.id,
          recoveryCaseId,
          reason: resolvedReason,
          expiresAt: recoveryExpiresAt,
        });
      } else {
        await sendBookingCancelledForSafetyEmail({
          to: booking.email,
          fullName: booking.fullName,
          bookingId: booking.id,
          reason: resolvedReason,
          refundAmount: refundAmount ?? Number(booking.totalAmount),
        });
      }
    }
  } else {
    const error = new Error(`Loại thông báo booking không được hỗ trợ: ${topic}.`);
    error.permanent = true;
    throw error;
  }

  if (prisma.auditLog?.create) {
    await writeAuditLog({
      client: prisma,
      actorId: null,
      action: 'BOOKING_NOTIFICATION_DELIVERED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: { topic },
    }).catch((error) => {
      console.error('[booking-notification] Không thể ghi audit:', error.message);
    });
  }
  return true;
}

async function deliverClaimedBookingOutboxRow(row, now = new Date()) {
  const payload = (
    row?.payload
    && typeof row.payload === 'object'
    && !Array.isArray(row.payload)
  ) ? row.payload : {};
  try {
    await deliverBookingNotification({
      bookingId: row.aggregateId,
      topic: row.topic,
      paymentDeadline: payload.paymentDeadline || null,
      reason: payload.reason || null,
      recoveryCaseId: payload.recoveryCaseId || null,
      recoveryExpiresAt: payload.recoveryExpiresAt || null,
      refundAmount: payload.refundAmount ?? null,
    });
    await prisma.notificationOutbox.updateMany({
      where: { id: row.id, status: OUTBOX_PROCESSING },
      data: {
        status: OUTBOX_SENT,
        sentAt: now,
        lockedAt: null,
        lastError: null,
      },
    });
    return true;
  } catch (error) {
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
    if (permanent) return false;
    throw error;
  }
}

async function deliverBookingNotificationNow({ bookingId, topic }) {
  const dedupeKey = bookingNotificationKey(bookingId, topic);
  const row = await claimOutboxRow(dedupeKey);
  if (!row || row.status === OUTBOX_SENT) return row?.status === OUTBOX_SENT;
  return deliverClaimedBookingOutboxRow(row);
}

module.exports = {
  BOOKING_NOTIFICATION_TOPICS,
  CUSTOMER_PAYMENT_WINDOW_OPENED_TOPIC,
  OPERATIONAL_CANCELLATION_TOPIC,
  PARTNER_APPROVAL_REQUESTED_TOPIC,
  bookingNotificationKey,
  deliverBookingNotification,
  deliverBookingNotificationNow,
  deliverClaimedBookingOutboxRow,
  enqueueBookingNotification,
};
