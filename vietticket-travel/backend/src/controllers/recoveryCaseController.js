'use strict';

const prisma = require('../config/prisma');
const {
  CASE_INCLUDE,
  acceptRecoveryOption,
  declineRecoveryCase,
  getRecoveryCaseDetail,
  serializeRecoveryCase,
  sweepExpiredRecoveryCases,
} = require('../services/recoveryService');
const {
  emitBookingStatusUpdated,
  emitLiveTripUpdated,
  emitRecoveryCaseEvent,
} = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');

const VALID_STATUSES = new Set(['OPEN', 'REPLACED', 'REFUND_PENDING', 'REFUNDED']);

function sendRecoveryError(res, error) {
  return res.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.code || 'RECOVERY_ERROR',
      message: error.message,
    },
    message: error.message,
  });
}

async function listRecoveryCases(req, res, next) {
  try {
    await sweepExpiredRecoveryCases({ userId: req.user.id });
    const requestedStatus = String(req.query.status || '').trim().toUpperCase();
    if (requestedStatus && !VALID_STATUSES.has(requestedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái yêu cầu cứu chuyến không hợp lệ.',
      });
    }

    const cases = await prisma.recoveryCase.findMany({
      where: {
        userId: req.user.id,
        ...(requestedStatus ? { status: requestedStatus } : {}),
      },
      include: CASE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return res.json({
      success: true,
      data: cases.map((recoveryCase) => serializeRecoveryCase(recoveryCase)),
    });
  } catch (error) {
    return next(error);
  }
}

async function getRecoveryCase(req, res, next) {
  try {
    await sweepExpiredRecoveryCases({ userId: req.user.id });
    const {
      recoveryCase,
      options,
      transitionedToRefundPending,
      optionsUnavailable,
    } = await getRecoveryCaseDetail({
      recoveryCaseId: req.params.id,
      userId: req.user.id,
      req,
    });
    if (transitionedToRefundPending) {
      emitRecoveryCaseEvent({
        customerId: req.user.id,
        recoveryCaseId: recoveryCase.id,
        eventName: 'RECOVERY_CASE_UPDATED',
        status: 'REFUND_PENDING',
        message: 'Không còn phương án thay thế phù hợp. Hoàn tiền 100% đang được xử lý.',
        originalBookingId: recoveryCase.originalBookingId,
      });
    }
    return res.json({
      success: true,
      data: serializeRecoveryCase(recoveryCase, { options, optionsUnavailable }),
    });
  } catch (error) {
    if (error.statusCode) return sendRecoveryError(res, error);
    if (error.code === 'P2034') {
      return sendRecoveryError(res, {
        statusCode: 409,
        code: 'RECOVERY_STATE_CHANGED',
        message: 'Yêu cầu vừa được xử lý ở thiết bị khác. Vui lòng tải lại.',
      });
    }
    return next(error);
  }
}

async function acceptOption(req, res, next) {
  try {
    const ticketProductId = String(req.body?.ticketProductId || '').trim();
    const timeSlotId = req.body?.timeSlotId
      ? String(req.body.timeSlotId).trim()
      : null;
    const quoteFingerprint = String(req.body?.quoteFingerprint || '').trim().toLowerCase();
    if (!ticketProductId) {
      return res.status(400).json({
        success: false,
        error: { code: 'OPTION_REQUIRED', message: 'Vui lòng chọn một phương án thay thế.' },
        message: 'Vui lòng chọn một phương án thay thế.',
      });
    }

    const result = await acceptRecoveryOption({
      recoveryCaseId: req.params.id,
      userId: req.user.id,
      ticketProductId,
      timeSlotId,
      quoteFingerprint,
      req,
    });
    if (result.expired) {
      emitRecoveryCaseEvent({
        customerId: req.user.id,
        recoveryCaseId: req.params.id,
        status: 'REFUND_PENDING',
        message: 'Đã hết thời gian lựa chọn. Hoàn tiền 100% đang được xử lý.',
      });
      return res.status(409).json({
        success: false,
        error: {
          code: 'RECOVERY_EXPIRED',
          message: 'Đã hết thời gian lựa chọn. Hoàn tiền 100% đang được xử lý.',
        },
        message: 'Đã hết thời gian lựa chọn. Hoàn tiền 100% đang được xử lý.',
      });
    }

    if (!result.replayed) {
      queueConfirmedTicketEmail(result.replacementBookingId);
      emitBookingStatusUpdated({
        customerId: req.user.id,
        bookingId: result.replacementBookingId,
        status: 'CONFIRMED',
        message: 'Vé thay thế đã được xác nhận và QR mới đã sẵn sàng.',
      });
      emitRecoveryCaseEvent({
        customerId: req.user.id,
        recoveryCaseId: result.recoveryCaseId,
        status: 'REPLACED',
        message: 'Kế hoạch đã được cứu thành công. Vé mới đã sẵn sàng.',
        originalBookingId: result.originalBookingId,
        replacementBookingId: result.replacementBookingId,
      });
      result.liveTripIds.forEach((tripId) => {
        emitLiveTripUpdated({
          customerId: req.user.id,
          tripId,
          reason: 'BOOKING_RECOVERED',
        });
      });
    }

    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { id: result.recoveryCaseId },
      include: CASE_INCLUDE,
    });
    return res.json({
      success: true,
      message: result.replayed
        ? 'Phương án này đã được xác nhận trước đó.'
        : 'Đổi vé thành công. QR mới đã được cấp.',
      data: serializeRecoveryCase(recoveryCase),
    });
  } catch (error) {
    if (error.statusCode) return sendRecoveryError(res, error);
    if (error.code === 'P2034') {
      return sendRecoveryError(res, {
        statusCode: 409,
        code: 'OPTION_UNAVAILABLE',
        message: 'Tồn kho vừa thay đổi. Vui lòng tải lại và chọn phương án khác.',
      });
    }
    return next(error);
  }
}

async function declineCase(req, res, next) {
  try {
    const updated = await declineRecoveryCase({
      recoveryCaseId: req.params.id,
      userId: req.user.id,
      req,
    });
    if (!updated.replayed) {
      emitRecoveryCaseEvent({
        customerId: req.user.id,
        recoveryCaseId: updated.id,
        status: 'REFUND_PENDING',
        message: 'Yêu cầu hoàn tiền 100% đã được ghi nhận và đang xử lý.',
        originalBookingId: updated.originalBookingId,
      });
    }
    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { id: updated.id },
      include: CASE_INCLUDE,
    });
    return res.json({
      success: true,
      message: updated.replayed
        ? 'Yêu cầu hoàn tiền 100% đã được ghi nhận trước đó.'
        : 'Đã chọn hoàn tiền 100%.',
      data: serializeRecoveryCase(recoveryCase),
    });
  } catch (error) {
    if (error.statusCode) return sendRecoveryError(res, error);
    if (error.code === 'P2034') {
      return sendRecoveryError(res, {
        statusCode: 409,
        code: 'RECOVERY_ALREADY_DECIDED',
        message: 'Yêu cầu vừa được xử lý ở thiết bị khác.',
      });
    }
    return next(error);
  }
}

module.exports = {
  acceptOption,
  declineCase,
  getRecoveryCase,
  listRecoveryCases,
};
