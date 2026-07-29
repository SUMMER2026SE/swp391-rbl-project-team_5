'use strict';

const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { isPlatformStaff } = require('../middleware/roleMiddleware');
const { todayInVietnam } = require('../utils/refundService');
const { refundViaVnpay, queryVnpayTransaction } = require('./paymentController');
const { createVnpRequestId } = require('../utils/vnpay');
const {
  REFUND_GATEWAY_OUTCOME,
  assertRefundCanBeSubmitted,
  buildGatewayTransactionData,
  classifyVnpayRefundResult,
  classifyVnpayReconciliationResult,
  finalizeSuccessfulRefund,
  findRefundTargetPayment,
  getRefundProcessingEligibility,
  isLocalDemoPayment,
  isMandatoryRefundRequest,
  lockPaymentForRefund,
  toVndAmount,
} = require('../services/refundLifecycleService');
const {
  markRefundNotificationDelivered,
} = require('../services/refundNotificationService');
const { getRequestIp, writeAuditLog } = require('../utils/auditLog');
const { hasRole } = require('../utils/userRoles');
const {
  getBookingActivityWindow,
  getCheckinTimeBlockReason,
} = require('../utils/activityTime');
const {
  sendRefundStatusEmail,
  sendReissueTicketEmail,
} = require('../utils/mailer');
const {
  emitQueueAdmissionUpdates,
  markQueueAdmittedForBooking,
} = require('../services/smartQueueService');
const {
  emitBookingStatusUpdated,
  emitRecoveryCaseEvent,
  emitRefundStatusUpdated,
} = require('../realtime/events');
const { getSnapshotAdmissionCount } = require('../utils/ticketCapacity');

function getClientIp(req) {
  return getRequestIp(req) || '127.0.0.1';
}

const REFUND_ACTIONS = new Set(['APPROVED', 'REJECTED']);
const REFUND_STATUSES = new Set(['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED']);
const MANUAL_REFUND_DECISIONS = new Set(['SUCCESS', 'FAILED']);
const GATEWAY_EVIDENCE_ID_PATTERN = /^[A-Za-z0-9._:-]{3,120}$/;
const REISSUE_REASON_CODES = new Set([
  'LOST_BY_CUSTOMER',
  'DAMAGED_QR',
  'CONTACT_CHANGED',
  'OPERATIONAL_ERROR',
  'OTHER',
]);

function emitRefundLifecycleRealtime(
  refundRequest,
  {
    status,
    amount = null,
    message = null,
    bookingStatus = null,
  } = {},
) {
  const sourceBooking = refundRequest?.booking;
  const targetBooking = refundRequest?.targetBooking;
  const customerBooking = targetBooking || sourceBooking;
  const customerId = customerBooking?.userId
    || customerBooking?.user?.id
    || sourceBooking?.userId
    || sourceBooking?.user?.id;
  if (!customerId || !refundRequest?.id) return;

  const requestKey = String(refundRequest.requestKey || '');
  const recoveryCaseMatch = requestKey.match(/^recovery-(?:full|difference):(.+)$/);
  const recoveryCaseId = recoveryCaseMatch?.[1] || null;
  try {
    emitRefundStatusUpdated({
      customerId,
      refundRequestId: refundRequest.id,
      status,
      amount: Number(amount ?? refundRequest.amount ?? 0),
      sourceBookingId: sourceBooking?.id || refundRequest.bookingId || null,
      targetBookingId: refundRequest.targetBookingId || targetBooking?.id || null,
      recoveryCaseId,
      message,
    });

    if (bookingStatus && customerBooking?.id) {
      // A difference refund intentionally leaves the cancelled source booking
      // CANCELLED; only full/direct refunds should announce REFUNDED here.
      if (!requestKey.startsWith('recovery-difference:')) {
        emitBookingStatusUpdated({
          customerId,
          bookingId: customerBooking.id,
          status: bookingStatus,
          message,
        });
      }
    }
    if (
      status === 'APPROVED'
      && requestKey.startsWith('recovery-full:')
      && recoveryCaseId
    ) {
      emitRecoveryCaseEvent({
        customerId,
        recoveryCaseId,
        status: 'REFUNDED',
        message: message || 'Khoản hoàn tiền Rescue đã được xác nhận.',
        // For a Rescue full refund, `booking` is the funding/original payment
        // booking while `targetBookingId` is the cancelled Rescue case booking.
        originalBookingId: refundRequest.targetBookingId
          || targetBooking?.id
          || sourceBooking?.id
          || null,
        replacementBookingId: null,
      });
    }
  } catch (error) {
    // Realtime delivery is an enhancement; never turn a committed financial
    // decision into a 500 when the socket layer is unavailable.
    console.error('[staff-refund] Không thể phát realtime:', error.message);
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function createRefundTransactionWithPaymentLock({
  refundRequest,
  payment,
  userId,
  transactionType,
  requestedAmount,
  reason,
  orderInfo,
  isManualBankTransfer = false,
  manualReference = null,
}) {
  const createData = {
    bookingId: refundRequest.booking.id,
    paymentId: payment.id,
    refundRequestId: refundRequest.id,
    gateway: isManualBankTransfer ? 'BANK_TRANSFER_MANUAL' : 'VNPAY',
    gatewayRequestId: isManualBankTransfer
      ? `BTRF-${createVnpRequestId()}`
      : createVnpRequestId(),
    transactionType,
    amount: requestedAmount,
    status: 'PROCESSING',
    reason,
    processedById: userId,
    submittedAt: new Date(),
    rawRequest: {
      originalTransactionId: payment.transactionId,
      orderInfo,
      ...(isManualBankTransfer ? { manualReference } : {}),
    },
    ...(isManualBankTransfer ? {
      gatewayTransactionId: manualReference,
      gatewayResponseCode: 'MANUAL_CONFIRMED',
      gatewayTransactionStatus: 'SUCCESS',
      rawResponse: {
        method: 'bank_transfer',
        manualReference,
        confirmedBy: userId,
      },
    } : {}),
  };

  return prisma.$transaction(async (tx) => {
    await lockPaymentForRefund(tx, payment.id);
    const currentTransactions = tx.refundTransaction?.findMany
      ? await tx.refundTransaction.findMany({
        where: {
          paymentId: payment.id,
          status: { in: ['PENDING', 'PROCESSING', 'NEEDS_RECONCILIATION', 'SUCCESS'] },
        },
        select: {
          id: true,
          paymentId: true,
          refundRequestId: true,
          amount: true,
          status: true,
        },
      })
      : refundRequest.booking.refundTransactions;
    assertRefundCanBeSubmitted({
      refundRequest,
      payment,
      transactions: currentTransactions || [],
    });
    if (!tx.refundTransaction?.create) {
      // Jest/unit adapters may expose only the root mock; production Prisma
      // always takes the transactional branch above.
      return prisma.refundTransaction.create({ data: createData });
    }
    return tx.refundTransaction.create({ data: createData });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function casRefundTransactionUpdate(tx, transactionId, expectedStatus, data) {
  if (tx.refundTransaction?.updateMany) {
    return tx.refundTransaction.updateMany({
      where: { id: transactionId, status: expectedStatus },
      data,
    });
  }
  await tx.refundTransaction.update({ where: { id: transactionId }, data });
  return { count: 1 };
}

async function casRefundRequestUpdate(tx, refundRequestId, expectedStatuses, data) {
  if (tx.refundRequest?.updateMany) {
    return tx.refundRequest.updateMany({
      where: {
        id: refundRequestId,
        status: { in: expectedStatuses },
      },
      data,
    });
  }
  await tx.refundRequest.update({ where: { id: refundRequestId }, data });
  return { count: 1 };
}

async function casRootRefundTransactionUpdate(transactionId, expectedStatus, data) {
  if (prisma.refundTransaction?.updateMany) {
    return prisma.refundTransaction.updateMany({
      where: { id: transactionId, status: expectedStatus },
      data,
    });
  }
  await prisma.refundTransaction.update({ where: { id: transactionId }, data });
  return { count: 1 };
}

function assertPlatformRefundStaff(user) {
  if (!isPlatformStaff(user)) {
    throw httpError(403, 'Chỉ nhân viên nội bộ của nền tảng mới có quyền xử lý hoàn tiền.');
  }
}

function assertAdminRefundStaff(user) {
  if (!hasRole(user, 'ADMIN')) {
    throw httpError(
      403,
      'Chỉ quản trị viên mới được xác nhận thủ công giao dịch hoàn tiền khi VNPay không trả đủ định danh.',
    );
  }
}

function parseManualRefundEvidence(body, refundTransaction) {
  const decision = String(body?.outcome || body?.decision || '').trim().toUpperCase();
  if (!MANUAL_REFUND_DECISIONS.has(decision)) {
    throw httpError(400, 'decision phải là SUCCESS hoặc FAILED.');
  }

  const evidenceNote = String(body?.evidenceNote || '').trim();
  if (evidenceNote.length < 10) {
    throw httpError(400, 'Bằng chứng xử lý thủ công phải có ít nhất 10 ký tự.');
  }
  if (evidenceNote.length > 2000) {
    throw httpError(400, 'Bằng chứng xử lý thủ công không được vượt quá 2000 ký tự.');
  }

  const gatewayTransactionId = String(body?.gatewayTransactionId || '').trim();
  if (decision === 'SUCCESS' && !GATEWAY_EVIDENCE_ID_PATTERN.test(gatewayTransactionId)) {
    throw httpError(
      400,
      'SUCCESS bắt buộc có mã giao dịch hoàn VNPay hợp lệ (3–120 ký tự chữ/số).',
    );
  }
  if (
    gatewayTransactionId
    && !GATEWAY_EVIDENCE_ID_PATTERN.test(gatewayTransactionId)
  ) {
    throw httpError(400, 'Mã giao dịch hoàn VNPay chứa ký tự không hợp lệ.');
  }

  const evidenceAmount = toVndAmount(
    body?.confirmAmount,
    'Số tiền xác nhận thủ công',
  );
  const expectedAmount = toVndAmount(
    refundTransaction?.amount,
    'Số tiền yêu cầu hoàn',
  );
  if (evidenceAmount !== expectedAmount) {
    throw httpError(
      409,
      `Số tiền bằng chứng (${evidenceAmount}) không khớp số tiền phải hoàn (${expectedAmount}).`,
    );
  }

  const transactionType = String(body?.transactionType || '').trim();
  const expectedType = String(refundTransaction?.transactionType || '').trim();
  if (!['02', '03'].includes(transactionType) || transactionType !== expectedType) {
    throw httpError(
      409,
      `Loại giao dịch bằng chứng (${transactionType || 'trống'}) không khớp loại hoàn đã gửi (${expectedType || 'trống'}).`,
    );
  }

  const paymentTransactionRef = String(body?.paymentTransactionRef || '').trim();
  const expectedPaymentTransactionRef = String(
    refundTransaction?.payment?.transactionId || '',
  ).trim();
  if (
    !paymentTransactionRef
    || !expectedPaymentTransactionRef
    || paymentTransactionRef !== expectedPaymentTransactionRef
  ) {
    throw httpError(
      409,
      'Mã giao dịch thanh toán gốc trong bằng chứng không khớp giao dịch đang đối soát.',
    );
  }

  const responseCode = String(body?.gatewayResponseCode || (decision === 'SUCCESS' ? '00' : 'MANUAL_FAILED')).trim();
  const transactionStatus = String(body?.gatewayTransactionStatus || (decision === 'SUCCESS' ? '00' : 'MANUAL_FAILED')).trim();
  if (responseCode.length > 32 || transactionStatus.length > 32) {
    throw httpError(400, 'Mã trạng thái cổng thanh toán quá dài.');
  }

  return {
    decision,
    evidenceNote,
    gatewayTransactionId: gatewayTransactionId || null,
    transactionType,
    paymentTransactionRef,
    responseCode,
    transactionStatus,
    evidenceAmount,
  };
}

function getTicketAttractionId(instance) {
  return instance.booking?.reservation?.ticketProduct?.attraction?.id
    || instance.booking?.reservation?.ticketProduct?.attractionId
    || instance.booking?.snapshotAttractionId
    || null;
}

async function assertStaffAttractionAccess(client, user, attractionId) {
  if (hasRole(user, 'ADMIN')) return;
  if (!attractionId) {
    throw httpError(403, 'Không xác định được địa điểm của vé.');
  }

  const assignment = await client.staffAttractionAssignment.findFirst({
    where: {
      staffId: user.id,
      attractionId,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (!assignment) {
    // Chỉ chạy trên nhánh lỗi: nêu rõ vé thuộc địa điểm nào và nhân viên đang
    // được phân công ở đâu, để nhân viên/quản trị xử lý ngay tại cổng.
    const [ticketAttraction, assigned] = await Promise.all([
      client.attraction.findUnique({
        where: { id: attractionId },
        select: { title: true },
      }),
      client.staffAttractionAssignment.findMany({
        where: { staffId: user.id, revokedAt: null },
        select: { attraction: { select: { title: true } } },
        take: 5,
      }),
    ]);

    const ticketPlace = ticketAttraction?.title
      ? `"${ticketAttraction.title}"`
      : 'địa điểm khác';
    const assignedTitles = assigned
      .map((item) => item.attraction?.title)
      .filter(Boolean);
    const assignedText = assignedTitles.length
      ? `Bạn đang được phân công tại: ${assignedTitles.join(', ')}.`
      : 'Hiện bạn chưa được phân công địa điểm nào — vui lòng liên hệ quản trị viên để được gán địa điểm.';

    throw httpError(
      403,
      `Vé này thuộc ${ticketPlace}, không nằm trong phạm vi check-in của bạn. ${assignedText}`,
    );
  }
}

// Giới hạn phân trang: mặc định 20, tối đa 100 để tránh trả về quá nhiều bản ghi.
const REFUND_PAGE_SIZE_DEFAULT = 20;
const REFUND_PAGE_SIZE_MAX = 100;

function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

async function listRefundRequests(req, res, next) {
  try {
    assertPlatformRefundStaff(req.user);

    const status = String(req.query.status || '').trim().toUpperCase();
    if (status && !REFUND_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Trạng thái hoàn tiền không hợp lệ.' },
      });
    }

    const search = String(req.query.search || '').trim();
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(
      parsePositiveInt(req.query.limit, REFUND_PAGE_SIZE_DEFAULT),
      REFUND_PAGE_SIZE_MAX,
    );
    const skip = (page - 1) * limit;

    // where cho danh sách (áp dụng bộ lọc trạng thái + tìm kiếm).
    const where = {};
    if (status) where.status = status;
    if (search) {
      // Tìm theo mã booking, tên khách (user hoặc snapshot) và tên địa điểm snapshot.
      where.OR = [
        { bookingId: { contains: search, mode: 'insensitive' } },
        { booking: { fullName: { contains: search, mode: 'insensitive' } } },
        { booking: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
        { booking: { snapshotAttractionTitle: { contains: search, mode: 'insensitive' } } },
        { targetBookingId: { contains: search, mode: 'insensitive' } },
        { targetBooking: { fullName: { contains: search, mode: 'insensitive' } } },
        { targetBooking: { snapshotAttractionTitle: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Chạy song song: trang dữ liệu, tổng số bản ghi khớp filter, và thống kê
    // theo trạng thái trên TOÀN BỘ (không lọc) để các thẻ thống kê không bị lệch.
    const [requests, total, statusGroups] = await Promise.all([
      prisma.refundRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          refundTransactions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              gateway: true,
              amount: true,
              transactionType: true,
              paymentId: true,
              gatewayResponseCode: true,
              gatewayTransactionStatus: true,
              gatewayTransactionId: true,
              processedAt: true,
              payment: {
                select: {
                  transactionId: true,
                },
              },
            },
          },
          booking: {
            include: {
              user: { select: { fullName: true, email: true } },
              payments: {
                where: { status: 'SUCCESS' },
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  amount: true,
                  paymentGateway: true,
                  status: true,
                  isDuplicate: true,
                  transactionId: true,
                  rawResponse: true,
                },
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
          targetBooking: {
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
      }),
      prisma.refundRequest.count({ where }),
      prisma.refundRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const statusCounts = { PENDING: 0, PROCESSING: 0, APPROVED: 0, REJECTED: 0 };
    for (const group of statusGroups || []) {
      if (group.status in statusCounts) {
        statusCounts[group.status] = group._count?._all || 0;
      }
    }
    const stats = {
      total: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
      pending: statusCounts.PENDING,
      processing: statusCounts.PROCESSING,
      approved: statusCounts.APPROVED,
      rejected: statusCounts.REJECTED,
    };

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      success: true,
      data: requests.map((request) => ({
        ...request,
        booking: {
          ...request.booking,
          payments: request.booking.payments.map((payment) => ({
            id: payment.id,
            amount: payment.amount,
            paymentGateway: payment.paymentGateway,
            status: payment.status,
            isDuplicate: payment.isDuplicate,
          })),
        },
        processingEligibility: getRefundProcessingEligibility(
          findRefundTargetPayment(request),
        ),
        customerBooking: request.targetBooking || request.booking,
      })),
      pagination: { page, limit, total, totalPages },
      stats,
    });
  } catch (error) {
    return next(error);
  }
}

async function processRefundRequest(req, res, next) {
  let refundClaimed = false;
  let keepProcessing = false;
  let claimedRefundId = null;

  try {
    assertPlatformRefundStaff(req.user);

    const { refundId } = req.params;
    const action = String(req.body?.action || '').trim().toUpperCase();
    const staffNotes = String(req.body?.staffNotes || '').trim() || null;
    const manualReference = String(req.body?.manualReference || '').trim();
    if (!REFUND_ACTIONS.has(action)) {
      throw httpError(400, 'action phải là APPROVED hoặc REJECTED.');
    }
    if (action === 'REJECTED' && !staffNotes) {
      throw httpError(400, 'Vui lòng nhập lý do từ chối để thông báo cho khách hàng.');
    }
    if (staffNotes && staffNotes.length > 2000) {
      throw httpError(400, 'Ghi chú xử lý không được vượt quá 2000 ký tự.');
    }

    const refundRequest = await prisma.refundRequest.findUnique({
      where: { id: refundId },
      include: {
        booking: {
          include: {
            user: { select: { fullName: true, email: true } },
            payments: {
              where: { status: 'SUCCESS' },
              orderBy: { createdAt: 'asc' },
            },
            refundTransactions: true,
          },
        },
        targetBooking: {
          include: {
            user: { select: { fullName: true, email: true } },
          },
        },
        refundTransactions: {
          orderBy: { createdAt: 'desc' },
          include: { payment: true },
        },
      },
    });

    if (!refundRequest) throw httpError(404, 'Không tìm thấy yêu cầu hoàn tiền.');
    if (refundRequest.status !== 'PENDING') {
      throw httpError(409, 'Yêu cầu này không còn ở trạng thái chờ xử lý.');
    }
    const customerBooking = refundRequest.targetBooking || refundRequest.booking;
    if (customerBooking.status === 'REFUNDED' && refundRequest.type !== 'DUPLICATE_PAYMENT') {
      throw httpError(409, 'Đơn đặt vé này đã được hoàn tiền.');
    }
    if (action === 'REJECTED' && isMandatoryRefundRequest(refundRequest)) {
      throw httpError(400, 'Không thể từ chối yêu cầu hoàn tiền bắt buộc.');
    }
    if (
      action === 'APPROVED'
      && String(refundRequest.requestKey || '').startsWith('recovery-customer:')
    ) {
      const earlierMandatoryRefunds = await prisma.refundRequest.count({
        where: {
          bookingId: refundRequest.bookingId,
          id: { not: refundRequest.id },
          mandatory: true,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
      });
      if (earlierMandatoryRefunds > 0) {
        throw httpError(
          409,
          'Cần hoàn tất khoản hoàn chênh lệch Rescue trước khi xử lý yêu cầu hủy vé thay thế.',
        );
      }
    }

    const payment = action === 'APPROVED'
      ? findRefundTargetPayment(refundRequest)
      : null;
    if (action === 'APPROVED' && !payment) {
      throw httpError(422, 'Không tìm thấy giao dịch thanh toán thành công tương ứng để hoàn tiền.');
    }
    const processingEligibility = getRefundProcessingEligibility(payment);
    const isManualBankTransfer = processingEligibility.mode === 'MANUAL_BANK_TRANSFER';
    if (
      action === 'APPROVED'
      && isManualBankTransfer
      && !/^[A-Za-z0-9][A-Za-z0-9._/-]{5,99}$/.test(manualReference)
    ) {
      throw httpError(
        400,
        'Vui lòng nhập mã tham chiếu chuyển khoản hoàn tiền hợp lệ (6-100 ký tự).',
      );
    }

    const claimed = await prisma.refundRequest.updateMany({
      where: { id: refundId, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        processedById: req.user.id,
        processingStartedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw httpError(409, 'Yêu cầu vừa được một nhân viên khác tiếp nhận.');
    }
    refundClaimed = true;
    claimedRefundId = refundId;

    if (action === 'REJECTED') {
      const updated = await prisma.$transaction(async (tx) => {
        const fresh = await tx.refundRequest.findUnique({
          where: { id: refundId },
          include: { booking: true, targetBooking: true },
        });
        if (!fresh || fresh.status !== 'PROCESSING') {
          throw httpError(409, 'Yêu cầu không còn ở trạng thái đang xử lý.');
        }
        if (isMandatoryRefundRequest(fresh)) {
          throw httpError(400, 'Không thể từ chối yêu cầu hoàn tiền bắt buộc.');
        }
        const freshCustomerBooking = fresh.targetBooking || fresh.booking;
        if (freshCustomerBooking.status === 'REFUND_REQUESTED') {
          await tx.booking.update({
            where: { id: freshCustomerBooking.id },
            data: {
              status: fresh.bookingStatusBeforeRequest || 'CONFIRMED',
              refundRequired: false,
            },
          });
        }
        return tx.refundRequest.update({
          where: { id: refundId },
          data: {
            status: 'REJECTED',
            staffNotes,
            processedById: req.user.id,
            processedAt: new Date(),
            processingStartedAt: null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      refundClaimed = false;

      await writeAuditLog({
        req,
        action: 'REFUND_REQUEST_REJECTED',
        entityType: 'RefundRequest',
        entityId: refundId,
        metadata: { bookingId: refundRequest.bookingId, staffNotes },
      });
      await sendRefundStatusEmail({
        to: customerBooking.user.email,
        fullName: customerBooking.user.fullName,
        bookingId: customerBooking.id,
        action: 'REJECTED',
        refundAmount: Number(refundRequest.amount),
        staffNotes,
      }).catch((emailError) => {
        console.error('[staff-refund] Không thể gửi email:', emailError.message);
      });
      emitRefundLifecycleRealtime(refundRequest, {
        status: 'REJECTED',
        amount: refundRequest.amount,
        bookingStatus: refundRequest.bookingStatusBeforeRequest || 'CONFIRMED',
        message: 'Yêu cầu hoàn tiền đã bị từ chối và đơn đã được khôi phục.',
      });
      return res.json({ success: true, data: updated });
    }

    const existingSuccess = refundRequest.refundTransactions.find(
      (transaction) => transaction.status === 'SUCCESS',
    );
    const existingUncertain = refundRequest.refundTransactions.find((transaction) =>
      ['PENDING', 'PROCESSING', 'NEEDS_RECONCILIATION'].includes(transaction.status),
    );
    if (existingUncertain) {
      keepProcessing = true;
      refundClaimed = false;
      return res.status(202).json({
        success: true,
        data: {
          status: 'PROCESSING',
          requiresReconciliation: true,
          transactionId: existingUncertain.id,
        },
        message: 'Khoản hoàn đang được xử lý hoặc cần đối soát, hệ thống không gửi lại yêu cầu.',
      });
    }

    let refundTransaction = existingSuccess;
    let gatewayResult = null;
    if (!refundTransaction) {
      const { requestedAmount, capturedAmount } = assertRefundCanBeSubmitted({
        refundRequest,
        payment,
        transactions: refundRequest.booking.refundTransactions,
      });
      const transactionType = isManualBankTransfer
        ? 'MANUAL'
        : requestedAmount >= capturedAmount ? '02' : '03';
      const orderInfo = refundRequest.type === 'DUPLICATE_PAYMENT'
        ? `Hoan tien giao dich trung don hang ${refundRequest.booking.id}`
        : `Hoan tien don hang ${refundRequest.booking.id}`;

      refundTransaction = await createRefundTransactionWithPaymentLock({
        refundRequest,
        payment,
        userId: req.user.id,
        transactionType,
        requestedAmount,
        reason: refundRequest.reason,
        orderInfo,
        isManualBankTransfer,
        manualReference,
      });

      if (!isManualBankTransfer) {
        try {
          if (isLocalDemoPayment(payment)) {
            // Deterministic local-only gateway adapter for the defense fixture.
            // Production can never enter this branch; real payments still use VNPay.
            gatewayResult = {
              success: true,
              responseCode: '00',
              transactionStatus: '00',
              message: 'Giao dịch hoàn tiền thành công.',
              rawRequest: {
                vnp_RequestId: refundTransaction.gatewayRequestId,
                vnp_TxnRef: payment.transactionId,
                vnp_Amount: requestedAmount * 100,
              },
              raw: {
                vnp_ResponseCode: '00',
                vnp_TransactionStatus: '00',
                vnp_TransactionNo: String(Date.now()).slice(-12),
              },
            };
          } else {
            gatewayResult = await refundViaVnpay({
              payment,
              amount: requestedAmount,
              transactionType,
              createBy: req.user.email,
              ipAddr: getClientIp(req),
              orderInfo,
              requestId: refundTransaction.gatewayRequestId,
            });
          }
        } catch (gatewayError) {
          if (gatewayError.gatewayAttempted !== true) {
            await prisma.$transaction(async (tx) => {
              const failed = await casRefundTransactionUpdate(
                tx,
                refundTransaction.id,
                'PROCESSING',
                {
                  status: 'FAILED',
                  rawResponse: { error: gatewayError.message },
                  processedAt: new Date(),
                },
              );
              if (failed.count !== 1) return;
              await casRefundRequestUpdate(tx, refundId, ['PROCESSING'], {
                status: 'PENDING',
                processedById: null,
                processingStartedAt: null,
                staffNotes: `Không thể gửi yêu cầu sang VNPay: ${gatewayError.message}`,
              });
            });
            refundClaimed = false;
            throw gatewayError;
          }
          keepProcessing = true;
          refundClaimed = false;
          await casRootRefundTransactionUpdate(refundTransaction.id, 'PROCESSING', {
            status: 'NEEDS_RECONCILIATION',
            rawResponse: { error: gatewayError.message },
            submittedAt: new Date(),
            processedAt: new Date(),
          });
          return res.status(202).json({
            success: true,
            data: { status: 'PROCESSING', requiresReconciliation: true },
            message: 'Chưa xác định được kết quả từ VNPay. Yêu cầu đã chuyển sang đối soát và sẽ không bị gửi lặp.',
          });
        }
      }

      const gatewayOutcome = isManualBankTransfer
        ? REFUND_GATEWAY_OUTCOME.SUCCESS
        : classifyVnpayRefundResult(gatewayResult);
      if (!isManualBankTransfer && gatewayOutcome === REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION) {
        keepProcessing = true;
        refundClaimed = false;
        await casRootRefundTransactionUpdate(refundTransaction.id, 'PROCESSING', {
          status: 'NEEDS_RECONCILIATION',
          ...buildGatewayTransactionData(gatewayResult),
          processedAt: new Date(),
        });
        return res.status(202).json({
          success: true,
          data: { status: 'PROCESSING', requiresReconciliation: true },
          message: 'VNPay đang xử lý khoản hoàn. Hệ thống sẽ đối soát trước khi cập nhật hoàn tất.',
        });
      }
      if (!isManualBankTransfer && gatewayOutcome === REFUND_GATEWAY_OUTCOME.FAILED) {
        await prisma.$transaction(async (tx) => {
          const failed = await casRefundTransactionUpdate(
            tx,
            refundTransaction.id,
            'PROCESSING',
            {
              status: 'FAILED',
              ...buildGatewayTransactionData(gatewayResult),
              processedAt: new Date(),
            },
          );
          if (failed.count !== 1) return;
          await casRefundRequestUpdate(tx, refundId, ['PROCESSING'], {
              status: 'PENDING',
              processedById: null,
              processingStartedAt: null,
              staffNotes: `VNPay từ chối: ${gatewayResult.responseCode || 'N/A'} ${gatewayResult.message || ''}`.trim(),
          });
        });
        refundClaimed = false;
        throw httpError(
          502,
          `VNPay từ chối hoàn tiền (mã ${gatewayResult.responseCode || 'N/A'}). ${gatewayResult.message || ''}`.trim(),
        );
      }
    }

    const finalStaffNotes = [
      staffNotes,
      isManualBankTransfer
        ? `Đã xác nhận hoàn qua chuyển khoản ngân hàng, mã tham chiếu ${manualReference}.`
        : gatewayResult
        ? `VNPay refund ${gatewayResult.responseCode}/${gatewayResult.transactionStatus}`
        : 'Đã đối soát giao dịch hoàn thành trước đó.',
    ].filter(Boolean).join(' | ');

    let updated;
    try {
      updated = await prisma.$transaction(
        (tx) => finalizeSuccessfulRefund(tx, {
          refundRequestId: refundId,
          refundTransactionId: refundTransaction.id,
          processedById: req.user.id,
          staffNotes: finalStaffNotes,
          gatewayResult,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      refundClaimed = false;
    } catch (finalizeError) {
      keepProcessing = true;
      refundClaimed = false;
      await casRootRefundTransactionUpdate(
        refundTransaction.id,
        'PROCESSING',
        {
          status: 'NEEDS_RECONCILIATION',
          ...(gatewayResult ? buildGatewayTransactionData(gatewayResult) : {}),
          processedAt: new Date(),
        },
      ).catch(() => {});
      throw finalizeError;
    }

    await writeAuditLog({
      req,
      action: 'REFUND_REQUEST_APPROVED',
      entityType: 'RefundRequest',
      entityId: refundId,
      metadata: {
        bookingId: refundRequest.bookingId,
        amount: Number(refundRequest.amount),
        transactionId: refundTransaction.id,
      },
    });
    const notificationEmailSent = await sendRefundStatusEmail({
      to: customerBooking.user.email,
      fullName: customerBooking.user.fullName,
      bookingId: customerBooking.id,
      action: 'APPROVED',
      refundAmount: Number(refundRequest.amount),
      staffNotes,
    }).then(() => true).catch((emailError) => {
      console.error('[staff-refund] Không thể gửi email:', emailError.message);
      return false;
    });
    emitRefundLifecycleRealtime(refundRequest, {
      status: 'APPROVED',
      amount: refundRequest.amount,
      bookingStatus: 'REFUNDED',
      message: 'Khoản hoàn tiền đã được cổng thanh toán xác nhận.',
    });
    if (notificationEmailSent) {
      await markRefundNotificationDelivered(prisma, {
        refundRequestId: refundId,
        status: 'APPROVED',
      }).catch((outboxError) => {
        console.error('[staff-refund] Không thể chốt outbox thông báo:', outboxError.message);
      });
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    if (refundClaimed && !keepProcessing && claimedRefundId) {
      await prisma.refundRequest.updateMany({
        where: { id: claimedRefundId, status: 'PROCESSING' },
        data: {
          status: 'PENDING',
          processedById: null,
          processingStartedAt: null,
        },
      }).catch((releaseError) => {
        console.error(`[staff-refund] Không thể trả yêu cầu ${claimedRefundId} về hàng đợi:`, releaseError.message);
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { message: error.message },
      });
    }
    return next(error);
  }
}

async function reconcileRefundRequest(req, res, next) {
  try {
    assertPlatformRefundStaff(req.user);
    const { refundId } = req.params;
    const refundRequest = await prisma.refundRequest.findUnique({
      where: { id: refundId },
      include: {
        booking: { include: { user: { select: { fullName: true, email: true } } } },
        targetBooking: { include: { user: { select: { fullName: true, email: true } } } },
        refundTransactions: {
          where: { status: { in: ['PROCESSING', 'NEEDS_RECONCILIATION'] } },
          orderBy: { createdAt: 'desc' },
          include: { payment: true },
        },
      },
    });
    if (!refundRequest) throw httpError(404, 'Không tìm thấy yêu cầu hoàn tiền.');
    if (refundRequest.status !== 'PROCESSING') {
      throw httpError(409, 'Chỉ yêu cầu đang xử lý mới có thể đối soát.');
    }

    const refundTransaction = refundRequest.refundTransactions[0];
    if (!refundTransaction?.payment) {
      throw httpError(422, 'Không tìm thấy giao dịch hoàn cần đối soát.');
    }

    if (refundTransaction.gateway === 'BANK_TRANSFER_MANUAL') {
      const customerBooking = refundRequest.targetBooking || refundRequest.booking;
      const updated = await prisma.$transaction(
        (tx) => finalizeSuccessfulRefund(tx, {
          refundRequestId: refundId,
          refundTransactionId: refundTransaction.id,
          processedById: req.user.id,
          staffNotes: `Đã khôi phục xử lý khoản hoàn chuyển khoản thủ công, mã tham chiếu ${refundTransaction.gatewayTransactionId || 'N/A'}.`,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await writeAuditLog({
        req,
        action: 'MANUAL_BANK_REFUND_RECONCILED',
        entityType: 'RefundRequest',
        entityId: refundId,
        metadata: {
          bookingId: refundRequest.bookingId,
          transactionId: refundTransaction.id,
          manualReference: refundTransaction.gatewayTransactionId,
        },
      });
      await sendRefundStatusEmail({
        to: customerBooking.user.email,
        fullName: customerBooking.user.fullName,
        bookingId: customerBooking.id,
        action: 'APPROVED',
        refundAmount: Number(refundRequest.amount),
        staffNotes: refundRequest.staffNotes,
      }).catch((emailError) => {
        console.error('[staff-refund] Không thể gửi email:', emailError.message);
      });
      return res.json({
        success: true,
        data: updated,
        message: 'Đã hoàn tất đối soát khoản hoàn chuyển khoản ngân hàng.',
      });
    }

    let queryResult;
    try {
      queryResult = await queryVnpayTransaction({
        payment: refundTransaction.payment,
        ipAddr: getClientIp(req),
        orderInfo: `Doi soat hoan tien don hang ${refundRequest.bookingId}`,
      });
    } catch (queryError) {
      await casRootRefundTransactionUpdate(
        refundTransaction.id,
        refundTransaction.status,
        {
          status: 'NEEDS_RECONCILIATION',
          reconciledAt: new Date(),
        },
      );
      throw queryError;
    }

    const outcome = classifyVnpayReconciliationResult(queryResult, refundTransaction);
    const reconciliationGatewayTransactionId = String(
      queryResult.raw?.vnp_TransactionNo || '',
    ).trim();
    const reconciliationData = {
      gatewayResponseCode: queryResult.responseCode,
      gatewayTransactionStatus: queryResult.transactionStatus,
      // A later QueryDR may omit the refund transaction number. Preserve the
      // identity captured on the original refund response instead of replacing
      // it with NULL and losing the strongest reconciliation evidence.
      gatewayTransactionId: reconciliationGatewayTransactionId
        || refundTransaction.gatewayTransactionId
        || null,
      rawResponse: {
        ...(refundTransaction.rawResponse || {}),
        reconciliation: queryResult.raw,
      },
      reconciledAt: new Date(),
    };

    if (outcome === REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION) {
      await casRootRefundTransactionUpdate(
        refundTransaction.id,
        refundTransaction.status,
        { status: 'NEEDS_RECONCILIATION', ...reconciliationData },
      );
      return res.status(202).json({
        success: true,
        data: { status: 'PROCESSING', requiresReconciliation: true },
        message: 'VNPay chưa xác nhận khoản hoàn hoàn tất. Yêu cầu tiếp tục chờ đối soát.',
      });
    }

    if (outcome === REFUND_GATEWAY_OUTCOME.FAILED) {
      await prisma.$transaction(async (tx) => {
        const failed = await casRefundTransactionUpdate(
          tx,
          refundTransaction.id,
          refundTransaction.status,
          { status: 'FAILED', ...reconciliationData, processedAt: new Date() },
        );
        if (failed.count !== 1) return;
        await casRefundRequestUpdate(tx, refundId, ['PROCESSING'], {
            status: 'PENDING',
            processedById: null,
            processingStartedAt: null,
            staffNotes: 'Đối soát xác nhận VNPay từ chối khoản hoàn. Có thể kiểm tra và thử lại.',
        });
      });
      return res.json({
        success: true,
        data: { status: 'PENDING', requiresReconciliation: false },
        message: 'VNPay xác nhận khoản hoàn bị từ chối. Yêu cầu đã trở lại hàng chờ.',
      });
    }

    const updated = await prisma.$transaction(
      async (tx) => {
        const marked = await casRefundTransactionUpdate(
          tx,
          refundTransaction.id,
          refundTransaction.status,
          reconciliationData,
        );
        if (marked.count !== 1) {
          throw httpError(409, 'Giao dá»‹ch hoÃ n tiá»n vá»«a Ä‘Æ°á»£c cáº­p nháº­t. Vui lÃ²ng táº£i láº¡i.');
        }
        return finalizeSuccessfulRefund(tx, {
          refundRequestId: refundId,
          refundTransactionId: refundTransaction.id,
          processedById: req.user.id,
          staffNotes: 'Đã xác nhận hoàn tiền thành công qua đối soát VNPay.',
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await writeAuditLog({
      req,
      action: 'REFUND_RECONCILED_SUCCESS',
      entityType: 'RefundRequest',
      entityId: refundId,
      metadata: {
        bookingId: refundRequest.bookingId,
        transactionId: refundTransaction.id,
        amount: Number(refundRequest.amount),
      },
    });
    const customerBooking = refundRequest.targetBooking || refundRequest.booking;
    const notificationEmailSent = await sendRefundStatusEmail({
      to: customerBooking.user.email,
      fullName: customerBooking.user.fullName,
      bookingId: customerBooking.id,
      action: 'APPROVED',
      refundAmount: Number(refundRequest.amount),
      staffNotes: 'Khoản hoàn đã được VNPay xác nhận thành công.',
    }).then(() => true).catch((emailError) => {
      console.error('[staff-refund] Không thể gửi email đối soát:', emailError.message);
      return false;
    });
    emitRefundLifecycleRealtime(refundRequest, {
      status: 'APPROVED',
      amount: refundRequest.amount,
      bookingStatus: 'REFUNDED',
      message: 'Khoản hoàn tiền đã được VNPay xác nhận thành công.',
    });
    if (notificationEmailSent) {
      await markRefundNotificationDelivered(prisma, {
        refundRequestId: refundId,
        status: 'APPROVED',
      }).catch((outboxError) => {
        console.error('[staff-refund] Không thể chốt outbox đối soát:', outboxError.message);
      });
    }

    return res.json({ success: true, data: updated });
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

async function adjudicateRefundRequest(req, res, next) {
  try {
    assertAdminRefundStaff(req.user);
    const { refundId } = req.params;
    const request = await prisma.refundRequest.findUnique({
      where: { id: refundId },
      include: {
        booking: {
          include: {
            user: { select: { fullName: true, email: true } },
          },
        },
        targetBooking: {
          include: {
            user: { select: { fullName: true, email: true } },
          },
        },
        refundTransactions: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { payment: true },
        },
      },
    });
    if (!request) throw httpError(404, 'Không tìm thấy yêu cầu hoàn tiền.');

    const activeTransactions = request.refundTransactions.filter((transaction) =>
      ['PROCESSING', 'NEEDS_RECONCILIATION'].includes(transaction.status));
    const alreadySuccessful = request.refundTransactions.find(
      (transaction) => transaction.status === 'SUCCESS',
    );
    const alreadyFailed = request.refundTransactions.find((transaction) => (
      transaction.status === 'FAILED'
      && transaction.rawResponse?.manualAdjudication?.outcome === 'FAILED'
    ));
    const candidate = activeTransactions[0] || alreadySuccessful || alreadyFailed;
    if (!candidate?.payment) {
      throw httpError(422, 'Không tìm thấy giao dịch hoàn có thanh toán gốc để xác minh.');
    }
    const evidence = parseManualRefundEvidence(req.body, candidate);

    // Replaying the same signed-off evidence is safe and useful when the
    // operator did not receive the previous HTTP response. A different
    // identity must never be accepted for an already-finalized refund.
    if (request.status === 'APPROVED' && alreadySuccessful) {
      if (
        evidence.decision === 'SUCCESS'
        && evidence.gatewayTransactionId === alreadySuccessful.gatewayTransactionId
      ) {
        return res.json({
          success: true,
          idempotent: true,
          data: request,
          message: 'Khoản hoàn đã được xác nhận trước đó bằng đúng mã giao dịch này.',
        });
      }
      throw httpError(409, 'Khoản hoàn đã hoàn tất với bằng chứng giao dịch khác.');
    }
    if (request.status === 'PENDING' && alreadyFailed) {
      const priorEvidence = alreadyFailed.rawResponse.manualAdjudication;
      if (
        evidence.decision === 'FAILED'
        && evidence.evidenceAmount === Number(priorEvidence.confirmAmount)
        && evidence.transactionType === priorEvidence.transactionType
        && evidence.paymentTransactionRef === priorEvidence.paymentTransactionRef
        && evidence.gatewayTransactionId === (priorEvidence.gatewayTransactionId || null)
      ) {
        return res.json({
          success: true,
          idempotent: true,
          data: request,
          message: 'Kết quả chưa hoàn thành đã được ghi nhận trước đó bằng đúng bằng chứng này.',
        });
      }
      throw httpError(409, 'Lần hoàn trước đã được phân xử bằng bằng chứng khác.');
    }

    if (request.status !== 'PROCESSING') {
      throw httpError(409, 'Chỉ yêu cầu đang đối soát mới có thể được phân xử thủ công.');
    }
    if (activeTransactions.length !== 1) {
      throw httpError(
        409,
        'Yêu cầu phải có đúng một giao dịch đang chờ đối soát trước khi phân xử thủ công.',
      );
    }

    const adjudicatedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`
          SELECT "id"
          FROM "RefundRequest"
          WHERE "id" = ${refundId}
          FOR UPDATE
        `;
      }
      await lockPaymentForRefund(tx, candidate.paymentId);

      const freshRequest = await tx.refundRequest.findUnique({
        where: { id: refundId },
        include: {
          booking: true,
          refundTransactions: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { payment: true },
          },
        },
      });
      if (!freshRequest || freshRequest.status !== 'PROCESSING') {
        throw httpError(409, 'Yêu cầu vừa được tác vụ khác cập nhật. Vui lòng tải lại.');
      }
      const freshActive = freshRequest.refundTransactions.filter((transaction) =>
        ['PROCESSING', 'NEEDS_RECONCILIATION'].includes(transaction.status));
      if (freshActive.length !== 1 || freshActive[0].id !== candidate.id) {
        throw httpError(409, 'Giao dịch đối soát vừa thay đổi. Vui lòng tải lại.');
      }
      const freshTransaction = freshActive[0];
      const freshEvidence = parseManualRefundEvidence(req.body, freshTransaction);
      const previousRawResponse = (
        freshTransaction.rawResponse
        && typeof freshTransaction.rawResponse === 'object'
        && !Array.isArray(freshTransaction.rawResponse)
      )
        ? freshTransaction.rawResponse
        : {};
      const manualEvidence = {
        outcome: freshEvidence.decision,
        evidenceNote: freshEvidence.evidenceNote,
        confirmAmount: freshEvidence.evidenceAmount,
        transactionType: freshEvidence.transactionType,
        paymentTransactionRef: freshEvidence.paymentTransactionRef,
        gatewayTransactionId: freshEvidence.gatewayTransactionId,
        gatewayResponseCode: freshEvidence.responseCode,
        gatewayTransactionStatus: freshEvidence.transactionStatus,
        adjudicatedById: req.user.id,
        adjudicatedAt: adjudicatedAt.toISOString(),
      };

      if (freshEvidence.decision === 'SUCCESS') {
        const duplicateIdentity = await tx.refundTransaction.findFirst({
          where: {
            gateway: freshTransaction.gateway || 'VNPAY',
            gatewayTransactionId: freshEvidence.gatewayTransactionId,
            id: { not: freshTransaction.id },
          },
          select: { id: true, refundRequestId: true },
        });
        if (duplicateIdentity) {
          throw httpError(
            409,
            'Mã giao dịch hoàn VNPay này đã thuộc một yêu cầu khác; không thể dùng lại.',
          );
        }

        const marked = await tx.refundTransaction.updateMany({
          where: { id: freshTransaction.id, status: freshTransaction.status },
          data: {
            gatewayTransactionId: freshEvidence.gatewayTransactionId,
            gatewayResponseCode: freshEvidence.responseCode,
            gatewayTransactionStatus: freshEvidence.transactionStatus,
            rawResponse: {
              ...previousRawResponse,
              manualAdjudication: manualEvidence,
            },
            processedById: req.user.id,
            reconciledAt: adjudicatedAt,
          },
        });
        if (marked.count !== 1) {
          throw httpError(409, 'Giao dịch vừa được tác vụ khác cập nhật. Vui lòng tải lại.');
        }

        const updated = await finalizeSuccessfulRefund(tx, {
          refundRequestId: refundId,
          refundTransactionId: freshTransaction.id,
          processedById: req.user.id,
          staffNotes: `Quản trị viên xác nhận thủ công theo bằng chứng VNPay: ${freshEvidence.evidenceNote}`,
          now: adjudicatedAt,
        });
        await writeAuditLog({
          client: tx,
          req,
          action: 'REFUND_MANUAL_ADJUDICATION_SUCCESS',
          entityType: 'RefundRequest',
          entityId: refundId,
          metadata: {
            bookingId: freshRequest.bookingId,
            refundTransactionId: freshTransaction.id,
            gatewayTransactionId: freshEvidence.gatewayTransactionId,
            amount: freshEvidence.evidenceAmount,
            transactionType: freshEvidence.transactionType,
            paymentTransactionRef: freshEvidence.paymentTransactionRef,
            evidenceNote: freshEvidence.evidenceNote,
          },
        });
        return { outcome: 'SUCCESS', updated, transactionId: freshTransaction.id };
      }

      const failed = await tx.refundTransaction.updateMany({
        where: { id: freshTransaction.id, status: freshTransaction.status },
        data: {
          status: 'FAILED',
          gatewayTransactionId: freshEvidence.gatewayTransactionId,
          gatewayResponseCode: freshEvidence.responseCode,
          gatewayTransactionStatus: freshEvidence.transactionStatus,
          rawResponse: {
            ...previousRawResponse,
            manualAdjudication: manualEvidence,
          },
          processedById: req.user.id,
          reconciledAt: adjudicatedAt,
          processedAt: adjudicatedAt,
        },
      });
      if (failed.count !== 1) {
        throw httpError(409, 'Giao dịch vừa được tác vụ khác cập nhật. Vui lòng tải lại.');
      }
      const reopened = await tx.refundRequest.updateMany({
        where: { id: refundId, status: 'PROCESSING' },
        data: {
          status: 'PENDING',
          processedById: null,
          processingStartedAt: null,
          staffNotes: `Quản trị viên xác nhận giao dịch hoàn chưa thành công: ${freshEvidence.evidenceNote}`,
        },
      });
      if (reopened.count !== 1) {
        throw httpError(409, 'Yêu cầu vừa được tác vụ khác cập nhật. Vui lòng tải lại.');
      }
      await writeAuditLog({
        client: tx,
        req,
        action: 'REFUND_MANUAL_ADJUDICATION_FAILED',
        entityType: 'RefundRequest',
        entityId: refundId,
        metadata: {
          bookingId: freshRequest.bookingId,
          refundTransactionId: freshTransaction.id,
          gatewayTransactionId: freshEvidence.gatewayTransactionId,
          amount: freshEvidence.evidenceAmount,
          transactionType: freshEvidence.transactionType,
          paymentTransactionRef: freshEvidence.paymentTransactionRef,
          evidenceNote: freshEvidence.evidenceNote,
        },
      });
      return {
        outcome: 'FAILED',
        updated: { id: refundId, status: 'PENDING' },
        transactionId: freshTransaction.id,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const customerBooking = request.targetBooking || request.booking;
    if (result.outcome === 'SUCCESS') {
      const notificationEmailSent = await sendRefundStatusEmail({
        to: customerBooking.user?.email || customerBooking.email,
        fullName: customerBooking.user?.fullName || customerBooking.fullName,
        bookingId: customerBooking.id,
        action: 'APPROVED',
        refundAmount: Number(request.amount),
        staffNotes: 'Khoản hoàn đã được xác minh bằng chứng VNPay bởi quản trị viên.',
      }).then(() => true).catch((emailError) => {
        console.error('[staff-refund] Không thể gửi email phân xử:', emailError.message);
        return false;
      });
      emitRefundLifecycleRealtime(request, {
        status: 'APPROVED',
        amount: request.amount,
        bookingStatus: 'REFUNDED',
        message: 'Khoản hoàn tiền đã được quản trị viên xác minh từ bằng chứng VNPay.',
      });
      if (notificationEmailSent) {
        await markRefundNotificationDelivered(prisma, {
          refundRequestId: refundId,
          status: 'APPROVED',
        }).catch((outboxError) => {
          console.error('[staff-refund] Không thể chốt outbox phân xử:', outboxError.message);
        });
      }
      return res.json({
        success: true,
        data: result.updated,
        message: 'Đã xác nhận khoản hoàn thành công bằng bằng chứng đối soát.',
      });
    }

    emitRefundLifecycleRealtime(request, {
      status: 'PENDING',
      amount: request.amount,
      message: 'Đối soát xác nhận lần hoàn trước chưa thành công; yêu cầu đã trở lại hàng chờ an toàn.',
    });
    return res.json({
      success: true,
      data: result.updated,
      message: 'Đã ghi nhận giao dịch chưa thành công và đưa yêu cầu trở lại hàng chờ.',
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: {
          message: 'Mã giao dịch hoàn VNPay này đã được gắn với một yêu cầu khác.',
        },
      });
    }
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
    const reasonCode = String(req.body?.reasonCode || '').trim().toUpperCase();
    const reason = String(req.body?.reason || '').trim();

    if (!REISSUE_REASON_CODES.has(reasonCode)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vui lòng chọn lý do cấp lại vé hợp lệ.' },
      });
    }
    if (reason.length < 5 || reason.length > 500) {
      return res.status(400).json({
        success: false,
        error: { message: 'Mô tả cấp lại vé phải từ 5 đến 500 ký tự.' },
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            user: { select: { fullName: true, email: true } },
            ticketInstances: { where: { status: 'VALID' } },
            reservation: {
              include: {
                timeSlot: true,
                ticketProduct: {
                  include: {
                    attraction: {
                      select: {
                        id: true,
                        openTime: true,
                        closeTime: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!booking || booking.isForecastTrainingSample) {
          throw httpError(404, 'Không tìm thấy đơn đặt vé.');
        }

        // Chỉ staff được phân công địa điểm của đơn (hoặc admin) mới được cấp lại vé.
        const attractionId =
          booking.reservation?.ticketProduct?.attraction?.id
          || booking.snapshotAttractionId
          || null;
        await assertStaffAttractionAccess(tx, req.user, attractionId);

        if (booking.status !== 'CONFIRMED') {
          throw httpError(409, 'Chỉ có thể cấp lại vé cho đơn đã xác nhận.');
        }
        if (!booking.ticketInstances.length) {
          throw httpError(400, 'Đơn hàng này không có vé điện tử còn hiệu lực.');
        }

        const { endsAt } = getBookingActivityWindow(booking);
        if (endsAt && new Date() > endsAt) {
          throw httpError(409, 'Không thể cấp lại vé sau khi thời gian tham quan đã kết thúc.');
        }

        const expired = await tx.ticketInstance.updateMany({
          where: { bookingId, status: 'VALID' },
          data: { status: 'EXPIRED' },
        });
        if (expired.count !== booking.ticketInstances.length) {
          throw httpError(409, 'Vé vừa được thay đổi bởi một nhân viên khác. Vui lòng tải lại.');
        }

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

        await writeAuditLog({
          client: tx,
          req,
          actorId: req.user.id,
          action: 'TICKET_REISSUED',
          entityType: 'Booking',
          entityId: bookingId,
          metadata: {
            bookingId,
            attractionId,
            reasonCode,
            reason,
            replacedTicketInstanceIds: booking.ticketInstances.map((ticket) => ticket.id),
            newTicketInstanceIds: newInstances.map((ticket) => ticket.id),
            ticketCount: newInstances.length,
          },
        });

        return { booking, newInstances };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    let emailDelivered = true;
    try {
      await sendReissueTicketEmail({
        to: result.booking.user.email,
        fullName: result.booking.user.fullName,
        bookingId,
        newTicketCount: result.newInstances.length,
      });
    } catch (emailError) {
      emailDelivered = false;
      console.error('[staff-reissue] Không thể gửi email:', emailError.message);
    }

    return res.json({
      success: true,
      data: {
        bookingId,
        reissuedCount: result.newInstances.length,
        emailDelivered,
      },
      message: 'Đã cấp lại vé thành công.',
    });
  } catch (error) {
    if (error.statusCode || error.code === 'P2034') {
      return res.status(error.statusCode || 409).json({
        success: false,
        error: {
          message: error.code === 'P2034'
            ? 'Vé vừa được cấp lại bởi một nhân viên khác. Vui lòng tải lại.'
            : error.message,
        },
      });
    }
    return next(error);
  }
}

// ─── Check-in tại cổng ──────────────────────────────────────────────────────

// Khách có thể quét nguyên chuỗi trong QR ("VIETTICKET:<token>") hoặc nhập tay token.
// Một số máy quét cầm tay trả về chữ HOA hoặc kèm khoảng trắng thừa.
const QR_TOKEN_PREFIX_PATTERN = /^VIETTICKET:\s*/iu;

function normalizeQrToken(raw) {
  return String(raw || '').trim().replace(QR_TOKEN_PREFIX_PATTERN, '').trim();
}

// Token thật là UUID chữ thường, nhưng nhân viên nhập tay ở cổng rất dễ gõ
// hoa/thường lệch với giá trị trong DB. findUnique khớp tuyệt đối nên trước
// đây gõ lệch kiểu chữ là báo "không tìm thấy vé" dù mã hoàn toàn đúng.
// Vẫn thử findUnique trước để dùng index, chỉ dò không phân biệt hoa/thường
// khi không khớp — nhánh hiếm, không ảnh hưởng đường quét QR thông thường.
async function findTicketInstanceByToken(client, token, include = null) {
  if (!token) return null;
  const query = include ? { include } : {};

  const exact = await client.ticketInstance.findUnique({
    where: { qrCodeToken: token },
    ...query,
  });
  if (exact) return exact;

  return client.ticketInstance.findFirst({
    where: { qrCodeToken: { equals: token, mode: 'insensitive' } },
    ...query,
  });
}

function toCheckinTicket(instance) {
  const booking = instance.booking;
  const reservation = booking.reservation;
  const visitDate = booking.snapshotVisitDate || reservation.date;
  const visitDay = new Date(visitDate).toISOString().slice(0, 10);
  const timeSlot = reservation.timeSlot;
  const admissionCount = Number(booking.snapshotAdmissionCount)
    || getSnapshotAdmissionCount(reservation);

  return {
    bookingId: booking.id,
    bookingStatus: booking.status,
    ticketStatus: instance.status,
    customer: booking.fullName,
    phone: booking.phone,
    attraction:
      booking.snapshotAttractionTitle
      || reservation.ticketProduct.attraction.title,
    ticketName: booking.snapshotTicketName || reservation.ticketProduct.name,
    quantity: 1,
    bookingQuantity: reservation.quantity,
    admissionCount,
    admittedGuests: admissionCount,
    bookingParticipantCount: reservation.quantity * admissionCount,
    visitDate: visitDay,
    timeSlot:
      booking.snapshotTimeSlotLabel
      || (timeSlot ? `${timeSlot.startTime} - ${timeSlot.endTime}` : null),
    checkedInAt: instance.checkedInAt || null,
  };
}

// Lý do KHÔNG được check-in (null = hợp lệ). Thứ tự ưu tiên để thông báo chính xác.
function getCheckinBlockReason(instance, now = new Date()) {
  const booking = instance.booking;
  const attraction = booking?.reservation?.ticketProduct?.attraction;
  const visitDay = new Date(
    booking.snapshotVisitDate || booking.reservation.date,
  ).toISOString().slice(0, 10);
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
  if (attraction?.partner?.status === 'SUSPENDED') {
    return 'Nhà cung cấp đang bị đình chỉ khẩn cấp. Không được tiếp nhận khách; vui lòng chuyển ca này cho bộ phận hỗ trợ.';
  }
  if (attraction?.operationalStatus === 'SUSPENDED') {
    return 'Địa điểm đang bị đình chỉ khẩn cấp. Không được tiếp nhận khách; vui lòng chuyển ca này cho bộ phận hỗ trợ.';
  }
  if (visitDay !== today) {
    return visitDay > today
      ? `Vé dùng cho ngày ${visitDay}, chưa tới ngày tham quan.`
      : `Vé dùng cho ngày ${visitDay}, đã quá ngày tham quan.`;
  }
  const timeBlockReason = getCheckinTimeBlockReason(booking, now);
  if (timeBlockReason) return timeBlockReason;
  return null;
}

// GET /api/staff/checkin/:token — tra cứu vé theo mã QR (chỉ xem, không ghi DB).
async function lookupTicketByQr(req, res, next) {
  try {
    const token = normalizeQrToken(req.params.token);
    if (!token) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu mã vé.' } });
    }

    const instance = await findTicketInstanceByToken(prisma, token, {
      booking: {
        include: {
          reservation: {
            include: {
              timeSlot: true,
              ticketProduct: {
                include: {
                  attraction: {
                    select: {
                      id: true,
                      title: true,
                      openTime: true,
                      closeTime: true,
                      operationalStatus: true,
                      partner: { select: { status: true } },
                    },
                  },
                },
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

    await assertStaffAttractionAccess(
      prisma,
      req.user,
      getTicketAttractionId(instance),
    );

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

// ------------------------------------------------------------
// Tra cứu hợp nhất cho cổng soát vé.
// Nhân viên có thể nhập/quét:
//   - Mã QR của một vé (token UUID, có hoặc không có tiền tố VIETTICKET:)
//   - Mã đặt chỗ in trên vé (VT-XXXXXXXXXXXX) hoặc chính UUID của đơn
// Trả về TẤT CẢ vé trong đơn kèm trạng thái từng vé để nhân viên soát lần lượt
// cho nhóm khách. Không ghi DB; check-in vẫn đi qua POST /checkin/:token.
// ------------------------------------------------------------
const CHECKIN_TICKET_INCLUDE = {
  booking: {
    include: {
      reservation: {
        include: {
          timeSlot: true,
          ticketProduct: {
            include: {
              attraction: {
                select: {
                  id: true,
                  title: true,
                  openTime: true,
                  closeTime: true,
                  operationalStatus: true,
                  partner: { select: { status: true } },
                },
              },
            },
          },
        },
      },
    },
  },
};

const CHECKIN_BOOKING_INCLUDE = {
  reservation: {
    include: {
      timeSlot: true,
      ticketProduct: {
        include: {
          attraction: {
            select: {
              id: true,
              title: true,
              openTime: true,
              closeTime: true,
              operationalStatus: true,
              partner: { select: { status: true } },
            },
          },
        },
      },
    },
  },
  ticketInstances: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mã đặt chỗ hiển thị = "VT-" + 12 ký tự cuối của UUID (viết hoa).
function normalizeBookingReference(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/\s+/gu, '')
    .replace(/^VT[-–—]?/iu, '');
  // Yêu cầu tối thiểu 8 ký tự để không khớp quá rộng khi nhân viên gõ thiếu.
  if (!/^[0-9a-f-]{8,36}$/iu.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

async function findBookingByReference(reference) {
  const normalized = normalizeBookingReference(reference);
  if (!normalized) return null;

  return prisma.booking.findFirst({
    where: {
      isForecastTrainingSample: false,
      ...(UUID_PATTERN.test(normalized)
        ? { id: normalized }
        : { id: { endsWith: normalized, mode: 'insensitive' } }),
    },
    orderBy: { createdAt: 'desc' },
    include: CHECKIN_BOOKING_INCLUDE,
  });
}

function getBookingAttractionId(booking) {
  return booking?.reservation?.ticketProduct?.attraction?.id
    || booking?.reservation?.ticketProduct?.attractionId
    || booking?.snapshotAttractionId
    || null;
}

// Gói dữ liệu trả về: thông tin đơn + trạng thái từng vé.
function buildCheckinLookupPayload(booking, instances, matchedTicketId = null) {
  const tickets = instances.map((instance, index) => {
    // getCheckinBlockReason cần instance.booking -> ghép lại khi duyệt từ booking.
    const withBooking = instance.booking ? instance : { ...instance, booking };
    const blockReason = getCheckinBlockReason(withBooking);
    return {
      ticketId: instance.id,
      token: instance.qrCodeToken,
      index: index + 1,
      status: instance.status,
      checkedInAt: instance.checkedInAt || null,
      canCheckIn: blockReason === null,
      blockReason,
      isMatched: matchedTicketId ? instance.id === matchedTicketId : false,
    };
  });

  const base = toCheckinTicket(
    instances[0]?.booking ? instances[0] : { ...instances[0], booking },
  );

  return {
    ...base,
    matchedTicketId,
    tickets,
    summary: {
      total: tickets.length,
      valid: tickets.filter((ticket) => ticket.status === 'VALID').length,
      used: tickets.filter((ticket) => ticket.status === 'USED').length,
      checkable: tickets.filter((ticket) => ticket.canCheckIn).length,
    },
  };
}

// GET /api/staff/lookup?q=... — tra cứu bằng mã QR HOẶC mã đặt chỗ.
async function lookupCheckinTarget(req, res, next) {
  try {
    const raw = String(req.query.q ?? req.query.code ?? '').trim();
    if (!raw) {
      return res.status(400).json({
        success: false,
        error: { message: 'Vui lòng quét mã QR hoặc nhập mã vé / mã đặt chỗ.' },
      });
    }

    // 1) Ưu tiên khớp chính xác mã QR của một vé.
    const token = normalizeQrToken(raw);
    const instance = await findTicketInstanceByToken(prisma, token, CHECKIN_TICKET_INCLUDE);

    if (instance) {
      if (instance.booking?.isForecastTrainingSample) {
        return res.status(404).json({
          success: false,
          error: { message: 'Không tìm thấy vé với mã này.' },
        });
      }
      await assertStaffAttractionAccess(
        prisma,
        req.user,
        getTicketAttractionId(instance),
      );
      // Lấy toàn bộ vé cùng đơn để nhân viên soát lần lượt cho nhóm khách.
      const siblings = await prisma.ticketInstance.findMany({
        where: { bookingId: instance.bookingId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return res.json({
        success: true,
        data: {
          matchType: 'TICKET',
          ...buildCheckinLookupPayload(instance.booking, siblings, instance.id),
        },
      });
    }

    // 2) Không phải mã QR -> thử mã đặt chỗ (VT-XXXX) hoặc UUID đơn.
    const booking = await findBookingByReference(raw);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: {
          message:
            'Không tìm thấy vé hoặc đơn với mã này. Kiểm tra lại mã QR, mã vé, hoặc mã đặt chỗ dạng VT-XXXXXXXXXXXX.',
        },
      });
    }

    await assertStaffAttractionAccess(prisma, req.user, getBookingAttractionId(booking));

    if (booking.ticketInstances.length === 0) {
      return res.status(409).json({
        success: false,
        error: {
          message: `Đơn này chưa có vé điện tử (trạng thái: ${booking.status}). Chỉ đơn đã xác nhận mới có mã QR.`,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        matchType: 'BOOKING',
        ...buildCheckinLookupPayload(booking, booking.ticketInstances),
      },
    });
  } catch (error) {
    return next(error);
  }
}

// POST /api/staff/checkin/:token — check-in đúng vé được quét.
// Mỗi TicketInstance có QR riêng; quét một QR chỉ được dùng một vé để hỗ trợ
// nhóm khách đến tách lượt và tránh vô tình khóa toàn bộ booking.
async function checkInTicket(req, res, next) {
  try {
    const token = normalizeQrToken(req.params.token);
    if (!token) {
      return res.status(400).json({ success: false, error: { message: 'Thiếu mã vé.' } });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const instance = await findTicketInstanceByToken(tx, token, {
          booking: {
            include: {
              reservation: {
                include: {
                  timeSlot: true,
                  ticketProduct: {
                    include: {
                      attraction: {
                        select: {
                          id: true,
                          title: true,
                          openTime: true,
                          closeTime: true,
                          operationalStatus: true,
                          partner: { select: { status: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!instance) {
          throw httpError(404, 'Không tìm thấy vé với mã này.');
        }

        const attractionId = getTicketAttractionId(instance);
        await assertStaffAttractionAccess(tx, req.user, attractionId);

        const blockReason = getCheckinBlockReason(instance);
        if (blockReason) {
          throw httpError(409, blockReason);
        }

        // updateMany với guard status VALID: hai nhân viên quét cùng lúc thì chỉ
        // một request thực sự check-in, request sau thấy count = 0 -> đã dùng.
        const checkedInAt = new Date();
        const admittedGuestCount = Number(instance.booking.snapshotAdmissionCount)
          || getSnapshotAdmissionCount(instance.booking.reservation);
        const updated = await tx.ticketInstance.updateMany({
          where: { id: instance.id, status: 'VALID' },
          data: {
            status: 'USED',
            checkedInAt,
            checkedInById: req.user.id,
          },
        });
        if (updated.count === 0) {
          throw httpError(409, 'Vé này vừa được check-in bởi một nhân viên khác.');
        }

        // Booking nhiều vé chỉ hoàn tất ngay khi tất cả TicketInstance đều đã USED.
        // Nếu còn vé chưa dùng, booking giữ CONFIRMED và completion worker sẽ quyết định
        // COMPLETED/NO_SHOW sau khi ngày tham quan kết thúc.
        const validTicketCount = await tx.ticketInstance.count({
          where: { bookingId: instance.bookingId, status: 'VALID' },
        });
        let bookingStatus = instance.booking.status;
        if (validTicketCount === 0) {
          const completed = await tx.booking.updateMany({
            where: { id: instance.bookingId, status: 'CONFIRMED' },
            data: { status: 'COMPLETED' },
          });
          if (completed.count === 1) bookingStatus = 'COMPLETED';
        }

        await writeAuditLog({
          client: tx,
          req,
          actorId: req.user.id,
          action: 'TICKET_CHECKED_IN',
          entityType: 'Booking',
          entityId: instance.bookingId,
          metadata: {
            bookingId: instance.bookingId,
            attractionId,
            checkedInCount: updated.count,
            admittedGuestCount,
            ticketInstanceId: instance.id,
          },
        });

        // QR is the admission source of truth. Persist the queue transition in
        // the same transaction as TicketInstance.USED so a concurrent
        // CANCEL/CALL/NO_SHOW can never leave a terminal queue state behind.
        const smartQueue = await markQueueAdmittedForBooking(instance.bookingId, {
          prismaClient: tx,
          admittedAt: checkedInAt,
          emitRealtime: false,
        });

        return {
          instance,
          checkedInCount: updated.count,
          admittedGuestCount,
          checkedInAt,
          bookingStatus,
          smartQueue,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Realtime is deliberately post-commit: clients can only reload a state
    // that is already durable. A socket transport failure never rolls back QR.
    try {
      emitQueueAdmissionUpdates(result.smartQueue?.updates);
    } catch (realtimeError) {
      console.error('[staff-checkin] Không thể phát realtime SmartQueue:', realtimeError.message);
    }

    return res.json({
      success: true,
      message: `Check-in thành công ${result.checkedInCount} vé (${result.admittedGuestCount} khách).`,
      data: {
        ...toCheckinTicket(result.instance),
        ticketStatus: 'USED',
        checkedInCount: result.checkedInCount,
        admittedGuestCount: result.admittedGuestCount,
        checkedInAt: result.checkedInAt,
        checkedInBy: req.user.email,
        bookingStatus: result.bookingStatus,
        smartQueueUpdated: Number(result.smartQueue?.count || 0) > 0,
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
    let assignedAttractionIds = null;

    if (!hasRole(req.user, 'ADMIN')) {
      const assignments = await prisma.staffAttractionAssignment.findMany({
        where: { staffId: req.user.id, revokedAt: null },
        select: { attractionId: true },
      });
      assignedAttractionIds = assignments.map((assignment) => assignment.attractionId);
    }

    const bookings = await prisma.booking.findMany({
      where: {
        isForecastTrainingSample: false,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        reservation: {
          date: todayDate,
          ...(assignedAttractionIds
            ? {
                ticketProduct: {
                  attractionId: { in: assignedAttractionIds },
                },
              }
            : {}),
        },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        ticketInstances: { select: { status: true } },
        reservation: {
          include: {
            timeSlot: true,
            ticketProduct: {
              include: { attraction: { select: { id: true, title: true } } },
            },
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
        attraction:
          b.snapshotAttractionTitle
          || b.reservation.ticketProduct.attraction.title,
        ticketName: b.snapshotTicketName || b.reservation.ticketProduct.name,
        quantity: b.reservation.quantity,
        timeSlot:
          b.snapshotTimeSlotLabel
          || (timeSlot ? `${timeSlot.startTime} - ${timeSlot.endTime}` : null),
        checkedIn: usedCount > 0 && validCount === 0,
        usedCount,
        validCount,
        bookingStatus: b.status,
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

// GET /api/staff/bookings — tra cứu các đơn còn hiệu lực trong 90 ngày tới để
// hỗ trợ cấp lại vé trước ngày sử dụng. Phạm vi địa điểm vẫn bị khóa theo phân công.
async function listOperationalBookings(req, res, next) {
  try {
    const today = todayInVietnam();
    const defaultFrom = new Date(`${today}T00:00:00.000Z`);
    const defaultTo = new Date(defaultFrom.getTime() + 30 * 24 * 60 * 60 * 1000);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const dateFromRaw = String(req.query.dateFrom || '').trim();
    const dateToRaw = String(req.query.dateTo || '').trim();
    if ((dateFromRaw && !datePattern.test(dateFromRaw)) || (dateToRaw && !datePattern.test(dateToRaw))) {
      throw httpError(400, 'Khoảng ngày tra cứu phải có định dạng YYYY-MM-DD.');
    }

    const dateFrom = dateFromRaw ? new Date(`${dateFromRaw}T00:00:00.000Z`) : defaultFrom;
    const dateTo = dateToRaw ? new Date(`${dateToRaw}T00:00:00.000Z`) : defaultTo;
    const maxTo = new Date(defaultFrom.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(dateFrom.getTime())
      || Number.isNaN(dateTo.getTime())
      || dateFrom < defaultFrom
      || dateTo < dateFrom
      || dateTo > maxTo
    ) {
      throw httpError(400, 'Chỉ có thể tra cứu đơn từ hôm nay đến tối đa 90 ngày tới.');
    }

    let assignedAttractionIds = null;
    if (!hasRole(req.user, 'ADMIN')) {
      const assignments = await prisma.staffAttractionAssignment.findMany({
        where: { staffId: req.user.id, revokedAt: null },
        select: { attractionId: true },
      });
      assignedAttractionIds = assignments.map((assignment) => assignment.attractionId);
    }

    const search = String(req.query.search || '').trim();
    const where = {
      isForecastTrainingSample: false,
      status: 'CONFIRMED',
      reservation: {
        date: { gte: dateFrom, lte: dateTo },
        ...(assignedAttractionIds
          ? { ticketProduct: { attractionId: { in: assignedAttractionIds } } }
          : {}),
      },
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { snapshotAttractionTitle: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: [{ reservation: { date: 'asc' } }, { createdAt: 'asc' }],
      take: 100,
      include: {
        ticketInstances: { where: { status: 'VALID' }, select: { status: true } },
        reservation: {
          include: {
            timeSlot: true,
            ticketProduct: {
              include: { attraction: { select: { id: true, title: true } } },
            },
          },
        },
      },
    });

    const data = bookings.map((booking) => {
      const reservation = booking.reservation;
      const timeSlot = reservation.timeSlot;
      return {
        bookingId: booking.id,
        customer: booking.fullName,
        phone: booking.phone,
        visitDate: new Date(booking.snapshotVisitDate || reservation.date).toISOString().slice(0, 10),
        attraction: booking.snapshotAttractionTitle || reservation.ticketProduct.attraction.title,
        ticketName: booking.snapshotTicketName || reservation.ticketProduct.name,
        quantity: reservation.quantity,
        validCount: booking.ticketInstances.length,
        bookingStatus: booking.status,
        timeSlot: booking.snapshotTimeSlotLabel
          || (timeSlot ? `${timeSlot.startTime} - ${timeSlot.endTime}` : null),
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
        total: data.length,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: { message: error.message } });
    }
    return next(error);
  }
}

async function listStaffAssignments(req, res, next) {
  try {
    const staff = await prisma.user.findUnique({
      where: { id: req.params.staffId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        roleMemberships: { select: { role: true } },
      },
    });
    if (!staff || !hasRole(staff, 'STAFF')) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản nhân viên.' });
    }

    const assignments = await prisma.staffAttractionAssignment.findMany({
      where: { staffId: staff.id, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        attraction: {
          select: { id: true, title: true, city: true, status: true },
        },
      },
    });

    return res.json({ success: true, data: { staff, assignments } });
  } catch (error) {
    return next(error);
  }
}

async function replaceStaffAssignments(req, res, next) {
  try {
    const attractionIds = Array.isArray(req.body?.attractionIds)
      ? [...new Set(req.body.attractionIds.map((id) => String(id).trim()).filter(Boolean))]
      : null;
    if (!attractionIds) {
      return res.status(400).json({ message: 'attractionIds phải là một mảng.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const staff = await tx.user.findUnique({
        where: { id: req.params.staffId },
        select: {
          id: true,
          role: true,
          employerPartnerId: true,
          roleMemberships: { select: { role: true } },
        },
      });
      if (!staff || !hasRole(staff, 'STAFF')) {
        throw httpError(404, 'Không tìm thấy tài khoản nhân viên.');
      }
      // Nhân viên phải thuộc một đối tác trước khi được phân công địa điểm.
      if (!staff.employerPartnerId) {
        throw httpError(400, 'Nhân viên này chưa thuộc đối tác nào.');
      }

      const attractionCount = await tx.attraction.count({
        where: {
          id: { in: attractionIds },
          // Mỗi nhân viên chỉ được phân công địa điểm của đối tác chủ quản.
          partnerId: staff.employerPartnerId,
          archivedAt: null,
          publishedAt: { not: null },
          publicationStatus: 'ACTIVE',
          operationalStatus: 'ACTIVE',
        },
      });
      if (attractionCount !== attractionIds.length) {
        throw httpError(400, 'Có địa điểm không thuộc đối tác của nhân viên hoặc chưa được phê duyệt.');
      }

      await tx.staffAttractionAssignment.updateMany({
        where: {
          staffId: staff.id,
          revokedAt: null,
          attractionId: { notIn: attractionIds },
        },
        data: { revokedAt: new Date() },
      });

      for (const attractionId of attractionIds) {
        await tx.staffAttractionAssignment.upsert({
          where: {
            staffId_attractionId: {
              staffId: staff.id,
              attractionId,
            },
          },
          update: {
            revokedAt: null,
            createdById: req.user.id,
          },
          create: {
            staffId: staff.id,
            attractionId,
            createdById: req.user.id,
          },
        });
      }

      await writeAuditLog({
        client: tx,
        req,
        actorId: req.user.id,
        action: 'STAFF_ASSIGNMENTS_REPLACED',
        entityType: 'User',
        entityId: staff.id,
        metadata: { attractionIds },
      });

      return staff;
    });

    return res.json({
      success: true,
      data: {
        staffId: result.id,
        attractionIds,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  adjudicateRefundRequest,
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
  reissueTicket,
  lookupTicketByQr,
  lookupCheckinTarget,
  checkInTicket,
  listTodayBookings,
  listOperationalBookings,
  listStaffAssignments,
  replaceStaffAssignments,
};
