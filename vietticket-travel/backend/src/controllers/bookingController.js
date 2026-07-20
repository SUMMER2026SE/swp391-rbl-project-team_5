const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { isTicketProductSaleEnabled } = require('../services/catalogVisibilityService');
const { MAX_TICKETS_PER_ORDER } = require('../config/bookingPolicy');
const { formatLocation } = require('../utils/location');
const {
  MIN_VNPAY_AMOUNT,
  parseVndInteger,
} = require('../utils/money');


const { Decimal } = Prisma;
const PAYMENT_METHODS = new Set(['vnpay']);

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
  review: true,
  voucher: true,
  payments: { orderBy: { createdAt: 'desc' } },
  refundRequests: { orderBy: { createdAt: 'desc' } },
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

function selectBookingPayment(payments = []) {
  // A customer can open several VNPay attempts before one callback arrives.
  // The most recently created attempt may still be PENDING even though an
  // older, canonical attempt already paid the booking. Duplicate captures are
  // refund-only records and must not become the booking's payment state.
  const successfulPayment = payments.find(
    (payment) => payment?.status === 'SUCCESS' && !payment.isDuplicate,
  );
  if (successfulPayment) return successfulPayment;

  const latestCanonicalAttempt = payments.find((payment) => !payment?.isDuplicate);
  return latestCanonicalAttempt || null;
}

function resolveBookingPaymentStatus(payments = []) {
  return selectBookingPayment(payments)?.status || 'PENDING';
}

function getAttractionLocation(attraction) {
  return formatLocation(attraction);
}

function getTimeSlotLabel(timeSlot) {
  return timeSlot
    ? `${timeSlot.startTime} - ${timeSlot.endTime}`
    : 'Theo ngày đã chọn';
}

function buildBookingSnapshot(reservation, snapshotAt = new Date()) {
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const primaryImage = attraction.images?.[0]?.imageUrl || null;

  return {
    snapshotAt,
    snapshotAttractionId: attraction.id,
    snapshotAttractionTitle: attraction.title,
    snapshotAttractionAddress: attraction.address || '',
    snapshotAttractionCity: attraction.city || '',
    snapshotAttractionDistrict: attraction.district || null,
    snapshotAttractionImage: primaryImage,
    snapshotTicketName: product.name,
    snapshotTicketType: product.type || 'ADULT',
    snapshotTicketDescription: product.description || null,
    snapshotUnitPrice: reservation.snapshotUnitPrice ?? product.sellingPrice,
    snapshotRefundPolicy:
      reservation.snapshotRefundPolicy ?? product.refundPolicy ?? 'NON_REFUNDABLE',
    snapshotRefundFeeRate:
      reservation.snapshotRefundFeeRate ?? product.refundFeeRate ?? 0,
    snapshotRefundCutoffHours:
      reservation.snapshotRefundCutoffHours ?? product.refundCutoffHours ?? 24,
    snapshotVisitDate: reservation.date,
    snapshotTimeSlotLabel: reservation.timeSlot
      ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
      : null,
  };
}

function getBookingSnapshotView(booking) {
  const reservation = booking.reservation;
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const hasSnapshot =
    Boolean(booking.snapshotAttractionTitle) ||
    Boolean(booking.snapshotTicketName) ||
    booking.snapshotVisitDate != null ||
    booking.snapshotUnitPrice != null;

  if (!hasSnapshot) {
    return {
      attractionId: attraction.id,
      attractionTitle: attraction.title,
      attractionLocation: getAttractionLocation(attraction),
      attractionImage: attraction.images?.[0]?.imageUrl || '',
      ticketName: product.name,
      visitDate: reservation.date,
      timeSlotLabel: getTimeSlotLabel(reservation.timeSlot),
      unitPrice: product.sellingPrice,
      refundPolicy: product.refundPolicy,
      refundFeeRate: product.refundFeeRate,
      refundCutoffHours: product.refundCutoffHours ?? 24,
    };
  }

  return {
    attractionId: booking.snapshotAttractionId || attraction.id,
    attractionTitle: booking.snapshotAttractionTitle || attraction.title,
    attractionLocation: formatLocation({
      address: booking.snapshotAttractionAddress || attraction.address,
      district: booking.snapshotAttractionDistrict || attraction.district,
      city: booking.snapshotAttractionCity || attraction.city,
    }),
    attractionImage: booking.snapshotAttractionImage || attraction.images?.[0]?.imageUrl || '',
    ticketName: booking.snapshotTicketName || product.name,
    visitDate: booking.snapshotVisitDate || reservation.date,
    timeSlotLabel: booking.snapshotTimeSlotLabel || getTimeSlotLabel(reservation.timeSlot),
    unitPrice: booking.snapshotUnitPrice,
    refundPolicy: booking.snapshotRefundPolicy || product.refundPolicy,
    refundFeeRate: booking.snapshotRefundFeeRate ?? product.refundFeeRate,
    refundCutoffHours:
      booking.snapshotRefundCutoffHours ?? product.refundCutoffHours ?? 24,
  };
}

function toReservationResponse(reservation) {
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const unitPrice = new Decimal(
    reservation.snapshotUnitPrice ?? product.sellingPrice,
  );
  const subtotalAmount = unitPrice.mul(reservation.quantity);

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
    timeSlotLabel: getTimeSlotLabel(reservation.timeSlot),
    quantity: reservation.quantity,
    unitPrice: decimalToNumber(unitPrice),
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
  const snapshot = getBookingSnapshotView(booking);
  const paymentStatus = resolveBookingPaymentStatus(booking.payments);

  return {
    id: booking.id,
    bookingId: booking.id,
    reservationId: reservation.id,
    ticketProductId: product.id,
    attractionId: snapshot.attractionId,
    attractionTitle: snapshot.attractionTitle,
    attractionLocation: snapshot.attractionLocation,
    attractionImage: snapshot.attractionImage,
    ticketName: snapshot.ticketName,
    visitDate: dateOnly(snapshot.visitDate),
    timeSlotId: reservation.timeSlotId,
    timeSlotLabel: snapshot.timeSlotLabel,
    quantity: reservation.quantity,
    unitPrice: decimalToNumber(snapshot.unitPrice),
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
    paymentStatus: paymentStatus.toLowerCase(),
    paymentMethod: booking.paymentMethod || '',
    refundPolicy: snapshot.refundPolicy,
    refundFeeRate: decimalToNumber(snapshot.refundFeeRate),
    refundCutoffHours: Number(snapshot.refundCutoffHours ?? 24),
    expiresAt: reservation.expiresAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    reviewed: !!booking.review,
    rating: booking.review?.rating || 0,
    // Yêu cầu hoàn tiền gần nhất; một booking có thể có thêm yêu cầu riêng
    // cho từng giao dịch thanh toán trùng.
    refundRequest: booking.refundRequests?.[0]
      ? {
          id: booking.refundRequests[0].id,
          type: booking.refundRequests[0].type,
          mandatory: booking.refundRequests[0].mandatory,
          status: booking.refundRequests[0].status,
          amount: decimalToNumber(booking.refundRequests[0].amount),
          reason: booking.refundRequests[0].reason,
          staffNotes: booking.refundRequests[0].staffNotes || '',
          createdAt: booking.refundRequests[0].createdAt,
          processedAt: booking.refundRequests[0].processedAt,
        }
      : null,
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

  const discountValue = Number(voucher.discountValue);
  if (
    voucher.discountType === 'FIXED'
    && parseVndInteger(discountValue) === null
  ) {
    const error = new Error('Giá trị giảm cố định phải là số nguyên VND hợp lệ.');
    error.statusCode = 400;
    throw error;
  }
  if (
    voucher.discountType === 'PERCENTAGE'
    && (
      !Number.isFinite(discountValue)
      || discountValue <= 0
      || discountValue > 100
    )
  ) {
    const error = new Error('Phần trăm ưu đãi phải lớn hơn 0 và không vượt quá 100.');
    error.statusCode = 400;
    throw error;
  }
  if (!['FIXED', 'PERCENTAGE'].includes(voucher.discountType)) {
    const error = new Error('Loại mã ưu đãi không hợp lệ.');
    error.statusCode = 400;
    throw error;
  }
  if (
    voucher.maxDiscount != null
    && parseVndInteger(voucher.maxDiscount) === null
  ) {
    const error = new Error('Mức giảm tối đa phải là số nguyên VND hợp lệ.');
    error.statusCode = 400;
    throw error;
  }
  if (
    voucher.minSpend != null
    && parseVndInteger(voucher.minSpend, { allowZero: true }) === null
  ) {
    const error = new Error('Mức chi tiêu tối thiểu phải là số nguyên VND hợp lệ.');
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
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

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

  const attractionId = reservation.ticketProduct?.attractionId
    || (await tx.ticketProduct.findUnique({
      where: { id: reservation.ticketProductId },
      select: { attractionId: true },
    }))?.attractionId;
  if (!attractionId) {
    const error = new Error('Không xác định được kho của điểm tham quan.');
    error.statusCode = 409;
    throw error;
  }

  const attractionStock = await tx.attractionDailyStock.updateMany({
    where: {
      attractionId,
      date: reservation.date,
      heldQty: { gte: reservation.quantity },
    },
    data: {
      heldQty: { decrement: reservation.quantity },
      bookedQty: { increment: reservation.quantity },
    },
  });
  if (attractionStock.count !== 1) {
    const error = new Error('Số lượng giữ chỗ của điểm tham quan không còn hợp lệ.');
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

    const parsedSubtotal = parseVndInteger(subtotalRaw);
    if (parsedSubtotal === null) {
      return res.status(400).json({
        message: 'Tạm tính phải là số nguyên VND hợp lệ lớn hơn 0.',
      });
    }
    const subtotalAmount = new Decimal(parsedSubtotal);

    const { voucher, discountAmount } = await findVoucher(
      prisma,
      voucherCode,
      subtotalAmount,
      new Date(),
    );
    const totalAmount = subtotalAmount.minus(discountAmount);
    const parsedTotal = parseVndInteger(totalAmount);
    if (parsedTotal === null) {
      return res.status(400).json({ message: 'Tổng tiền sau ưu đãi phải lớn hơn 0.' });
    }
    if (parsedTotal < MIN_VNPAY_AMOUNT) {
      return res.status(400).json({
        message: `Tổng tiền thanh toán VNPay tối thiểu là ${MIN_VNPAY_AMOUNT.toLocaleString('vi-VN')} VND.`,
      });
    }

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
        totalAmount: decimalToNumber(totalAmount),
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
          include: {
            timeSlot: true,
            ticketProduct: {
              include: {
                attraction: {
                  include: {
                    partner: { select: { commissionRate: true, status: true } },
                    images: {
                      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                      take: 1,
                    },
                  },
                },
              },
            },
          },
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
        if (!isTicketProductSaleEnabled(reservation.ticketProduct)) {
          const error = new Error('Gói vé đã tạm dừng bán và không thể tạo đơn mới.');
          error.statusCode = 409;
          throw error;
        }
        if (
          !Number.isSafeInteger(reservation.quantity)
          || reservation.quantity < 1
          || reservation.quantity > MAX_TICKETS_PER_ORDER
        ) {
          const error = new Error(
            `Số lượng vé mỗi đơn phải từ 1 đến ${MAX_TICKETS_PER_ORDER}.`,
          );
          error.statusCode = 400;
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

        const unitPrice = parseVndInteger(
          reservation.snapshotUnitPrice ?? reservation.ticketProduct.sellingPrice,
        );
        if (unitPrice === null) {
          const error = new Error('Giá bán phải là số nguyên VND hợp lệ.');
          error.statusCode = 400;
          throw error;
        }
        const subtotalAmount = new Decimal(unitPrice).mul(reservation.quantity);
        if (parseVndInteger(subtotalAmount) === null) {
          const error = new Error('Tạm tính đơn hàng vượt giới hạn tiền tệ cho phép.');
          error.statusCode = 400;
          throw error;
        }
        const { voucher, discountAmount } = await findVoucher(
          tx,
          voucherCode,
          subtotalAmount,
          now,
        );
        const totalAmount = subtotalAmount.minus(discountAmount);
        const parsedTotal = parseVndInteger(totalAmount);
        if (parsedTotal === null) {
          const error = new Error('Tổng tiền sau ưu đãi phải lớn hơn 0.');
          error.statusCode = 400;
          throw error;
        }
        if (parsedTotal < MIN_VNPAY_AMOUNT) {
          const error = new Error(
            `Tổng tiền thanh toán VNPay tối thiểu là ${MIN_VNPAY_AMOUNT.toLocaleString('vi-VN')} VND.`,
          );
          error.statusCode = 400;
          throw error;
        }
        const rawCommissionRate = Number(
          reservation.snapshotCommissionRate
            ?? reservation.ticketProduct.attraction.partner?.commissionRate
            ?? 0.10,
        );
        const commissionRate = Number.isFinite(rawCommissionRate)
          ? Math.min(Math.max(rawCommissionRate, 0), 1)
          : 0.10;
        const commissionAmount = totalAmount
          .mul(commissionRate)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        const partnerNetAmount = totalAmount.minus(commissionAmount);

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
            status: 'PENDING_PAYMENT',
            paymentMethod,
            fullName,
            email,
            phone: phone || null,
            note: note || null,
            commissionRateSnapshot: commissionRate,
            commissionAmountSnapshot: commissionAmount,
            partnerNetAmountSnapshot: partnerNetAmount,
            ...buildBookingSnapshot(reservation, now),
          },
        });

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

module.exports = {
  createBooking,
  getBooking,
  getReservation,
  listBookings,
  validateAndApplyVoucher,
  // Helper dùng chung cho luồng thanh toán VNPay (L2) & duyệt vé đối tác (N2)
  confirmReservationAndStock,
  createTicketInstances,
  buildBookingSnapshot,
  getBookingSnapshotView,
  resolveBookingPaymentStatus,
  selectBookingPayment,
};
