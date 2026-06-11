'use strict';

const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { releaseInventory, todayInVietnam } = require('../utils/refundService');
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
            payments: {
              where: { status: 'SUCCESS' },
              orderBy: { createdAt: 'desc' },
              select: { id: true, paymentGateway: true, status: true },
            },
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

    // staffNotes bắt buộc khi từ chối để gửi email giải thích cho khách.
    if (action === 'REJECTED' && !staffNotes) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vui lòng nhập lý do từ chối để thông báo cho khách hàng.' },
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
    let gatewayRefundDone = false;
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

        gatewayRefundDone = true;
        const noteRefundOk = `VNPay refund OK (RequestNo gốc: ${onlinePayment.rawResponse?.vnp_TransactionNo || 'N/A'})`;
        finalStaffNotes = [staffNotes, noteRefundOk].filter(Boolean).join(' | ');

        // Lưu NGAY kết quả hoàn tiền của cổng vào Payment.rawResponse để có dữ liệu
        // đối soát, kể cả khi transaction cập nhật trạng thái phía dưới thất bại.
        try {
          await prisma.payment.update({
            where: { id: onlinePayment.id },
            data: {
              rawResponse: {
                ...(onlinePayment.rawResponse || {}),
                refund: gateway.raw,
              },
            },
          });
        } catch (persistError) {
          console.error(
            `[staff-refund] KHÔNG LƯU ĐƯỢC kết quả refund VNPay của booking ${refundRequest.booking.id} ` +
              `(refund TransactionNo: ${gateway.raw?.vnp_TransactionNo || 'N/A'}):`,
            persistError.message,
          );
        }
      }
    }

    // 3) Cổng đã OK (hoặc đơn không trả online) -> mới ghi DB trong transaction.
    let result;
    try {
      result = await prisma.$transaction(
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
        } else if (booking.status === 'REFUND_REQUESTED') {
          // Khách tự yêu cầu hoàn -> từ chối thì trả đơn về trạng thái đã xác nhận.
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'CONFIRMED', refundRequired: false },
          });
        }
        // Đơn CANCELLED (partner từ chối / thu tiền nhưng mất vé) thì giữ nguyên
        // trạng thái và refundRequired để tiếp tục đối soát — tiền của khách vẫn phải hoàn.

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
    } catch (txError) {
      if (gatewayRefundDone) {
        // Tiền ĐÃ hoàn qua cổng nhưng DB chưa cập nhật được -> cần đối soát thủ công.
        console.error(
          `[staff-refund][ĐỐI SOÁT] Cổng VNPay đã hoàn tiền cho booking ${refundRequest.booking.id} ` +
            `nhưng cập nhật DB thất bại. Kiểm tra Payment.rawResponse.refund để đối soát. Lỗi: ${txError.message}`,
        );
      }
      throw txError;
    }

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

// ─── Check-in tại cổng ──────────────────────────────────────────────────────

// Khách có thể quét nguyên chuỗi trong QR ("VIETTICKET:<token>") hoặc nhập tay token.
function normalizeQrToken(raw) {
  const value = String(raw || '').trim();
  return value.startsWith('VIETTICKET:') ? value.slice('VIETTICKET:'.length) : value;
}

function toCheckinTicket(instance) {
  const booking = instance.booking;
  const reservation = booking.reservation;
  const visitDay = new Date(reservation.date).toISOString().slice(0, 10);
  const timeSlot = reservation.timeSlot;

  return {
    bookingId: booking.id,
    bookingStatus: booking.status,
    ticketStatus: instance.status,
    customer: booking.fullName,
    phone: booking.phone,
    attraction: reservation.ticketProduct.attraction.title,
    ticketName: reservation.ticketProduct.name,
    quantity: reservation.quantity,
    visitDate: visitDay,
    timeSlot: timeSlot ? `${timeSlot.startTime} - ${timeSlot.endTime}` : null,
    checkedInAt: instance.status === 'USED' ? instance.updatedAt : null,
  };
}

// Lý do KHÔNG được check-in (null = hợp lệ). Thứ tự ưu tiên để thông báo chính xác.
function getCheckinBlockReason(instance, now = new Date()) {
  const booking = instance.booking;
  const visitDay = new Date(booking.reservation.date).toISOString().slice(0, 10);
  const today = todayInVietnam(now);

  if (instance.status === 'USED') {
    return 'Vé này ĐÃ ĐƯỢC CHECK-IN trước đó. Không cho khách vào lần hai.';
  }
  if (instance.status === 'REFUNDED') {
    return 'Vé này đã được hoàn tiền và không còn hiệu lực.';
  }
  if (instance.status === 'EXPIRED') {
    return 'Vé này đã bị thu hồi (đã cấp lại vé mới). Yêu cầu khách mở vé mới nhất trong email/ứng dụng.';
  }
  if (booking.status !== 'CONFIRMED') {
    return `Đơn đặt vé không ở trạng thái đã xác nhận (hiện tại: ${booking.status}).`;
  }
  if (visitDay !== today) {
    return visitDay > today
      ? `Vé dùng cho ngày ${visitDay}, chưa tới ngày tham quan.`
      : `Vé dùng cho ngày ${visitDay}, đã quá ngày tham quan.`;
  }
  return null;
}

// GET /api/staff/checkin/:token — tra cứu vé theo mã QR (chỉ xem, không ghi DB).
async function lookupTicketByQr(req, res, next) {
  try {
    const token = normalizeQrToken(req.params.token);
    if (!token) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu mã vé.' } });
    }

    const instance = await prisma.ticketInstance.findUnique({
      where: { qrCodeToken: token },
      include: {
        booking: {
          include: {
            reservation: {
              include: {
                timeSlot: true,
                ticketProduct: { include: { attraction: { select: { title: true } } } },
              },
            },
          },
        },
      },
    });

    if (!instance) {
      return res.status(404).json({
        success: false,
        error: { message: 'Không tìm thấy vé với mã này. Kiểm tra lại mã QR hoặc nhập tay mã vé.' },
      });
    }

    const blockReason = getCheckinBlockReason(instance);
    return res.json({
      success: true,
      data: {
        ...toCheckinTicket(instance),
        canCheckIn: blockReason === null,
        blockReason,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// POST /api/staff/checkin/:token — check-in cả đơn (mọi vé VALID của booking → USED).
// E-ticket hiển thị MỘT mã QR cho cả đơn nên check-in theo đơn, không theo từng vé lẻ.
async function checkInTicket(req, res, next) {
  try {
    const token = normalizeQrToken(req.params.token);
    if (!token) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu mã vé.' } });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const instance = await tx.ticketInstance.findUnique({
          where: { qrCodeToken: token },
          include: {
            booking: {
              include: {
                reservation: {
                  include: {
                    timeSlot: true,
                    ticketProduct: { include: { attraction: { select: { title: true } } } },
                  },
                },
              },
            },
          },
        });

        if (!instance) {
          throw httpError(404, 'Không tìm thấy vé với mã này.');
        }

        const blockReason = getCheckinBlockReason(instance);
        if (blockReason) {
          throw httpError(409, blockReason);
        }

        // updateMany với guard status VALID: hai nhân viên quét cùng lúc thì chỉ
        // một request thực sự check-in, request sau thấy count = 0 -> đã dùng.
        const updated = await tx.ticketInstance.updateMany({
          where: { bookingId: instance.bookingId, status: 'VALID' },
          data: { status: 'USED' },
        });
        if (updated.count === 0) {
          throw httpError(409, 'Vé này vừa được check-in bởi một nhân viên khác.');
        }

        return { instance, checkedInCount: updated.count };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return res.json({
      success: true,
      message: `Check-in thành công ${result.checkedInCount} vé.`,
      data: {
        ...toCheckinTicket(result.instance),
        ticketStatus: 'USED',
        checkedInCount: result.checkedInCount,
        checkedInAt: new Date(),
        checkedInBy: req.user.email,
      },
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

// GET /api/staff/bookings/today — danh sách đơn CONFIRMED/COMPLETED có ngày tham quan
// là hôm nay (giờ VN) để nhân viên đối chiếu khách đến cổng.
async function listTodayBookings(req, res, next) {
  try {
    const today = todayInVietnam();
    const todayDate = new Date(`${today}T00:00:00.000Z`);

    const bookings = await prisma.booking.findMany({
      where: {
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        reservation: { date: todayDate },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        ticketInstances: { select: { status: true } },
        reservation: {
          include: {
            timeSlot: true,
            ticketProduct: { include: { attraction: { select: { title: true } } } },
          },
        },
      },
    });

    const data = bookings.map((b) => {
      const usedCount = b.ticketInstances.filter((t) => t.status === 'USED').length;
      const validCount = b.ticketInstances.filter((t) => t.status === 'VALID').length;
      const timeSlot = b.reservation.timeSlot;
      return {
        bookingId: b.id,
        customer: b.fullName,
        phone: b.phone,
        attraction: b.reservation.ticketProduct.attraction.title,
        ticketName: b.reservation.ticketProduct.name,
        quantity: b.reservation.quantity,
        timeSlot: timeSlot ? `${timeSlot.startTime} - ${timeSlot.endTime}` : null,
        checkedIn: usedCount > 0 && validCount === 0,
        usedCount,
        validCount,
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        date: today,
        total: data.length,
        checkedIn: data.filter((b) => b.checkedIn).length,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listRefundRequests,
  processRefundRequest,
  reissueTicket,
  lookupTicketByQr,
  checkInTicket,
  listTodayBookings,
};
