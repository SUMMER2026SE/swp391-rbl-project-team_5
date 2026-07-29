'use strict';

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { getBookingActivityWindow } = require('../utils/activityTime');
const {
  releaseHeldInventory,
  releaseInventory,
} = require('../utils/refundService');
const { releaseVoucherRedemption } = require('./voucherRedemptionService');
const {
  getCapturedPayment,
  queueMandatoryRefund,
  queueRecoveryFullRefund,
} = require('./mandatoryRefundService');
const {
  ORIGINAL_BOOKING_INCLUDE,
  createRecoveryCaseForCancellation,
  resolveRecoveryFundingBooking,
} = require('./recoveryService');
const {
  OPERATIONAL_CANCELLATION_TOPIC,
  enqueueBookingNotification,
} = require('./bookingNotificationService');
const { writeAuditLog } = require('../utils/auditLog');

const ACTIVE_BOOKING_STATUSES = ['PENDING_PAYMENT', 'PENDING_PARTNER', 'CONFIRMED'];

function emptySummary() {
  return {
    affected: 0,
    cancelled: 0,
    rescueOpened: 0,
    refundQueued: 0,
    unpaidReleased: 0,
    needsAttention: 0,
    failedBookingIds: [],
  };
}

async function resolveAttractionIds({ attractionIds = [], partnerId = null }) {
  const normalized = [...new Set(
    attractionIds.map((id) => String(id || '').trim()).filter(Boolean),
  )];
  if (!partnerId) return normalized;
  const partnerAttractions = await prisma.attraction.findMany({
    where: { partnerId, archivedAt: null },
    select: { id: true },
  });
  return [...new Set([
    ...normalized,
    ...(partnerAttractions || []).map((attraction) => attraction.id),
  ])];
}

async function createAttentionTicket(client, booking, reason, detail) {
  return client.supportTicket.create({
    data: {
      userId: booking.userId,
      bookingId: booking.id,
      subject: `Khẩn: booking bị ảnh hưởng bởi đình chỉ vận hành`,
      description:
        `Booking ${booking.id} không thể tự động hủy an toàn khi dịch vụ bị đình chỉ. `
        + `Lý do đình chỉ: ${reason}. Chi tiết cần xử lý: ${detail}`,
      status: 'OPEN',
      priority: 'URGENT',
    },
  });
}

async function cancelAffectedBooking({
  bookingId,
  reason,
  actorId,
  req,
  now,
  source,
}) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: ORIGINAL_BOOKING_INCLUDE,
    });
    if (
      !booking
      || booking.isForecastTrainingSample
      || !ACTIVE_BOOKING_STATUSES.includes(booking.status)
    ) {
      return { skipped: true };
    }

    const hasUsedTicket = booking.ticketInstances.some((ticket) => ticket.status === 'USED');
    const { startsAt } = getBookingActivityWindow(booking);
    if (hasUsedTicket || !startsAt || startsAt <= now) {
      await createAttentionTicket(
        tx,
        booking,
        reason,
        hasUsedTicket
          ? 'Đã có vé check-in; Staff phải xác minh dịch vụ thực tế và quyền lợi khách.'
          : 'Hoạt động đã bắt đầu hoặc thiếu giờ bắt đầu đáng tin cậy.',
      );
      await writeAuditLog({
        client: tx,
        req,
        actorId,
        action: 'SUSPENSION_BOOKING_REQUIRES_MANUAL_HANDLING',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: { source, reason, hasUsedTicket, startsAt },
      });
      return { needsAttention: true };
    }

    const reservationStatus = booking.reservation?.status;
    if (!['HELD', 'CONFIRMED'].includes(reservationStatus)) {
      await createAttentionTicket(
        tx,
        booking,
        reason,
        `Reservation đang ở trạng thái ${reservationStatus || 'UNKNOWN'}.`,
      );
      return { needsAttention: true };
    }

    const fundingBooking = await resolveRecoveryFundingBooking(tx, booking);
    const hasPaid = Boolean(fundingBooking && getCapturedPayment(fundingBooking));
    if (booking.status === 'CONFIRMED' && !hasPaid) {
      await createAttentionTicket(
        tx,
        booking,
        reason,
        'Booking CONFIRMED nhưng không tìm thấy giao dịch thu tiền có thể hoàn.',
      );
      return { needsAttention: true };
    }

    const claimed = await tx.booking.updateMany({
      where: {
        id: booking.id,
        status: booking.status,
        isForecastTrainingSample: false,
      },
      data: {
        status: 'CANCELLED',
        refundRequired: hasPaid,
        cancelledAt: now,
        cancellationReason: reason,
        cancellationSource: source,
      },
    });
    if (claimed.count !== 1) return { skipped: true };

    if (reservationStatus === 'CONFIRMED') {
      await releaseInventory(tx, booking);
    } else {
      const released = await releaseHeldInventory(tx, booking.reservation, {
        status: 'CANCELLED',
      });
      if (!released) {
        const error = new Error('Không thể giải phóng tồn kho đang giữ.');
        error.statusCode = 409;
        throw error;
      }
    }

    await tx.ticketInstance.updateMany({
      where: { bookingId: booking.id, status: 'VALID' },
      data: { status: 'EXPIRED' },
    });
    if (booking.voucherId) {
      await releaseVoucherRedemption(tx, {
        bookingId: booking.id,
        voucherId: booking.voucherId,
        now,
      });
    }

    let recoveryCase = null;
    let refundQueued = false;
    if (hasPaid) {
      recoveryCase = await createRecoveryCaseForCancellation(tx, booking, {
        trigger: 'SYSTEM_CANCELLATION',
        reason,
        now,
      });
      if (!recoveryCase) {
        const queued = fundingBooking.id === booking.id
          ? await queueMandatoryRefund(tx, booking, {
              type: 'SYSTEM_CANCELLATION',
              reason: `Dịch vụ bị đình chỉ vận hành. Hoàn 100%. Lý do: ${reason}`,
              now,
            })
          : await queueRecoveryFullRefund(tx, fundingBooking, {
              cancelledBookingId: booking.id,
              targetBookingId: booking.id,
              amount: Number(booking.totalAmount),
              type: 'SYSTEM_CANCELLATION',
              reason: `Vé thay thế bị đình chỉ vận hành. Hoàn 100%. Lý do: ${reason}`,
              now,
            });
        if (!queued?.refundRequest) {
          const error = new Error('Không thể tạo yêu cầu hoàn tiền bắt buộc.');
          error.statusCode = 409;
          throw error;
        }
        refundQueued = true;
        if (fundingBooking.id !== booking.id) {
          await tx.booking.update({
            where: { id: fundingBooking.id },
            data: { refundRequired: true },
          });
        }
      }
    }

    await enqueueBookingNotification(tx, {
      bookingId: booking.id,
      topic: OPERATIONAL_CANCELLATION_TOPIC,
      reason,
      recoveryCaseId: recoveryCase?.id || null,
      recoveryExpiresAt: recoveryCase?.expiresAt || null,
      refundAmount: hasPaid ? Number(booking.totalAmount) : 0,
    });
    await writeAuditLog({
      client: tx,
      req,
      actorId,
      action: 'SUSPENSION_BOOKING_CANCELLED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: {
        source,
        reason,
        previousStatus: booking.status,
        refundRequired: hasPaid,
        refundQueued,
        recoveryCaseId: recoveryCase?.id || null,
      },
    });

    return {
      cancelled: true,
      hasPaid,
      recoveryOpened: Boolean(recoveryCase),
      refundQueued,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function remediateSuspendedBookings({
  attractionIds = [],
  partnerId = null,
  reason,
  actorId = null,
  req = null,
  source = 'SYSTEM_SUSPENSION',
  now = new Date(),
}) {
  const resolvedAttractionIds = await resolveAttractionIds({ attractionIds, partnerId });
  const summary = emptySummary();
  if (resolvedAttractionIds.length === 0) return summary;

  const candidates = await prisma.booking.findMany({
    where: {
      isForecastTrainingSample: false,
      status: { in: ACTIVE_BOOKING_STATUSES },
      OR: [
        { snapshotAttractionId: { in: resolvedAttractionIds } },
        {
          reservation: {
            ticketProduct: { attractionId: { in: resolvedAttractionIds } },
          },
        },
      ],
    },
    select: { id: true, userId: true },
    orderBy: { createdAt: 'asc' },
  });
  summary.affected = (candidates || []).length;

  for (const candidate of candidates || []) {
    try {
      const result = await cancelAffectedBooking({
        bookingId: candidate.id,
        reason,
        actorId,
        req,
        now,
        source,
      });
      if (result.cancelled) summary.cancelled += 1;
      if (result.recoveryOpened) summary.rescueOpened += 1;
      if (result.refundQueued) summary.refundQueued += 1;
      if (result.cancelled && !result.hasPaid) summary.unpaidReleased += 1;
      if (result.needsAttention) summary.needsAttention += 1;
    } catch (error) {
      summary.needsAttention += 1;
      summary.failedBookingIds.push(candidate.id);
      try {
        await createAttentionTicket(
          prisma,
          candidate,
          reason,
          `Tự động xử lý thất bại: ${String(error.message || error).slice(0, 1000)}`,
        );
      } catch (ticketError) {
        console.error(
          `[suspension] Không thể mở support ticket cho booking ${candidate.id}:`,
          ticketError.message,
        );
      }
    }
  }
  return summary;
}

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  cancelAffectedBooking,
  remediateSuspendedBookings,
};
