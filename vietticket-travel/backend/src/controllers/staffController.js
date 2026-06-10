'use strict';

const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { releaseInventory } = require('../utils/refundService');
const { refundViaVnpay } = require('./paymentController');
const {
  sendRefundStatusEmail,
  sendReissueTicketEmail,
} = require('../utils/mailer');

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

const REFUND_ACTIONS = new Set(['APPROVED', 'REJECTED']);
const REFUND_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function listRefundRequests(req, res, next) {
  try {
    const status = String(req.query.status || '').trim().toUpperCase();
    if (status && !REFUND_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Trạng thái hoàn tiền không hợp lệ.' },
      });
    }

    const requests = await prisma.refundRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        booking: {
          include: {
            user: { select: { fullName: true, email: true } },
            reservation: {
              include: {
                timeSlot: true,
                ticketProduct: {
                  include: {
                    attraction: { select: { title: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    return res.json({ success: true, data: requests });
  } catch (error) {
    return next(error);
  }
}

async function processRefundRequest(req, res, next) {
  try {
    const { refundId } = req.params;
    const action = String(req.body?.action || '').trim().toUpperCase();
    const staffNotes = String(req.body?.staffNotes || '').trim() || null;

    if (!REFUND_ACTIONS.has(action)) {
      return res.status(400).json({
        success: false,
        error: { message: 'action phải là APPROVED hoặc REJECTED.' },
      });
    }

    // 1) Đọc trước (NGOÀI transaction) để có dữ liệu gọi cổng thanh toán.
    const refundRequest = await prisma.refundRequest.findUnique({
      where: { id: refundId },
      include: {
        booking: {
          include: {
            user: { select: { fullName: true, email: true } },
            payments: {
              where: { status: 'SUCCESS' },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!refundRequest) {
      throw httpError(404, 'Không tìm thấy yêu cầu hoàn tiền.');
    }
    if (refundRequest.status !== 'PENDING') {
      throw httpError(409, 'Yêu cầu này đã được xử lý trước đó.');
    }
    if (refundRequest.booking.status === 'REFUNDED') {
      throw httpError(409, 'Đơn đặt vé này đã được hoàn tiền.');
    }

    // 2) Khi DUYỆT: nếu đơn trả online qua VNPay -> gọi cổng hoàn tiền TRƯỚC.
    //    Nếu cổng từ chối -> dừng, KHÔNG đụng DB (đơn giữ nguyên REFUND_REQUESTED).
    let finalStaffNotes = staffNotes;
    if (action === 'APPROVED') {
      const onlinePayment = refundRequest.booking.payments.find((p) =>
        /vnpay/i.test(p.paymentGateway),
      );

      if (onlinePayment) {
        const total = Number(refundRequest.booking.totalAmount);
        const amount = Number(refundRequest.amount);
        // 02 = hoàn toàn phần, 03 = hoàn một phần (khi có phí hủy).
        const transactionType = amount >= total ? '02' : '03';

        const gateway = await refundViaVnpay({
          payment: onlinePayment,
          amount,
          transactionType,
          createBy: req.user.email,
          ipAddr: getClientIp(req),
          orderInfo: `Hoan tien don hang ${refundRequest.booking.id}`,
        });

        if (!gateway.success) {
          throw httpError(
            502,
            `Cổng VNPay từ chối hoàn tiền (mã ${gateway.responseCode || 'N/A'}).` +
              (gateway.message ? ` ${gateway.message}` : ''),
          );
        }

        const noteRefundOk = `VNPay refund OK (RequestNo gốc: ${onlinePayment.rawResponse?.vnp_TransactionNo || 'N/A'})`;
        finalStaffNotes = [staffNotes, noteRefundOk].filter(Boolean).join(' | ');
      }
    }

    // 3) Cổng đã OK (hoặc đơn không trả online) -> mới ghi DB trong transaction.
    const result = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.refundRequest.findUnique({
          where: { id: refundId },
          include: {
            booking: {
              include: {
                user: { select: { fullName: true, email: true } },
                reservation: { include: { ticketProduct: true } },
              },
            },
          },
        });

        if (!fresh || fresh.status !== 'PENDING') {
          throw httpError(409, 'Yêu cầu này đã được xử lý trước đó.');
        }
        if (fresh.booking.status === 'REFUNDED') {
          throw httpError(409, 'Đơn đặt vé này đã được hoàn tiền.');
        }

        const booking = fresh.booking;

        if (action === 'APPROVED') {
          await releaseInventory(tx, booking);
          await tx.ticketInstance.updateMany({
            where: { bookingId: booking.id },
            data: { status: 'REFUNDED' },
          });
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'REFUNDED', refundRequired: false },
          });
        } else {
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'CONFIRMED', refundRequired: false },
          });
        }

        const updated = await tx.refundRequest.update({
          where: { id: refundId },
          data: {
            status: action,
            staffNotes: finalStaffNotes,
            processedById: req.user.id,
            processedAt: new Date(),
          },
        });

        return { updated, booking, amount: fresh.amount };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    try {
      await sendRefundStatusEmail({
        to: result.booking.user.email,
        fullName: result.booking.user.fullName,
        bookingId: result.booking.id,
        action,
        refundAmount: Number(result.amount),
        staffNotes,
      });
    } catch (emailError) {
      console.error('[staff-refund] Không thể gửi email:', emailError.message);
    }

    return res.json({ success: true, data: result.updated });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { message: error.message },
      });
    }
    return next(error);
  }
}

async function reissueTicket(req, res, next) {
  try {
    const { bookingId } = req.params;

    const result = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            user: { select: { fullName: true, email: true } },
            ticketInstances: { where: { status: 'VALID' } },
          },
        });

        if (!booking) {
          throw httpError(404, 'Không tìm thấy đơn đặt vé.');
        }
        if (!['CONFIRMED', 'COMPLETED'].includes(booking.status)) {
          throw httpError(409, 'Chỉ có thể cấp lại vé cho đơn đã xác nhận.');
        }
        if (!booking.ticketInstances.length) {
          throw httpError(400, 'Đơn hàng này không có vé điện tử còn hiệu lực.');
        }

        await tx.ticketInstance.updateMany({
          where: { bookingId, status: 'VALID' },
          data: { status: 'EXPIRED' },
        });

        const newInstances = await Promise.all(
          booking.ticketInstances.map((instance) =>
            tx.ticketInstance.create({
              data: {
                bookingId,
                ticketProductId: instance.ticketProductId,
                qrCodeToken: randomUUID(),
                status: 'VALID',
              },
            }),
          ),
        );

        return { booking, newInstances };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    try {
      await sendReissueTicketEmail({
        to: result.booking.user.email,
        fullName: result.booking.user.fullName,
        bookingId,
        newTicketCount: result.newInstances.length,
      });
    } catch (emailError) {
      console.error('[staff-reissue] Không thể gửi email:', emailError.message);
    }

    return res.json({
      success: true,
      data: result.newInstances,
      message: 'Đã cấp lại vé thành công.',
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { message: error.message },
      });
    }
    return next(error);
  }
}

module.exports = {
  listRefundRequests,
  processRefundRequest,
  reissueTicket,
};
