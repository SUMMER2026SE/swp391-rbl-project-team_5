'use strict';

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { emitBookingStatusUpdated } = require('../realtime/events');
const { sendPendingApprovalExpiredEmail } = require('./mailer');
const { releaseInventory } = require('./refundService');
const { queueMandatoryRefund } = require('../services/mandatoryRefundService');
const { acquireJobLock, releaseJobLock, INSTANCE_ID } = require('./cleanupWorker');
const {
  MANUAL_APPROVAL_TIMEOUT_MS,
  getManualApprovalDeadline,
} = require('./activityTime');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const PARTNER_APPROVAL_TIMEOUT_MS = MANUAL_APPROVAL_TIMEOUT_MS;
const JOB_NAME = 'expire_pending_partner_bookings';
const LOCK_TTL_MS = DEFAULT_INTERVAL_MS * 2;
const EXPIRY_REASON = 'Đối tác không xác nhận đơn trong thời hạn 24 giờ.';

function successfulPaymentExpiredWhere(cutoff) {
  return {
    status: 'SUCCESS',
    isDuplicate: false,
    OR: [
      { paidAt: { lte: cutoff } },
      { paidAt: null, createdAt: { lte: cutoff } },
    ],
  };
}

async function expirePendingPartnerBooking(
  bookingId,
  { now = new Date(), timeoutMs = PARTNER_APPROVAL_TIMEOUT_MS } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          payments: {
            where: { status: 'SUCCESS', isDuplicate: false },
            select: {
              id: true,
              status: true,
              isDuplicate: true,
              paidAt: true,
              createdAt: true,
              paymentGateway: true,
              amount: true,
            },
          },
          refundRequests: { select: { id: true, status: true } },
          reservation: {
            include: {
              timeSlot: true,
              ticketProduct: {
                select: {
                  attractionId: true,
                  attraction: { select: { openTime: true, closeTime: true } },
                },
              },
            },
          },
        },
      });

      if (!booking || booking.status !== 'PENDING_PARTNER' || booking.payments.length === 0) {
        return null;
      }

      const approvalDeadline = getManualApprovalDeadline(booking, timeoutMs);
      if (!approvalDeadline || now < approvalDeadline) return null;

      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: 'PENDING_PARTNER' },
        data: {
          status: 'CANCELLED',
          refundRequired: true,
          cancelledAt: now,
          cancellationReason: EXPIRY_REASON,
          cancellationSource: 'SYSTEM_APPROVAL_TIMEOUT',
        },
      });
      if (claimed.count !== 1) return null;

      await releaseInventory(tx, booking);

      if (booking.voucherId) {
        await tx.voucher.updateMany({
          where: { id: booking.voucherId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }

      await queueMandatoryRefund(tx, booking, {
        type: 'SYSTEM_CANCELLATION',
        reason: `Hệ thống tự động hủy đơn. ${EXPIRY_REASON}`,
        now,
      });

      return {
        id: booking.id,
        userId: booking.userId,
        email: booking.email,
        fullName: booking.fullName,
        totalAmount: Number(booking.totalAmount),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function sweepExpiredPartnerApprovals({
  now = new Date(),
  timeoutMs = PARTNER_APPROVAL_TIMEOUT_MS,
} = {}) {
  const candidates = await prisma.booking.findMany({
    where: {
      status: 'PENDING_PARTNER',
      payments: { some: { status: 'SUCCESS', isDuplicate: false } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true },
  });

  let expiredCount = 0;
  for (const { id } of candidates) {
    try {
      const expired = await expirePendingPartnerBooking(id, { now, timeoutMs });
      if (!expired) continue;

      expiredCount += 1;
      emitBookingStatusUpdated({
        customerId: expired.userId,
        bookingId: expired.id,
        status: 'CANCELLED',
        message: `Đơn ${expired.id.slice(0, 8).toUpperCase()} đã tự động hủy vì quá 24 giờ chưa được đối tác xác nhận. Yêu cầu hoàn tiền 100% đã được tạo.`,
      });
      sendPendingApprovalExpiredEmail({
        to: expired.email,
        fullName: expired.fullName,
        bookingId: expired.id,
        refundAmount: expired.totalAmount,
      }).catch((error) => {
        console.error(`[partner-approval] Không thể gửi email quá hạn cho ${expired.id}:`, error.message);
      });
    } catch (error) {
      console.error(`[partner-approval] Không thể xử lý đơn ${id}:`, error.message);
    }
  }

  if (expiredCount > 0) {
    console.log(`[partner-approval] Đã hủy ${expiredCount}/${candidates.length} đơn quá hạn duyệt.`);
  }
  return expiredCount;
}

function startPendingPartnerWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;

    let lockAcquired;
    try {
      lockAcquired = await acquireJobLock(JOB_NAME, LOCK_TTL_MS);
    } catch (error) {
      console.error('[partner-approval] Không thể kiểm tra lock:', error.message);
      return;
    }
    if (!lockAcquired) return;

    isRunning = true;
    try {
      await sweepExpiredPartnerApprovals();
    } catch (error) {
      console.error('[partner-approval] Lỗi vòng quét:', error.message);
    } finally {
      isRunning = false;
      await releaseJobLock(JOB_NAME);
    }
  };

  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  console.log(`[partner-approval] Worker đã khởi động (instance=${INSTANCE_ID}, mỗi ${intervalMs / 1000}s).`);
  return handle;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  EXPIRY_REASON,
  PARTNER_APPROVAL_TIMEOUT_MS,
  expirePendingPartnerBooking,
  startPendingPartnerWorker,
  successfulPaymentExpiredWhere,
  sweepExpiredPartnerApprovals,
};
