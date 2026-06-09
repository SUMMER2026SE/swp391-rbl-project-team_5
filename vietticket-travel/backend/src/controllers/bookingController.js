const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');

const { Decimal } = Prisma;
const PAYMENT_METHODS = new Set(['vnpay', 'card', 'onsite']);

const reservationInclude = {
  user: { include: { profile: true } },
  timeSlot: true,
  booking: { select: { id: true } },
  ticketProduct: {
    include: {
      attraction: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  },
};

const bookingInclude = {
  voucher: true,
  payments: { orderBy: { createdAt: 'desc' } },
  ticketInstances: true,
  reservation: {
    include: {
      timeSlot: true,
      ticketProduct: {
        include: {
          attraction: {
            include: {
              images: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
      },
    },
  },
};

function normalizeVoucherCode(value) {
  return String(value || '').trim().toUpperCase();
}

function decimalToNumber(value) {
  return value == null ? 0 : Number(value.toString());
}

function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function getAttractionLocation(attraction) {
  return [attraction.address, attraction.district, attraction.city]
    .filter(Boolean)
    .join(', ');
}

function toReservationResponse(reservation) {
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const subtotalAmount = product.sellingPrice.mul(reservation.quantity);

  return {
    id: reservation.id,
    reservationId: reservation.id,
    bookingId: reservation.booking?.id || null,
    ticketProductId: product.id,
    attractionId: attraction.id,
    attractionTitle: attraction.title,
    attractionLocation: getAttractionLocation(attraction),
    attractionImage: attraction.images[0]?.imageUrl || '',
    ticketName: product.name,
    visitDate: dateOnly(reservation.date),
    timeSlotId: reservation.timeSlotId,
    timeSlotLabel: reservation.timeSlot
      ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
      : 'Theo ngày đã chọn',
    quantity: reservation.quantity,
    unitPrice: decimalToNumber(product.sellingPrice),
    subtotalAmount: decimalToNumber(subtotalAmount),
    discountAmount: 0,
    totalAmount: decimalToNumber(subtotalAmount),
    status: reservation.status.toLowerCase(),
    customer: {
      fullName: reservation.user.fullName,
      email: reservation.user.email,
      phone: reservation.user.profile?.phoneNumber || '',
    },
    expiresAt: reservation.expiresAt,
    createdAt: reservation.createdAt,
  };
}

function toBookingResponse(booking) {
  const reservation = booking.reservation;
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const latestPayment = booking.payments[0] || null;

  return {
    id: booking.id,
    bookingId: booking.id,
    reservationId: reservation.id,
    ticketProductId: product.id,
    attractionId: attraction.id,
    attractionTitle: attraction.title,
    attractionLocation: getAttractionLocation(attraction),
    attractionImage: attraction.images[0]?.imageUrl || '',
    ticketName: product.name,
    visitDate: dateOnly(reservation.date),
    timeSlotId: reservation.timeSlotId,
    timeSlotLabel: reservation.timeSlot
      ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
      : 'Theo ngày đã chọn',
    quantity: reservation.quantity,
    unitPrice: decimalToNumber(product.sellingPrice),
    subtotalAmount: decimalToNumber(booking.subtotalAmount),
    subtotal: decimalToNumber(booking.subtotalAmount),
    discountAmount: decimalToNumber(booking.discountAmount),
    totalAmount: decimalToNumber(booking.totalAmount),
    voucherCode: booking.voucher?.code || '',
    voucherLabel: booking.voucher
      ? booking.voucher.discountType === 'FIXED'
        ? `Giảm ${decimalToNumber(booking.voucher.discountValue).toLocaleString('vi-VN')} VND`
        : `Giảm ${decimalToNumber(booking.voucher.discountValue)}%`
      : '',
    customer: {
      fullName: booking.fullName,
      email: booking.email,
      phone: booking.phone || '',
    },
    note: booking.note || '',
    status: booking.status.toLowerCase().replace('pending_payment', 'unpaid'),
    paymentStatus: latestPayment?.status.toLowerCase() || 'pending',
    paymentMethod: booking.paymentMethod || '',
    expiresAt: reservation.expiresAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    ticketInstances: booking.ticketInstances.map((ticket) => ({
      id: ticket.id,
      qrCodeToken: ticket.qrCodeToken,
      status: ticket.status.toLowerCase(),
    })),
  };
}

function validateVoucher(voucher, subtotalAmount, now = new Date()) {
  if (!voucher || !voucher.isActive || voucher.expiryDate <= now) {
    const error = new Error('Mã ưu đãi không hợp lệ hoặc đã hết hạn.');
    error.statusCode = 400;
    throw error;
  }

  if (voucher.usageLimit != null && voucher.usedCount >= voucher.usageLimit) {
    const error = new Error('Mã ưu đãi đã hết lượt sử dụng.');
    error.statusCode = 400;
    throw error;
  }

  if (voucher.minSpend && subtotalAmount.lessThan(voucher.minSpend)) {
    const minimum = decimalToNumber(voucher.minSpend).toLocaleString('vi-VN');
    const error = new Error(`Đơn hàng cần tối thiểu ${minimum} VND để dùng mã này.`);
    error.statusCode = 400;
    throw error;
  }
}

function calculateDiscount(voucher, subtotalAmount) {
  let discountAmount;

  if (voucher.discountType === 'FIXED') {
    discountAmount = new Decimal(voucher.discountValue);
  } else {
    discountAmount = subtotalAmount
      .mul(voucher.discountValue)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    if (voucher.maxDiscount && discountAmount.greaterThan(voucher.maxDiscount)) {
      discountAmount = new Decimal(voucher.maxDiscount);
    }
  }

  return Decimal.min(discountAmount, subtotalAmount);
}

async function findVoucher(client, voucherCode, subtotalAmount, now) {
  const code = normalizeVoucherCode(voucherCode);
  if (!code) return { voucher: null, discountAmount: new Decimal(0) };

  const voucher = await client.voucher.findUnique({ where: { code } });
  validateVoucher(voucher, subtotalAmount, now);

  return {
    voucher,
    discountAmount: calculateDiscount(voucher, subtotalAmount),
  };
}

async function confirmReservationAndStock(tx, reservation) {
  if (reservation.status === 'CONFIRMED') return;

  const dailyStock = await tx.dailyStock.updateMany({
    where: {
      ticketProductId: reservation.ticketProductId,
      date: reservation.date,
      heldQuantity: { gte: reservation.quantity },
    },
    data: {
      heldQuantity: { decrement: reservation.quantity },
      bookedQuantity: { increment: reservation.quantity },
    },
  });
  if (dailyStock.count !== 1) {
    const error = new Error('Số lượng vé giữ chỗ không còn hợp lệ.');
    error.statusCode = 409;
    throw error;
  }

  if (reservation.timeSlotId) {
    const timeSlotStock = await tx.timeSlotStock.updateMany({
      where: {
        timeSlotId: reservation.timeSlotId,
        date: reservation.date,
        heldQty: { gte: reservation.quantity },
      },
      data: {
        heldQty: { decrement: reservation.quantity },
        bookedQty: { increment: reservation.quantity },
      },
    });
    if (timeSlotStock.count !== 1) {
      const error = new Error('Số lượng vé trong khung giờ không còn hợp lệ.');
      error.statusCode = 409;
      throw error;
    }
  }

  await tx.reservation.update({
    where: { id: reservation.id },
    data: { status: 'CONFIRMED' },
  });
}

async function createTicketInstances(tx, bookingId, ticketProductId, quantity) {
  await tx.ticketInstance.createMany({
    data: Array.from({ length: quantity }, () => ({
      bookingId,
      ticketProductId,
      qrCodeToken: randomUUID(),
    })),
  });
}

async function getReservation(req, res, next) {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: req.params.reservationId },
      include: reservationInclude,
    });

    if (!reservation || reservation.userId !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy đơn giữ chỗ.' });
    }

    return res.json({ success: true, data: toReservationResponse(reservation) });
  } catch (error) {
    return next(error);
  }
}

async function listBookings(req, res, next) {
  try {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.user.id },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      success: true,
      data: bookings.map(toBookingResponse),
    });
  } catch (error) {
    return next(error);
  }
}

async function getBooking(req, res, next) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: bookingInclude,
    });

    if (!booking || booking.userId !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé.' });
    }

    return res.json({ success: true, data: toBookingResponse(booking) });
  } catch (error) {
    return next(error);
  }
}

async function validateAndApplyVoucher(req, res, next) {
  try {
    const voucherCode = normalizeVoucherCode(req.body?.voucherCode);
    const subtotalRaw = req.body?.subtotalAmount;

    if (!voucherCode) {
      return res.status(400).json({ message: 'Vui lòng nhập mã ưu đãi.' });
    }

    let subtotalAmount;
    try {
      subtotalAmount = new Decimal(subtotalRaw);
    } catch {
      return res.status(400).json({ message: 'Tạm tính không hợp lệ.' });
    }

    if (!subtotalAmount.isPositive()) {
      return res.status(400).json({ message: 'Tạm tính phải lớn hơn 0.' });
    }

    const { voucher, discountAmount } = await findVoucher(
      prisma,
      voucherCode,
      subtotalAmount,
      new Date(),
    );

    return res.json({
      success: true,
      message: `Áp dụng ${voucher.code} thành công.`,
      data: {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          discountType: voucher.discountType,
          discountValue: decimalToNumber(voucher.discountValue),
          maxDiscount: voucher.maxDiscount
            ? decimalToNumber(voucher.maxDiscount)
            : null,
          minSpend: voucher.minSpend ? decimalToNumber(voucher.minSpend) : null,
          expiryDate: voucher.expiryDate,
        },
        discountAmount: decimalToNumber(discountAmount),
        totalAmount: decimalToNumber(subtotalAmount.minus(discountAmount)),
      },
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
}

async function createBooking(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Bạn cần đăng nhập để đặt vé.' });
    }

    const reservationId = String(req.body?.reservationId || '').trim();
    const fullName = String(req.body?.fullName || req.user.fullName || '').trim();
    const email = String(req.body?.email || req.user.email || '').trim();
    const phone = String(
      req.body?.phone || req.user.profile?.phoneNumber || '',
    ).trim();
    const note = String(req.body?.note || '').trim();
    const voucherCode = normalizeVoucherCode(req.body?.voucherCode);
    const paymentMethod = String(req.body?.paymentMethod || 'vnpay').toLowerCase();

    if (!reservationId) {
      return res.status(400).json({ message: 'reservationId là bắt buộc.' });
    }
    if (!fullName || !email) {
      return res.status(400).json({ message: 'Họ tên và email là bắt buộc.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return res.status(400).json({ message: 'Phương thức thanh toán không hợp lệ.' });
    }

    const booking = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
          include: { ticketProduct: true },
        });

        if (!reservation || reservation.userId !== userId) {
          const error = new Error('Không tìm thấy đơn giữ chỗ.');
          error.statusCode = 404;
          throw error;
        }
        if (reservation.status !== 'HELD') {
          const error = new Error('Đơn giữ chỗ không còn ở trạng thái chờ thanh toán.');
          error.statusCode = 409;
          throw error;
        }
        if (reservation.expiresAt <= now) {
          const error = new Error('Đơn giữ chỗ đã hết hạn.');
          error.statusCode = 409;
          throw error;
        }

        const existingBooking = await tx.booking.findUnique({
          where: { reservationId },
        });
        if (existingBooking) {
          const error = new Error('Đơn giữ chỗ này đã được tạo booking.');
          error.statusCode = 409;
          throw error;
        }

        const subtotalAmount = reservation.ticketProduct.sellingPrice.mul(
          reservation.quantity,
        );
        const { voucher, discountAmount } = await findVoucher(
          tx,
          voucherCode,
          subtotalAmount,
          now,
        );
        const totalAmount = subtotalAmount.minus(discountAmount);

        if (voucher) {
          const usageWhere =
            voucher.usageLimit == null
              ? { id: voucher.id, isActive: true, expiryDate: { gt: now } }
              : {
                  id: voucher.id,
                  isActive: true,
                  expiryDate: { gt: now },
                  usedCount: { lt: voucher.usageLimit },
                };
          const claimed = await tx.voucher.updateMany({
            where: usageWhere,
            data: { usedCount: { increment: 1 } },
          });

          if (claimed.count !== 1) {
            const error = new Error('Mã ưu đãi vừa hết lượt sử dụng.');
            error.statusCode = 409;
            throw error;
          }
        }

        const created = await tx.booking.create({
          data: {
            userId,
            reservationId,
            voucherId: voucher?.id || null,
            subtotalAmount,
            discountAmount,
            totalAmount,
            status: paymentMethod === 'onsite' ? 'CONFIRMED' : 'PENDING_PAYMENT',
            paymentMethod,
            fullName,
            email,
            phone: phone || null,
            note: note || null,
            payments: {
              create: {
                amount: totalAmount,
                paymentGateway: paymentMethod.toUpperCase(),
                status: 'PENDING',
              },
            },
          },
        });

        if (paymentMethod === 'onsite') {
          await confirmReservationAndStock(tx, reservation);
          await createTicketInstances(
            tx,
            created.id,
            reservation.ticketProductId,
            reservation.quantity,
          );
        }

        return tx.booking.findUnique({
          where: { id: created.id },
          include: bookingInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return res.status(201).json({
      success: true,
      message: 'Tạo đơn đặt vé thành công.',
      data: toBookingResponse(booking),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Đơn giữ chỗ này đã được tạo booking.' });
    }
    return next(error);
  }
}

async function updatePaymentStatus(req, res, next) {
  try {
    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!['SUCCESS', 'FAILED'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái thanh toán không hợp lệ.' });
    }

    const booking = await prisma.$transaction(
      async (tx) => {
        const current = await tx.booking.findUnique({
          where: { id: req.params.bookingId },
          include: {
            reservation: true,
            payments: { orderBy: { createdAt: 'desc' }, take: 1 },
            ticketInstances: { select: { id: true } },
          },
        });

        if (!current || current.userId !== req.user.id) {
          const error = new Error('Không tìm thấy đơn đặt vé.');
          error.statusCode = 404;
          throw error;
        }
        if (status === 'FAILED' && current.status === 'CONFIRMED') {
          const error = new Error('Không thể đánh dấu thất bại cho booking đã xác nhận.');
          error.statusCode = 409;
          throw error;
        }

        const paymentData = {
          status,
          transactionId: req.body?.transactionId || undefined,
          rawResponse: req.body?.rawResponse || undefined,
        };
        const payment = current.payments[0];

        if (payment) {
          await tx.payment.update({
            where: { id: payment.id },
            data: paymentData,
          });
        } else {
          await tx.payment.create({
            data: {
              bookingId: current.id,
              amount: current.totalAmount,
              paymentGateway: (current.paymentMethod || 'VNPAY').toUpperCase(),
              ...paymentData,
            },
          });
        }

        if (status === 'SUCCESS' && current.status !== 'CONFIRMED') {
          if (
            current.reservation.status !== 'HELD' ||
            current.reservation.expiresAt <= new Date()
          ) {
            const error = new Error('Đơn giữ chỗ đã hết hạn hoặc không còn hợp lệ.');
            error.statusCode = 409;
            throw error;
          }

          await confirmReservationAndStock(tx, current.reservation);
          await tx.booking.update({
            where: { id: current.id },
            data: { status: 'CONFIRMED' },
          });

          if (current.ticketInstances.length === 0) {
            await createTicketInstances(
              tx,
              current.id,
              current.reservation.ticketProductId,
              current.reservation.quantity,
            );
          }
        }

        return tx.booking.findUnique({
          where: { id: current.id },
          include: bookingInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return res.json({
      success: true,
      message:
        status === 'SUCCESS'
          ? 'Thanh toán đã được xác nhận.'
          : 'Thanh toán chưa thành công.',
      data: toBookingResponse(booking),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  createBooking,
  getBooking,
  getReservation,
  listBookings,
  updatePaymentStatus,
  validateAndApplyVoucher,
};
