const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { buildVnpayUrl, verifyVnpaySignature, formatVnpDate } = require('../utils/vnpay');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('./bookingController');

const PAYMENT_WINDOW_MS = 10 * 60 * 1000; // 10 phút (khớp vnp_ExpireDate)

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

// VNPay yêu cầu số tiền nhân 100, dạng số nguyên.
function amountToVnp(totalAmount) {
  return Math.round(Number(totalAmount) * 100);
}

// POST /api/payments/create-vnpay-url
async function createVNPayUrl(req, res, next) {
  try {
    const bookingId = String(req.body?.bookingId || req.params?.bookingId || '').trim();
    if (!bookingId) {
      return res.status(400).json({ message: 'bookingId là bắt buộc.' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!booking || booking.userId !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé.' });
    }
    if (booking.paymentMethod !== 'vnpay') {
      return res.status(400).json({ message: 'Đơn này không dùng phương thức VNPay.' });
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ message: 'Đơn không ở trạng thái chờ thanh toán.' });
    }

    const tmnCode = process.env.VNP_TMNCODE;
    const secret = process.env.VNP_HASHSECRET;
    const vnpUrl = process.env.VNP_URL;
    const returnUrl = process.env.VNP_RETURNURL;
    if (!tmnCode || !secret || !vnpUrl || !returnUrl) {
      return res.status(500).json({ message: 'Thiếu cấu hình VNPay trên máy chủ.' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_MS);
    // TxnRef chỉ gồm [a-z0-9] (bỏ dấu '-' của uuid) + timestamp -> duy nhất mỗi lần thử.
    const txnRef = `${bookingId.replace(/-/g, '')}${now.getTime()}`;

    // Reset cửa sổ thanh toán + gắn TxnRef vào Payment để IPN/Return tra ngược.
    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: booking.reservationId },
        data: { expiresAt },
      });
      const payment = booking.payments[0];
      if (payment) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { transactionId: txnRef, paymentGateway: 'VNPAY', status: 'PENDING' },
        });
      } else {
        await tx.payment.create({
          data: {
            bookingId,
            amount: booking.totalAmount,
            paymentGateway: 'VNPAY',
            transactionId: txnRef,
            status: 'PENDING',
          },
        });
      }
    });

    const params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: `Thanh toan don hang ${bookingId}`,
      vnp_OrderType: 'other',
      vnp_Amount: amountToVnp(booking.totalAmount),
      vnp_ReturnUrl: returnUrl,
      vnp_IpAddr: getClientIp(req),
      vnp_CreateDate: formatVnpDate(now),
      vnp_ExpireDate: formatVnpDate(expiresAt),
    };

    const paymentUrl = buildVnpayUrl(params, { vnpUrl, secret });
    return res.json({ success: true, data: { paymentUrl } });
  } catch (error) {
    return next(error);
  }
}

// GET /api/payments/vnpay-ipn — VNPay gọi server-to-server (KHÔNG auth)
// Luôn trả HTTP 200 kèm { RspCode, Message }.
async function vnpayIpn(req, res) {
  try {
    const secret = process.env.VNP_HASHSECRET;
    const query = { ...req.query };

    if (!verifyVnpaySignature(query, secret)) {
      return res.status(200).json({ RspCode: '97', Message: 'Invalid signature' });
    }

    const txnRef = String(query.vnp_TxnRef || '');
    const responseCode = String(query.vnp_ResponseCode || '');
    const transactionStatus = String(query.vnp_TransactionStatus || '');
    const vnpAmount = String(query.vnp_Amount || '');

    const payment = await prisma.payment.findUnique({
      where: { transactionId: txnRef },
      include: {
        booking: {
          include: {
            reservation: {
              include: {
                ticketProduct: {
                  include: { attraction: { select: { requiresManualApproval: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!payment || !payment.booking) {
      return res.status(200).json({ RspCode: '01', Message: 'Order not found' });
    }

    const booking = payment.booking;
    if (vnpAmount !== String(amountToVnp(booking.totalAmount))) {
      return res.status(200).json({ RspCode: '04', Message: 'Invalid amount' });
    }

    const needsApproval =
      booking.reservation.ticketProduct.attraction.requiresManualApproval === true;
    const isSuccess = responseCode === '00' && transactionStatus === '00';

    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.booking.findUnique({
          where: { id: booking.id },
          include: { payments: true, reservation: true },
        });

        // Idempotency theo Payment SUCCESS (KHÔNG theo Booking.status).
        if (current.payments.some((p) => p.status === 'SUCCESS')) {
          return { code: '02', msg: 'Order already confirmed' };
        }

        const reservation = current.reservation;

        if (isSuccess) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'SUCCESS', rawResponse: query },
          });

          // Chỉ xác nhận khi đơn còn chờ thanh toán & vé còn giữ chỗ.
          // Guard current.status tránh "hồi sinh" đơn đã CANCELLED.
          if (current.status === 'PENDING_PAYMENT' && reservation.status === 'HELD') {
            await confirmReservationAndStock(tx, reservation);
            if (needsApproval) {
              await tx.booking.update({
                where: { id: current.id },
                data: { status: 'PENDING_PARTNER' },
              });
            } else {
              await tx.booking.update({
                where: { id: current.id },
                data: { status: 'CONFIRMED' },
              });
              await createTicketInstances(
                tx,
                current.id,
                reservation.ticketProductId,
                reservation.quantity,
              );
            }
          } else {
            // Đã thu tiền nhưng vé đã bị thu hồi/đơn đã hủy -> cần hoàn tiền thủ công.
            await tx.booking.update({
              where: { id: current.id },
              data: { status: 'CANCELLED', refundRequired: true },
            });
          }
        } else {
          // Thất bại: chỉ đánh dấu Payment FAILED, GIỮ Booking PENDING_PAYMENT
          // để khách thử lại (createVNPayUrl). Worker sẽ dọn nếu khách bỏ luôn.
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED', rawResponse: query },
          });
        }

        return { code: '00', msg: 'Confirm success' };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return res.status(200).json({ RspCode: result.code, Message: result.msg });
  } catch (error) {
    // Serialization failure / lỗi bất ngờ -> trả mã != 00 để VNPay gọi lại.
    return res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
  }
}

// GET /api/payments/vnpay-return — VNPay redirect trình duyệt khách về.
// CHỈ verify chữ ký rồi redirect sang FE; KHÔNG ghi DB (IPN lo việc đó).
async function vnpayReturn(req, res, next) {
  try {
    const secret = process.env.VNP_HASHSECRET;
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    const query = { ...req.query };

    const valid = verifyVnpaySignature(query, secret);
    const txnRef = String(query.vnp_TxnRef || '');
    const responseCode = String(query.vnp_ResponseCode || '');

    let bookingId = '';
    if (valid && txnRef) {
      const payment = await prisma.payment.findUnique({
        where: { transactionId: txnRef },
        select: { bookingId: true },
      });
      bookingId = payment?.bookingId || '';
    }

    const status = !valid ? 'invalid' : responseCode === '00' ? 'success' : 'failed';
    const url =
      `${frontend}/booking-success?bookingId=${encodeURIComponent(bookingId)}` +
      `&status=${status}&vnp_ResponseCode=${encodeURIComponent(responseCode)}`;
    return res.redirect(url);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createVNPayUrl,
  vnpayIpn,
  vnpayReturn,
};
