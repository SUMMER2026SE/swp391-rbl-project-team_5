const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { isTicketProductSaleEnabled } = require('../services/catalogVisibilityService');
const {
  CUSTOMER_BOOKING_CHANGE_POLICY,
  MAX_TICKETS_PER_ORDER,
  getManualApprovalMinLeadMs,
} = require('../config/bookingPolicy');
const { formatLocation } = require('../utils/location');
const {
  MIN_VNPAY_AMOUNT,
  parseVndInteger,
} = require('../utils/money');
const { buildTicketRestrictions } = require('../utils/ticketRestrictions');
const {
  getInventoryUnits,
  getSnapshotAdmissionCount,
} = require('../utils/ticketCapacity');

const { Decimal } = Prisma;
const {
  BANK_TRANSFER_METHOD,
  getBankTransferHoldMs,
} = require('../utils/bankTransferPolicy');
const { getBankTransferConfig } = require('../config/runtimeConfig');
const { isCapturedPayment } = require('../utils/paymentGateway');
const {
  MANUAL_APPROVAL_TIMEOUT_MS,
  getBookingActivityWindow,
  getManualApprovalDeadline,
} = require('../utils/activityTime');
const {
  calculateBookingFinancials,
  normalizeVoucherFunding,
} = require('../services/bookingFinancialService');
const { queueNewBookingNotification } = require('../realtime/events');
const {
  PARTNER_APPROVAL_REQUESTED_TOPIC,
  enqueueBookingNotification,
} = require('../services/bookingNotificationService');
const {
  claimVoucherRedemption,
  countActiveVoucherUses,
} = require('../services/voucherRedemptionService');
const {
  normalizeTravelerManifest,
} = require('../services/travelerManifestService');
const { normalizeInvoiceDetails } = require('../services/invoiceDetailsService');

// Chỉ mở phương thức chuyển khoản khi nền tảng đã cấu hình tài khoản nhận tiền,
// tránh việc khách chọn được rồi lại không có mã QR để chuyển.
function getAllowedPaymentMethods() {
  const methods = new Set(['vnpay']);
  if (getBankTransferConfig().configured) methods.add(BANK_TRANSFER_METHOD);
  return methods;
}

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
  refundRequestsTargeting: { orderBy: { createdAt: 'desc' } },
  // Thứ tự cố định để "Vé #1, #2..." trên vé của khách không đổi sau mỗi lần
  // check-in và khớp đúng với danh sách vé bên cổng soát vé của nhân viên.
  ticketInstances: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
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

function voucherContextOf(reservation) {
  const product = reservation?.ticketProduct;
  const attraction = product?.attraction;
  return {
    partnerId: attraction?.partnerId || attraction?.partner?.id || null,
    attractionId: attraction?.id || product?.attractionId || null,
    ticketProductId: product?.id || reservation?.ticketProductId || null,
  };
}

function normalizeItineraryContext(value) {
  if (value == null) return null;
  const itineraryId = String(value.itineraryId || '').trim();
  const itemId = String(value.itemId || '').trim();
  const version = Number(value.version);
  if (
    !itineraryId
    || itineraryId.length > 100
    || !itemId
    || itemId.length > 300
    || !Number.isSafeInteger(version)
    || version < 1
  ) {
    const error = new Error('Ngữ cảnh lịch trình đặt vé không hợp lệ.');
    error.statusCode = 400;
    throw error;
  }
  return { itineraryId, itemId, version };
}

function normalizeItineraryQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
}

function buildItineraryItemId({ attractionId, ticketId, visitDate, slotId, index }) {
  return [attractionId, ticketId, visitDate || 'date', slotId || 'slot', index]
    .map((part) => String(part).replace(/[^A-Za-z0-9_-]+/g, '-'))
    .join('__');
}

function extractItineraryTicketItems(itinerary) {
  const plan = itinerary?.data || itinerary || {};
  const days = Array.isArray(plan.days) ? plan.days : [];
  const items = [];

  days.forEach((day, dayIndex) => {
    const activities = Array.isArray(day?.activities)
      ? day.activities
      : Array.isArray(day?.items) ? day.items : [];
    const dayVisitDate = day?.visitDate || plan.startDate || '';

    activities.forEach((activity, activityIndex) => {
      const attractionId = activity?.attractionId || activity?.id;
      if (!attractionId) return;
      const visitDate = activity?.visitDate || dayVisitDate;
      const ticketItems = Array.isArray(activity?.ticketItems) ? activity.ticketItems : [];
      ticketItems.forEach((ticketItem, ticketIndex) => {
        if (!ticketItem?.ticketId) return;
        const slotId = ticketItem?.suggestedTimeSlot?.timeSlotId
          || ticketItem?.timeSlotId
          || '';
        const index = items.length;
        items.push({
          id: buildItineraryItemId({
            attractionId,
            ticketId: ticketItem.ticketId,
            visitDate,
            slotId,
            index,
          }),
          attractionId: String(attractionId),
          ticketId: String(ticketItem.ticketId),
          visitDate,
          timeSlotId: String(slotId),
          quantity: normalizeItineraryQuantity(ticketItem.quantity),
          dayIndex,
          activityIndex,
          ticketIndex,
        });
      });
    });
  });

  return items;
}

function itineraryItemMatchesReservation(item, reservation) {
  if (!item || !reservation) return false;
  const expectedTicketId = String(reservation.ticketProductId || '');
  const expectedAttractionId = String(reservation.ticketProduct?.attractionId || '');
  const expectedDate = dateOnly(reservation.date);
  const expectedSlotId = String(reservation.timeSlotId || '');

  return (
    item.ticketId === expectedTicketId
    && (!expectedAttractionId || item.attractionId === expectedAttractionId)
    && (!item.visitDate || dateOnly(item.visitDate) === expectedDate)
    && (!item.timeSlotId || item.timeSlotId === expectedSlotId)
    && item.quantity === Number(reservation.quantity)
  );
}

function itineraryContainsReservation(itinerary, reservation) {
  return extractItineraryTicketItems(itinerary).some(
    (item) => itineraryItemMatchesReservation(item, reservation),
  );
}

async function validateItineraryBookingContext(tx, {
  context,
  reservation,
  userId,
  now,
}) {
  if (!context) return null;

  const itinerary = await tx.savedItinerary.findFirst({
    where: { id: context.itineraryId, userId },
    include: {
      partyRoom: {
        select: {
          id: true,
          status: true,
          version: true,
          bookingStartedAt: true,
          bookingVersion: true,
        },
      },
    },
  });
  if (!itinerary) {
    const error = new Error('Không tìm thấy lịch trình thuộc tài khoản của bạn.');
    error.statusCode = 404;
    throw error;
  }
  const itineraryItem = extractItineraryTicketItems(itinerary).find(
    (item) => item.id === context.itemId,
  );
  if (!itineraryItem || !itineraryItemMatchesReservation(itineraryItem, reservation)) {
    const error = new Error(
      'Dòng vé đang giữ chỗ không khớp điểm tham quan, ngày đi, khung giờ hoặc số lượng trong lịch trình đã chốt.',
    );
    error.statusCode = 409;
    throw error;
  }

  const existingItemBooking = await tx.booking.findFirst({
    where: {
      itineraryId: itinerary.id,
      itineraryVersion: context.version,
      itineraryItemId: context.itemId,
      status: { notIn: ['CANCELLED', 'REFUNDED'] },
    },
    select: { id: true },
  });
  if (existingItemBooking) {
    const error = new Error('Dòng vé này đã có một đơn đang được xử lý.');
    error.statusCode = 409;
    throw error;
  }

  if (itinerary.partyRoom) {
    const room = itinerary.partyRoom;
    if (room.status !== 'FINALIZED' || room.version !== context.version) {
      const error = new Error('Lịch nhóm đã thay đổi. Vui lòng quay lại phòng và tạo lại danh sách đặt vé.');
      error.statusCode = 409;
      throw error;
    }
    if (room.bookingStartedAt && room.bookingVersion !== context.version) {
      const error = new Error('Phòng đã bắt đầu đặt vé từ một phiên bản lịch trình khác.');
      error.statusCode = 409;
      throw error;
    }
    if (!room.bookingStartedAt) {
      const locked = await tx.partyRoom.updateMany({
        where: {
          id: room.id,
          status: 'FINALIZED',
          version: context.version,
          bookingStartedAt: null,
        },
        data: {
          bookingStartedAt: now,
          bookingVersion: context.version,
        },
      });
      if (locked.count !== 1) {
        const error = new Error('Lịch nhóm vừa thay đổi. Vui lòng tải lại trước khi đặt vé.');
        error.statusCode = 409;
        throw error;
      }
    }
  }
  return itinerary;
}

function decimalToNumber(value) {
  return value == null ? 0 : Number(value.toString());
}

function dateOnly(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
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

function operationalList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
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
    snapshotAttractionLatitude: attraction.latitude ?? null,
    snapshotAttractionLongitude: attraction.longitude ?? null,
    snapshotAttractionEnvironment: attraction.environment || null,
    snapshotMeetingPoint: attraction.meetingPoint || null,
    snapshotCheckInInstructions: attraction.checkInInstructions || null,
    snapshotAccessibilityInfo: attraction.accessibilityInfo || null,
    snapshotWhatToBring: operationalList(attraction.whatToBring),
    snapshotPartnerId: attraction.partnerId || attraction.partner?.id || null,
    snapshotPartnerName: attraction.partner?.businessName || null,
    snapshotTicketName: product.name,
    snapshotTicketType: product.type || 'ADULT',
    snapshotAdmissionCount: getSnapshotAdmissionCount(reservation),
    snapshotTicketDescription: product.description || null,
    snapshotTicketRestrictions:
      reservation.snapshotTicketRestrictions ?? buildTicketRestrictions(product),
    snapshotInclusions: operationalList(product.inclusions),
    snapshotExclusions: operationalList(product.exclusions),
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
    snapshotActivityStartTime: attraction.openTime || null,
    snapshotActivityEndTime: attraction.closeTime || null,
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
      admissionCount: getSnapshotAdmissionCount(reservation),
      visitDate: reservation.date,
      timeSlotLabel: getTimeSlotLabel(reservation.timeSlot),
      unitPrice: product.sellingPrice,
      refundPolicy: product.refundPolicy,
      refundFeeRate: product.refundFeeRate,
      refundCutoffHours: product.refundCutoffHours ?? 24,
      operationalDetails: {
        meetingPoint: attraction.meetingPoint || '',
        checkInInstructions: attraction.checkInInstructions || '',
        accessibilityInfo: attraction.accessibilityInfo || '',
        whatToBring: operationalList(attraction.whatToBring),
        inclusions: operationalList(product.inclusions),
        exclusions: operationalList(product.exclusions),
      },
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
    admissionCount:
      Number(booking.snapshotAdmissionCount)
      || getSnapshotAdmissionCount(reservation),
    visitDate: booking.snapshotVisitDate || reservation.date,
    timeSlotLabel: booking.snapshotTimeSlotLabel || getTimeSlotLabel(reservation.timeSlot),
    unitPrice: booking.snapshotUnitPrice,
    refundPolicy: booking.snapshotRefundPolicy || product.refundPolicy,
    refundFeeRate: booking.snapshotRefundFeeRate ?? product.refundFeeRate,
    refundCutoffHours:
      booking.snapshotRefundCutoffHours ?? product.refundCutoffHours ?? 24,
    operationalDetails: {
      meetingPoint: booking.snapshotMeetingPoint ?? attraction.meetingPoint ?? '',
      checkInInstructions:
        booking.snapshotCheckInInstructions ?? attraction.checkInInstructions ?? '',
      accessibilityInfo:
        booking.snapshotAccessibilityInfo ?? attraction.accessibilityInfo ?? '',
      whatToBring: Array.isArray(booking.snapshotWhatToBring)
        ? operationalList(booking.snapshotWhatToBring)
        : operationalList(attraction.whatToBring),
      inclusions: Array.isArray(booking.snapshotInclusions)
        ? operationalList(booking.snapshotInclusions)
        : operationalList(product.inclusions),
      exclusions: Array.isArray(booking.snapshotExclusions)
        ? operationalList(booking.snapshotExclusions)
        : operationalList(product.exclusions),
    },
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
    requiresManualApproval: Boolean(attraction.requiresManualApproval),
    operationalDetails: {
      meetingPoint: attraction.meetingPoint || '',
      checkInInstructions: attraction.checkInInstructions || '',
      accessibilityInfo: attraction.accessibilityInfo || '',
      whatToBring: operationalList(attraction.whatToBring),
      inclusions: operationalList(product.inclusions),
      exclusions: operationalList(product.exclusions),
    },
    ticketName: product.name,
    ticketRestrictions: reservation.snapshotTicketRestrictions
      || buildTicketRestrictions(product),
    bookingScope: 'SINGLE_TICKET_PRODUCT',
    lineItemCount: 1,
    changePolicy: CUSTOMER_BOOKING_CHANGE_POLICY,
    visitDate: dateOnly(reservation.date),
    timeSlotId: reservation.timeSlotId,
    timeSlotLabel: getTimeSlotLabel(reservation.timeSlot),
    quantity: reservation.quantity,
    admissionCount: getSnapshotAdmissionCount(reservation),
    participantCount: reservation.quantity * getSnapshotAdmissionCount(reservation),
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
  const latestRefundRequest = [
    ...(booking.refundRequests || []),
    ...(booking.refundRequestsTargeting || []),
  ].sort((left, right) => (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  ))[0] || null;
  const manualApproval = buildManualApprovalView(booking);

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
    ticketRestrictions: booking.snapshotTicketRestrictions
      || buildTicketRestrictions(product),
    travelerManifest: booking.travelerManifest || null,
    invoiceDetails: booking.invoiceDetails || null,
    bookingScope: 'SINGLE_TICKET_PRODUCT',
    lineItemCount: 1,
    changePolicy: CUSTOMER_BOOKING_CHANGE_POLICY,
    visitDate: dateOnly(snapshot.visitDate),
    timeSlotId: reservation.timeSlotId,
    timeSlotLabel: snapshot.timeSlotLabel,
    quantity: reservation.quantity,
    admissionCount: Number(snapshot.admissionCount || 1),
    participantCount: reservation.quantity * Number(snapshot.admissionCount || 1),
    unitPrice: decimalToNumber(snapshot.unitPrice),
    subtotalAmount: decimalToNumber(booking.subtotalAmount),
    subtotal: decimalToNumber(booking.subtotalAmount),
    discountAmount: decimalToNumber(booking.discountAmount),
    totalAmount: decimalToNumber(booking.totalAmount),
    itineraryContext: booking.itineraryId
      ? {
          itineraryId: booking.itineraryId,
          version: booking.itineraryVersion,
          itemId: booking.itineraryItemId,
        }
      : null,
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
    manualApproval,
    operationalDetails: snapshot.operationalDetails,
    refundRequired: Boolean(booking.refundRequired),
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
    refundRequest: latestRefundRequest
      ? {
          id: latestRefundRequest.id,
          type: latestRefundRequest.type,
          mandatory: latestRefundRequest.mandatory,
          status: latestRefundRequest.status,
          amount: decimalToNumber(latestRefundRequest.amount),
          reason: latestRefundRequest.reason,
          staffNotes: latestRefundRequest.staffNotes || '',
          createdAt: latestRefundRequest.createdAt,
          processedAt: latestRefundRequest.processedAt,
        }
      : null,
    ticketInstances: booking.ticketInstances.map((ticket) => ({
      id: ticket.id,
      qrCodeToken: ticket.qrCodeToken,
      status: ticket.status.toLowerCase(),
    })),
  };
}

function buildManualApprovalView(booking) {
  const requiresApproval = Boolean(
    booking?.partnerApprovalRequestedAt
    || booking?.partnerApprovedAt
    || booking?.status === 'PENDING_PARTNER',
  );
  if (!requiresApproval) return null;
  const approvalDeadline = getManualApprovalDeadline(booking);
  const paymentCapturedBeforeApproval = (booking.payments || []).some((payment) =>
    isCapturedPayment(payment, { allowInternalCredit: true }));
  return {
    required: true,
    approved: Boolean(booking.partnerApprovedAt),
    partnerApprovedAt: booking.partnerApprovedAt || null,
    paymentCapturedBeforeApproval,
    approvalDeadline,
    maximumResponseHours: 24,
    deadlineRule: 'EARLIER_OF_24_HOURS_OR_ACTIVITY_START',
    timeoutOutcome: paymentCapturedBeforeApproval
      ? 'CANCEL_AND_MANDATORY_FULL_REFUND'
      : 'CANCEL_WITHOUT_CHARGE',
  };
}

function validateVoucher(
  voucher,
  subtotalAmount,
  now = new Date(),
  userId = null,
  context = {},
) {
  if (
    !voucher
    || !voucher.isActive
    || voucher.startDate > now
    || voucher.expiryDate <= now
  ) {
    const error = new Error('Mã ưu đãi không hợp lệ hoặc đã hết hạn.');
    error.statusCode = 400;
    throw error;
  }

  // Voucher cá nhân (đổi điểm) chỉ chủ sở hữu mới được dùng.
  if (voucher.userId && voucher.userId !== userId) {
    const error = new Error('Mã ưu đãi này không thuộc về tài khoản của bạn.');
    error.statusCode = 400;
    throw error;
  }

  normalizeVoucherFunding(voucher);

  if (voucher.usageLimit != null && voucher.usedCount >= voucher.usageLimit) {
    const error = new Error('Mã ưu đãi đã hết lượt sử dụng.');
    error.statusCode = 400;
    throw error;
  }
  if (
    Number(voucher.activeUserUsage || 0)
    >= Math.max(Number(voucher.maxUsesPerUser || 1), 1)
  ) {
    const error = new Error('Bạn đã sử dụng đủ lượt cho mã ưu đãi này.');
    error.statusCode = 409;
    error.code = 'VOUCHER_USER_LIMIT_REACHED';
    throw error;
  }
  if (
    voucher.applicablePartnerId
    && voucher.applicablePartnerId !== context.partnerId
  ) {
    const error = new Error('Mã ưu đãi không áp dụng cho nhà cung cấp này.');
    error.statusCode = 409;
    throw error;
  }
  if (
    voucher.applicableAttractionId
    && voucher.applicableAttractionId !== context.attractionId
  ) {
    const error = new Error('Mã ưu đãi không áp dụng cho địa điểm này.');
    error.statusCode = 409;
    throw error;
  }
  if (
    voucher.applicableTicketProductId
    && voucher.applicableTicketProductId !== context.ticketProductId
  ) {
    const error = new Error('Mã ưu đãi không áp dụng cho gói vé này.');
    error.statusCode = 409;
    throw error;
  }
  if (
    ['PARTNER', 'SHARED'].includes(String(voucher.fundingSource || '').toUpperCase())
    && (
      !voucher.fundingPartnerId
      || voucher.fundingPartnerId !== context.partnerId
    )
  ) {
    const error = new Error('Nguồn tài trợ của mã ưu đãi không khớp nhà cung cấp.');
    error.statusCode = 409;
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

async function findVoucher(
  client,
  voucherCode,
  subtotalAmount,
  now,
  userId = null,
  context = {},
) {
  const code = normalizeVoucherCode(voucherCode);
  if (!code) return { voucher: null, discountAmount: new Decimal(0) };

  const voucher = await client.voucher.findUnique({ where: { code } });
  if (voucher) {
    voucher.activeUserUsage = await countActiveVoucherUses(client, voucher.id, userId);
  }
  validateVoucher(voucher, subtotalAmount, now, userId, context);

  return {
    voucher,
    discountAmount: calculateDiscount(voucher, subtotalAmount),
  };
}

async function confirmReservationAndStock(tx, reservation) {
  if (reservation.status === 'CONFIRMED') return;
  const inventoryUnits = getInventoryUnits(reservation);

  const dailyStock = await tx.dailyStock.updateMany({
    where: {
      ticketProductId: reservation.ticketProductId,
      date: reservation.date,
      heldQuantity: { gte: inventoryUnits },
    },
    data: {
      heldQuantity: { decrement: inventoryUnits },
      bookedQuantity: { increment: inventoryUnits },
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
      heldQty: { gte: inventoryUnits },
    },
    data: {
      heldQty: { decrement: inventoryUnits },
      bookedQty: { increment: inventoryUnits },
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
        heldQty: { gte: inventoryUnits },
      },
      data: {
        heldQty: { decrement: inventoryUnits },
        bookedQty: { increment: inventoryUnits },
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
      where: { userId: req.user.id, isForecastTrainingSample: false },
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

    if (
      !booking
      || booking.userId !== req.user.id
      || booking.isForecastTrainingSample
    ) {
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
    const reservationId = String(
      req.body?.reservationId || req.body?.bookingId || '',
    ).trim();

    if (!voucherCode) {
      return res.status(400).json({ message: 'Vui lòng nhập mã ưu đãi.' });
    }
    if (!reservationId) {
      return res.status(400).json({ message: 'reservationId là bắt buộc.' });
    }
    const reservation = await prisma.reservation.findFirst({
      where: {
        id: reservationId,
        userId: req.user.id,
        status: 'HELD',
        expiresAt: { gt: new Date() },
      },
      include: {
        ticketProduct: {
          include: {
            attraction: { select: { id: true, partnerId: true } },
          },
        },
      },
    });
    if (!reservation) {
      return res.status(404).json({ message: 'Đơn giữ chỗ không còn hiệu lực.' });
    }
    const unitPrice = parseVndInteger(
      reservation.snapshotUnitPrice ?? reservation.ticketProduct.sellingPrice,
    );
    if (unitPrice === null) {
      return res.status(409).json({ message: 'Giá vé hiện tại không hợp lệ.' });
    }
    const subtotalAmount = new Decimal(unitPrice).mul(reservation.quantity);

    const { voucher, discountAmount } = await findVoucher(
      prisma,
      voucherCode,
      subtotalAmount,
      new Date(),
      req.user?.id || null,
      voucherContextOf(reservation),
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

async function listApplicableVouchers(req, res, next) {
  try {
    const userId = req.user?.id;
    const reservationId = String(req.query?.reservationId || '').trim();
    if (!reservationId) {
      return res.status(400).json({ message: 'reservationId là bắt buộc.' });
    }

    const reservation = await prisma.reservation.findFirst({
      where: {
        id: reservationId,
        userId,
        status: 'HELD',
      },
      select: {
        id: true,
        quantity: true,
        snapshotUnitPrice: true,
        expiresAt: true,
        ticketProduct: {
          select: {
            id: true,
            attractionId: true,
            sellingPrice: true,
            attraction: { select: { id: true, partnerId: true } },
          },
        },
      },
    });
    const now = new Date();
    if (!reservation || reservation.expiresAt <= now) {
      return res.status(404).json({ message: 'Đơn giữ chỗ không còn hiệu lực.' });
    }

    const unitPrice = parseVndInteger(
      reservation.snapshotUnitPrice ?? reservation.ticketProduct.sellingPrice,
    );
    if (unitPrice === null) {
      return res.status(409).json({ message: 'Giá vé hiện tại không hợp lệ.' });
    }
    const subtotalAmount = new Decimal(unitPrice).mul(reservation.quantity);
    const vouchers = await prisma.voucher.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        expiryDate: { gt: now },
        OR: [{ userId: null }, { userId }],
      },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const applicable = [];
    for (const voucher of vouchers) {
      try {
        voucher.activeUserUsage = await countActiveVoucherUses(
          prisma,
          voucher.id,
          userId,
        );
        validateVoucher(
          voucher,
          subtotalAmount,
          now,
          userId,
          voucherContextOf(reservation),
        );
        const discountAmount = calculateDiscount(voucher, subtotalAmount);
        const totalAmount = subtotalAmount.minus(discountAmount);
        if (parseVndInteger(totalAmount) === null || totalAmount.lessThan(MIN_VNPAY_AMOUNT)) {
          continue;
        }
        applicable.push({
          id: voucher.id,
          code: voucher.code,
          source: voucher.source,
          discountType: voucher.discountType,
          discountValue: decimalToNumber(voucher.discountValue),
          maxDiscount: voucher.maxDiscount ? decimalToNumber(voucher.maxDiscount) : null,
          minSpend: voucher.minSpend ? decimalToNumber(voucher.minSpend) : null,
          expiryDate: voucher.expiryDate,
          discountAmount: decimalToNumber(discountAmount),
          totalAmount: decimalToNumber(totalAmount),
        });
      } catch {
        // Voucher hết lượt hoặc không đạt điều kiện không nên làm hỏng cả danh sách.
      }
    }
    applicable.sort((left, right) => (
      right.discountAmount - left.discountAmount
      || new Date(left.expiryDate) - new Date(right.expiryDate)
    ));

    return res.json({
      success: true,
      data: applicable,
      meta: { subtotalAmount: decimalToNumber(subtotalAmount) },
    });
  } catch (error) {
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
    const itineraryContext = normalizeItineraryContext(req.body?.itineraryContext);

    if (!reservationId) {
      return res.status(400).json({ message: 'reservationId là bắt buộc.' });
    }
    if (!fullName || !email) {
      return res.status(400).json({ message: 'Họ tên và email là bắt buộc.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Email không hợp lệ.' });
    }
    if (!getAllowedPaymentMethods().has(paymentMethod)) {
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
                    partner: {
                      select: {
                        id: true,
                        businessName: true,
                        commissionRate: true,
                        status: true,
                        userId: true,
                      },
                    },
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
          (reservation.ticketProduct.attraction.partner?.userId
            && reservation.ticketProduct.attraction.partner.userId === userId)
          || (req.user?.employerPartnerId
            && req.user.employerPartnerId
              === reservation.ticketProduct.attraction.partner?.id)
        ) {
          const error = new Error(
            'Đối tác và nhân viên của đối tác không được tự đặt vé tại địa điểm mình quản lý.',
          );
          error.statusCode = 403;
          error.code = 'SELF_BOOKING_NOT_ALLOWED';
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
        const participantCount = reservation.quantity * getSnapshotAdmissionCount(reservation);
        const restrictions = reservation.snapshotTicketRestrictions
          || buildTicketRestrictions(reservation.ticketProduct);
        const travelerManifest = normalizeTravelerManifest(req.body?.travelerManifest, {
          participantCount,
          restrictions,
          visitDate: reservation.date,
        });
        const invoiceDetails = normalizeInvoiceDetails(req.body?.invoiceDetails, {
          fallbackEmail: email,
          now,
        });

        const existingBooking = await tx.booking.findUnique({
          where: { reservationId },
        });
        if (existingBooking) {
          const error = new Error('Đơn giữ chỗ này đã được tạo booking.');
          error.statusCode = 409;
          throw error;
        }

        await validateItineraryBookingContext(tx, {
          context: itineraryContext,
          reservation,
          userId,
          now,
        });

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
          userId,
          voucherContextOf(reservation),
        );
        const customerTotalAmount = subtotalAmount.minus(discountAmount);
        const parsedTotal = parseVndInteger(customerTotalAmount);
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
        const financials = calculateBookingFinancials({
          subtotalAmount,
          discountAmount,
          commissionRate,
          voucher,
        });

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

        const requiresPartnerApproval =
          reservation.ticketProduct.attraction.requiresManualApproval === true;
        let partnerApprovalDeadline = null;
        if (requiresPartnerApproval) {
          const timeoutDeadline = new Date(now.getTime() + MANUAL_APPROVAL_TIMEOUT_MS);
          const { startsAt } = getBookingActivityWindow({ reservation });
          if (
            startsAt
            && startsAt.getTime() - now.getTime() < getManualApprovalMinLeadMs()
          ) {
            const error = new Error(
              'Lịch tham quan này đã quá sát giờ để đối tác duyệt và khách hoàn tất thanh toán an toàn.',
            );
            error.statusCode = 409;
            throw error;
          }
          partnerApprovalDeadline = startsAt && startsAt < timeoutDeadline
            ? startsAt
            : timeoutDeadline;
          if (partnerApprovalDeadline <= now) {
            const error = new Error('Đã quá giờ đối tác có thể xác nhận cho lịch tham quan này.');
            error.statusCode = 409;
            throw error;
          }
        }

        const created = await tx.booking.create({
          data: {
            userId,
            reservationId,
            voucherId: voucher?.id || null,
            itineraryId: itineraryContext?.itineraryId || null,
            itineraryVersion: itineraryContext?.version || null,
            itineraryItemId: itineraryContext?.itemId || null,
            subtotalAmount,
            discountAmount,
            totalAmount: financials.totalAmount,
            status: requiresPartnerApproval ? 'PENDING_PARTNER' : 'PENDING_PAYMENT',
            partnerApprovalRequestedAt: requiresPartnerApproval ? now : null,
            partnerApprovalDeadline,
            paymentMethod,
            fullName,
            email,
            phone: phone || null,
            note: note || null,
            travelerManifest,
            invoiceDetails,
            commissionRateSnapshot: commissionRate,
            voucherFundingSourceSnapshot:
              financials.voucherFundingSourceSnapshot,
            voucherPlatformFundingPercentSnapshot:
              financials.voucherPlatformFundingPercentSnapshot,
            platformDiscountAmountSnapshot:
              financials.platformDiscountAmountSnapshot,
            partnerDiscountAmountSnapshot:
              financials.partnerDiscountAmountSnapshot,
            commissionBaseAmountSnapshot:
              financials.commissionBaseAmountSnapshot,
            commissionAmountSnapshot:
              financials.commissionAmountSnapshot,
            partnerNetAmountSnapshot:
              financials.partnerNetAmountSnapshot,
            platformNetRevenueSnapshot:
              financials.platformNetRevenueSnapshot,
            ...buildBookingSnapshot(reservation, now),
          },
        });

        if (voucher) {
          await claimVoucherRedemption(tx, {
            voucher,
            userId,
            bookingId: created.id,
          });
        }

        if (requiresPartnerApproval) {
          await enqueueBookingNotification(tx, {
            bookingId: created.id,
            topic: PARTNER_APPROVAL_REQUESTED_TOPIC,
          });
        }

        if (requiresPartnerApproval && partnerApprovalDeadline > reservation.expiresAt) {
          await tx.reservation.update({
            where: { id: reservationId },
            data: {
              expiresAt: partnerApprovalDeadline,
              paymentDeadline: null,
            },
          });
        }

        // Chuyển khoản ngân hàng cần thời gian cho khách chuyển tiền và cho
        // Admin đối chiếu sao kê. Giữ chỗ mặc định 10 phút sẽ khiến worker hủy
        // đơn dù khách đã chuyển tiền -> nới hạn giữ chỗ cho riêng đơn này.
        // Với sản phẩm duyệt thủ công, đối tác phải duyệt trước rồi hệ thống mới
        // mở một payment window mới. Không được ghi đè hạn duyệt 24 giờ bằng
        // hạn chuyển khoản ở bước tạo booking.
        if (paymentMethod === BANK_TRANSFER_METHOD && !requiresPartnerApproval) {
          const bankHoldExpiresAt = new Date(now.getTime() + getBankTransferHoldMs());
          if (bankHoldExpiresAt > reservation.expiresAt) {
            await tx.reservation.update({
              where: { id: reservationId },
              data: {
                expiresAt: bankHoldExpiresAt,
                paymentDeadline: bankHoldExpiresAt,
              },
            });
          }
        }

        return tx.booking.findUnique({
          where: { id: created.id },
          include: bookingInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (booking.status === 'PENDING_PARTNER') {
      queueNewBookingNotification(booking.id);
    }
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
    if (error.code === 'P2034') {
      return res.status(409).json({
        message: 'Dữ liệu lịch trình hoặc tồn vé vừa thay đổi. Vui lòng tải lại và thử đặt vé lần nữa.',
      });
    }
    return next(error);
  }
}

async function getItineraryBookingProgress(req, res, next) {
  try {
    const itineraryId = String(req.params.itineraryId || '').trim();
    const itinerary = await prisma.savedItinerary.findFirst({
      where: { id: itineraryId, userId: req.user.id },
      select: { id: true, planId: true, title: true, data: true },
    });
    if (!itinerary) {
      return res.status(404).json({ message: 'Không tìm thấy lịch trình thuộc tài khoản của bạn.' });
    }
    const bookings = await prisma.booking.findMany({
      where: { itineraryId, userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        itineraryVersion: true,
        itineraryItemId: true,
        status: true,
        reservationId: true,
        paymentMethod: true,
        refundRequired: true,
        totalAmount: true,
        createdAt: true,
        reservation: {
          select: {
            expiresAt: true,
          },
        },
        refundRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            mandatory: true,
            status: true,
            amount: true,
          },
        },
        payments: {
          where: { status: 'SUCCESS', isDuplicate: false },
          select: {
            status: true,
            isDuplicate: true,
            paymentGateway: true,
            paidAt: true,
          },
        },
      },
    });
    const latestByItem = new Map();
    for (const booking of bookings) {
      if (!booking.itineraryItemId || latestByItem.has(booking.itineraryItemId)) continue;
      const capturedPayment = booking.payments.find((payment) => (
        isCapturedPayment(payment, { allowInternalCredit: true })
      ));
      const fulfilled = Boolean(capturedPayment)
        && ['PENDING_PARTNER', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(booking.status);
      const latestRefund = booking.refundRequests?.[0] || null;
      let lineState = 'ACTION_REQUIRED';
      let nextAction = 'CREATE_REPLACEMENT';
      if (fulfilled) {
        lineState = 'COMPLETED';
        nextAction = 'NONE';
      } else if (booking.status === 'REFUND_REQUESTED') {
        lineState = 'REFUND_PENDING';
        nextAction = 'TRACK_REFUND';
      } else if (booking.status === 'PENDING_PAYMENT') {
        lineState = 'PAYMENT_PENDING';
        nextAction = 'CONTINUE_PAYMENT';
      }
      latestByItem.set(booking.itineraryItemId, {
        itemId: booking.itineraryItemId,
        bookingId: booking.id,
        reservationId: booking.reservationId,
        version: booking.itineraryVersion,
        bookingStatus: booking.status,
        paymentMethod: booking.paymentMethod,
        reservationExpiresAt: booking.reservation?.expiresAt || null,
        paid: Boolean(capturedPayment),
        fulfilled,
        lineState,
        nextAction,
        replacementAllowed: ['CANCELLED', 'REFUNDED'].includes(booking.status),
        paidAmount: capturedPayment ? decimalToNumber(booking.totalAmount) : 0,
        refundRequired: Boolean(booking.refundRequired),
        refund: latestRefund
          ? {
              id: latestRefund.id,
              mandatory: latestRefund.mandatory,
              status: latestRefund.status,
              amount: decimalToNumber(latestRefund.amount),
            }
          : null,
        paidAt: capturedPayment?.paidAt || null,
        createdAt: booking.createdAt,
      });
    }
    const items = [...latestByItem.values()];
    const plannedItemCount = extractItineraryTicketItems({ data: itinerary.data }).length;
    const countState = (state) => items.filter((item) => item.lineState === state).length;
    return res.json({
      success: true,
      data: {
        itinerary: {
          id: itinerary.id,
          planId: itinerary.planId,
          title: itinerary.title,
        },
        transactionPolicy: {
          mode: 'SEQUENTIAL_INDEPENDENT',
          atomic: false,
          rollbackCompletedBookingsOnLaterFailure: false,
        },
        summary: {
          plannedItemCount,
          startedCount: items.length,
          completedCount: countState('COMPLETED'),
          paymentPendingCount: countState('PAYMENT_PENDING'),
          refundPendingCount: countState('REFUND_PENDING'),
          actionRequiredCount: countState('ACTION_REQUIRED'),
        },
        items,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createBooking,
  getItineraryBookingProgress,
  getBooking,
  getReservation,
  listApplicableVouchers,
  listBookings,
  validateAndApplyVoucher,
  // Helper dùng chung cho luồng thanh toán VNPay (L2) & duyệt vé đối tác (N2)
  confirmReservationAndStock,
  createTicketInstances,
  buildBookingSnapshot,
  buildManualApprovalView,
  getBookingSnapshotView,
  resolveBookingPaymentStatus,
  selectBookingPayment,
  buildItineraryItemId,
  extractItineraryTicketItems,
  itineraryContainsReservation,
  itineraryItemMatchesReservation,
  normalizeItineraryContext,
  validateItineraryBookingContext,
};
