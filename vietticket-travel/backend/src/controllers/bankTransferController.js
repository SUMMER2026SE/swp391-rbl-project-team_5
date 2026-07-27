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
      include: { reservation: { select: { expiresAt: true, status: true } } },
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

    const instruction = buildTransferInstruction(booking);
    return res.json({
      success: true,
      data: {
        ...instruction,
        bookingId: booking.id,
        bookingStatus: booking.status,
        // Đơn đã được duyệt thì không cần chuyển tiền nữa.
        paid: booking.status !== 'PENDING_PAYMENT',
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

    const result = await confirmBankTransfer({
      bookingId,
      actorId: req.user.id,
      req,
      note,
    });

    if (result.alreadyConfirmed) {
      return res.status(200).json({
        success: true,
        message: 'Đơn này đã được xác nhận thanh toán trước đó.',
        data: { bookingId, bookingStatus: result.bookingStatus, alreadyConfirmed: true },
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
    return next(error);
  }
}

module.exports = {
  confirmBankTransferPayment,
  getBankTransferInstruction,
  listBankTransferQueue,
  listPaymentMethods,
};
