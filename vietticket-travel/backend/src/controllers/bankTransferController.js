'use strict';

// ============================================================
// bankTransferController.js — API thanh toán chuyển khoản (VietQR).
//   GET  /api/payments/methods                       - phương thức đang mở
//   GET  /api/payments/bank-transfer/:bookingId      - mã QR + hướng dẫn (khách)
//   GET  /api/admin/bank-transfers                   - đơn chờ đối chiếu (admin)
//   POST /api/admin/bank-transfers/:bookingId/confirm- xác nhận đã nhận tiền
// ============================================================

const prisma = require('../config/prisma');
const {
  BANK_TRANSFER_METHOD,
  buildTransferInstruction,
  confirmBankTransfer,
  isBankTransferAvailable,
  listPendingBankTransfers,
} = require('../services/bankTransferService');
const { queueNewBookingNotification, emitBookingStatusUpdated } = require('../realtime/events');
const { queueConfirmedTicketEmail } = require('../services/ticketEmailService');
const { formatBookingReference } = require('../utils/bookingReference');
const {
  isBankTransferPayment,
  isCapturedPayment,
} = require('../utils/paymentGateway');
const { parseVndInteger } = require('../utils/money');
const { writeAuditLog } = require('../utils/auditLog');

const BANK_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,119}$/;

// GET /api/payments/methods — cho trang thanh toán biết nên hiện những gì.
async function listPaymentMethods(req, res, next) {
  try {
    const methods = [
      {
        code: 'vnpay',
        label: 'Cổng thanh toán VNPay',
        description: 'Thẻ ATM nội địa, Internet Banking, ví điện tử. Xác nhận tự động.',
        available: true,
        instant: true,
      },
      {
        code: BANK_TRANSFER_METHOD,
        label: 'Chuyển khoản ngân hàng (QR)',
        description:
          'Quét mã VietQR bằng app ngân hàng, không cần nhập số tài khoản. '
          + 'Vé được phát sau khi nhân viên đối chiếu sao kê.',
        available: isBankTransferAvailable(),
        instant: false,
      },
    ];
    return res.json({ success: true, data: methods.filter((method) => method.available) });
  } catch (error) {
    return next(error);
  }
}

// GET /api/payments/bank-transfer/:bookingId — chỉ chủ đơn được xem.
async function getBankTransferInstruction(req, res, next) {
  try {
    const bookingId = String(req.params.bookingId || '').trim();
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        reservation: {
          select: {
            expiresAt: true,
            status: true,
            ticketProduct: {
              select: {
                attraction: { select: { requiresManualApproval: true } },
              },
            },
          },
        },
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: {
            id: true,
            status: true,
            isDuplicate: true,
            paymentGateway: true,
            paidAt: true,
          },
        },
      },
    });

    if (!booking || booking.isForecastTrainingSample || booking.userId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt vé.' });
    }
    if (booking.paymentMethod !== BANK_TRANSFER_METHOD) {
      return res.status(400).json({
        success: false,
        message: 'Đơn này không dùng phương thức chuyển khoản ngân hàng.',
      });
    }

    const capturedPayment = booking.payments.find((payment) => (
      isCapturedPayment(payment) && isBankTransferPayment(payment)
    ));
    const terminal = ['CANCELLED', 'REFUNDED'].includes(booking.status);
    const requiresManualApproval =
      booking.reservation?.ticketProduct?.attraction?.requiresManualApproval === true;
    const paymentWindowOpen =
      booking.status === 'PENDING_PAYMENT'
      && booking.reservation?.status === 'HELD'
      && new Date(booking.reservation.expiresAt) > new Date();
    if (!capturedPayment && !terminal && !paymentWindowOpen) {
      return res.status(409).json({
        success: false,
        code: requiresManualApproval && !booking.partnerApprovedAt
          ? 'PARTNER_APPROVAL_REQUIRED'
          : 'PAYMENT_WINDOW_NOT_OPEN',
        message: requiresManualApproval && !booking.partnerApprovedAt
          ? 'Đối tác phải duyệt yêu cầu trước khi thông tin chuyển khoản được mở.'
          : 'Đơn chưa ở trong thời hạn thanh toán chuyển khoản.',
      });
    }
    if (
      !capturedPayment
      && !terminal
      && requiresManualApproval
      && !booking.partnerApprovedAt
    ) {
      return res.status(409).json({
        success: false,
        code: 'PARTNER_APPROVAL_REQUIRED',
        message: 'Đối tác phải duyệt yêu cầu trước khi thông tin chuyển khoản được mở.',
      });
    }
    let instruction;
    try {
      instruction = buildTransferInstruction(booking);
    } catch (error) {
      // A paid or terminal booking must remain visible to the customer even if
      // Finance later disables the receiving account configuration.
      if (!capturedPayment && !terminal) throw error;
      instruction = {
        bankName: null,
        bankBin: null,
        accountNumber: null,
        accountName: null,
        amount: Number(booking.totalAmount),
        content: null,
        bookingReference: formatBookingReference(booking.id),
        qrPayload: null,
        expiresAt: booking.reservation?.expiresAt || null,
        holdMinutes: null,
      };
    }
    return res.json({
      success: true,
      data: {
        ...instruction,
        bookingId: booking.id,
        bookingStatus: booking.status,
        paid: Boolean(capturedPayment),
        paidAt: capturedPayment?.paidAt || null,
        terminal,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

// GET /api/admin/bank-transfers — hàng đợi đối chiếu sao kê.
async function listBankTransferQueue(req, res, next) {
  try {
    const items = await listPendingBankTransfers({ limit: req.query.limit });
    return res.json({ success: true, data: items });
  } catch (error) {
    return next(error);
  }
}

// POST /api/admin/bank-transfers/:bookingId/confirm — xác nhận đã nhận tiền.
async function confirmBankTransferPayment(req, res, next) {
  try {
    const bookingId = String(req.params.bookingId || '').trim();
    const note = String(req.body?.note || '').trim() || null;
    const existingReconciliation =
      await prisma.bankTransferReconciliation.findUnique({
        where: { bookingId },
      });

    if (!existingReconciliation) {
      const externalReference = String(req.body?.externalReference || '').trim();
      const receivedAmount = parseVndInteger(req.body?.receivedAmount);
      const receivedAt = new Date(req.body?.receivedAt || '');
      const payerName = String(req.body?.payerName || '').trim() || null;
      if (!BANK_REFERENCE_PATTERN.test(externalReference)) {
        return res.status(400).json({
          success: false,
          message: 'Mã giao dịch ngân hàng phải có 6-120 ký tự hợp lệ.',
        });
      }
      if (receivedAmount === null) {
        return res.status(400).json({
          success: false,
          message: 'Số tiền thực nhận phải là số nguyên VND lớn hơn 0.',
        });
      }
      if (
        Number.isNaN(receivedAt.getTime())
        || receivedAt.getTime() > Date.now() + 5 * 60 * 1000
      ) {
        return res.status(400).json({
          success: false,
          message: 'Thời điểm tiền vào không hợp lệ hoặc nằm trong tương lai.',
        });
      }
      if (payerName && payerName.length > 120) {
        return res.status(400).json({
          success: false,
          message: 'Tên người chuyển tối đa 120 ký tự.',
        });
      }
      if (note && note.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Ghi chú bằng chứng tối đa 1.000 ký tự.',
        });
      }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          paymentMethod: true,
          totalAmount: true,
          isForecastTrainingSample: true,
        },
      });
      if (
        !booking
        || booking.isForecastTrainingSample
        || booking.paymentMethod !== BANK_TRANSFER_METHOD
      ) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy đơn chuyển khoản.',
        });
      }
      if (receivedAmount !== parseVndInteger(booking.totalAmount)) {
        return res.status(409).json({
          success: false,
          code: 'BANK_TRANSFER_AMOUNT_MISMATCH',
          message: 'Số tiền trên sao kê không khớp chính xác tổng tiền booking. Không được phát vé; hãy chuyển giao dịch sang hàng đợi ngoại lệ.',
          expectedAmount: Number(booking.totalAmount),
          receivedAmount,
        });
      }

      const matched = await prisma.$transaction(async (tx) => {
        const created = await tx.bankTransferReconciliation.create({
          data: {
            bookingId,
            externalReference,
            receivedAmount,
            receivedAt,
            payerName,
            evidenceNote: note,
            status: 'MATCHED',
            matchedById: req.user.id,
          },
        });
        await writeAuditLog({
          client: tx,
          req,
          action: 'BANK_TRANSFER_MATCHED',
          entityType: 'BANK_TRANSFER_RECONCILIATION',
          entityId: created.id,
          metadata: {
            bookingId,
            externalReference,
            receivedAmount,
            receivedAt: receivedAt.toISOString(),
          },
        });
        return created;
      });

      return res.status(202).json({
        success: true,
        message: 'Đã lưu bằng chứng khớp sao kê. Một quản trị viên khác phải kiểm tra và duyệt trước khi phát vé.',
        data: {
          bookingId,
          reconciliationId: matched.id,
          reconciliationStatus: matched.status,
          awaitingSecondApproval: true,
        },
      });
    }

    if (existingReconciliation.status === 'APPROVED') {
      return res.status(200).json({
        success: true,
        message: 'Giao dịch chuyển khoản này đã được hai người kiểm tra và xác nhận.',
        data: {
          bookingId,
          reconciliationId: existingReconciliation.id,
          reconciliationStatus: 'APPROVED',
          alreadyConfirmed: true,
        },
      });
    }
    if (existingReconciliation.matchedById === req.user.id) {
      return res.status(409).json({
        success: false,
        code: 'MAKER_CHECKER_SEPARATION_REQUIRED',
        message: 'Người khớp sao kê không được tự duyệt giao dịch. Cần một quản trị viên khác kiểm tra bằng chứng.',
      });
    }

    const result = await confirmBankTransfer({
      bookingId,
      actorId: req.user.id,
      req,
      note: note || existingReconciliation.evidenceNote,
      evidence: {
        externalReference: existingReconciliation.externalReference,
        receivedAmount: Number(existingReconciliation.receivedAmount),
        receivedAt: existingReconciliation.receivedAt.toISOString(),
        payerName: existingReconciliation.payerName,
      },
    });

    const approved = await prisma.bankTransferReconciliation.updateMany({
      where: {
        id: existingReconciliation.id,
        status: 'MATCHED',
        matchedById: { not: req.user.id },
      },
      data: {
        status: 'APPROVED',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
    });
    if (approved.count !== 1) {
      return res.status(409).json({
        success: false,
        message: 'Giao dịch vừa được người khác xử lý. Vui lòng tải lại danh sách.',
      });
    }

    if (result.alreadyConfirmed) {
      return res.status(200).json({
        success: true,
        message: 'Đơn này đã được xác nhận thanh toán trước đó.',
        data: { bookingId, bookingStatus: result.bookingStatus, alreadyConfirmed: true },
      });
    }

    if (result.latePayment) {
      emitBookingStatusUpdated({
        customerId: result.booking.userId,
        bookingId,
        status: 'CANCELLED',
        message: `VietTicket đã nhận chuyển khoản cho đơn ${formatBookingReference(bookingId)} sau khi hết giữ chỗ. Yêu cầu hoàn 100% đã được tạo để nhân viên đối soát chuyển khoản.`,
      });
      return res.status(202).json({
        success: true,
        message: 'Đã ghi nhận khoản tiền đến muộn và tạo yêu cầu hoàn 100%; không phát vé cho đơn đã hết giữ chỗ.',
        data: {
          bookingId,
          bookingStatus: 'CANCELLED',
          alreadyConfirmed: false,
          latePayment: true,
          refundRequestId: result.refundRequestId,
        },
      });
    }

    // Thông báo cho khách và đối tác giống hệt luồng VNPay.
    emitBookingStatusUpdated({
      customerId: result.booking.userId,
      bookingId,
      status: result.bookingStatus,
      message:
        result.bookingStatus === 'CONFIRMED'
          ? `Đơn ${formatBookingReference(bookingId)} đã được xác nhận thanh toán chuyển khoản.`
          : `Đơn ${formatBookingReference(bookingId)} đã nhận được tiền và đang chờ đối tác duyệt.`,
    });
    queueNewBookingNotification(bookingId);
    if (result.bookingStatus === 'CONFIRMED') {
      queueConfirmedTicketEmail(bookingId);
    }

    return res.json({
      success: true,
      message:
        result.bookingStatus === 'CONFIRMED'
          ? 'Đã xác nhận thanh toán và phát vé điện tử cho khách.'
          : 'Đã xác nhận thanh toán. Đơn đang chờ đối tác duyệt.',
      data: { bookingId, bookingStatus: result.bookingStatus, alreadyConfirmed: false },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    // Hai nhân viên cùng bấm duyệt một đơn -> transaction Serializable báo lỗi
    // tuần tự hóa. Đây là tranh chấp bình thường, không phải lỗi hệ thống:
    // trả 409 để giao diện nhắc tải lại thay vì hiện "lỗi máy chủ".
    if (error.code === 'P2034') {
      return res.status(409).json({
        success: false,
        message: 'Đơn này vừa được một nhân viên khác xử lý. Vui lòng tải lại danh sách.',
      });
    }
    return next(error);
  }
}

module.exports = {
  confirmBankTransferPayment,
  getBankTransferInstruction,
  listBankTransferQueue,
  listPaymentMethods,
};
