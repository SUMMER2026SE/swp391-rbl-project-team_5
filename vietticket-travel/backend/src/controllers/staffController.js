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
  isMandatoryRefundRequest,
} = require('../services/refundLifecycleService');
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

function getClientIp(req) {
  return getRequestIp(req) || '127.0.0.1';
}

const REFUND_ACTIONS = new Set(['APPROVED', 'REJECTED']);
const REFUND_STATUSES = new Set(['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED']);
const REISSUE_REASON_CODES = new Set([
  'LOST_BY_CUSTOMER',
  'DAMAGED_QR',
  'CONTACT_CHANGED',
  'OPERATIONAL_ERROR',
  'OTHER',
]);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertPlatformRefundStaff(user) {
  if (!isPlatformStaff(user)) {
    throw httpError(403, 'Chỉ nhân viên nội bộ của nền tảng mới có quyền xử lý hoàn tiền.');
  }
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
    throw httpError(403, 'Bạn không được phân công check-in tại địa điểm này.');
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
              gatewayResponseCode: true,
              gatewayTransactionStatus: true,
              gatewayTransactionId: true,
              processedAt: true,
            },
          },
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
      data: requests,
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
    if (refundRequest.booking.status === 'REFUNDED' && refundRequest.type !== 'DUPLICATE_PAYMENT') {
      throw httpError(409, 'Đơn đặt vé này đã được hoàn tiền.');
    }
    if (action === 'REJECTED' && isMandatoryRefundRequest(refundRequest)) {
      throw httpError(400, 'Không thể từ chối yêu cầu hoàn tiền bắt buộc.');
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
          include: { booking: true },
        });
        if (!fresh || fresh.status !== 'PROCESSING') {
          throw httpError(409, 'Yêu cầu không còn ở trạng thái đang xử lý.');
        }
        if (isMandatoryRefundRequest(fresh)) {
          throw httpError(400, 'Không thể từ chối yêu cầu hoàn tiền bắt buộc.');
        }
        if (fresh.booking.status === 'REFUND_REQUESTED') {
          await tx.booking.update({
            where: { id: fresh.bookingId },
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
        to: refundRequest.booking.user.email,
        fullName: refundRequest.booking.user.fullName,
        bookingId: refundRequest.booking.id,
        action: 'REJECTED',
        refundAmount: Number(refundRequest.amount),
        staffNotes,
      }).catch((emailError) => {
        console.error('[staff-refund] Không thể gửi email:', emailError.message);
      });
      return res.json({ success: true, data: updated });
    }

    const payment = findRefundTargetPayment(refundRequest);
    if (!payment) {
      throw httpError(422, 'Không tìm thấy giao dịch VNPay thành công tương ứng để hoàn tiền.');
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
      const transactionType = requestedAmount >= capturedAmount ? '02' : '03';
      const orderInfo = refundRequest.type === 'DUPLICATE_PAYMENT'
        ? `Hoan tien giao dich trung don hang ${refundRequest.booking.id}`
        : `Hoan tien don hang ${refundRequest.booking.id}`;

      refundTransaction = await prisma.refundTransaction.create({
        data: {
          bookingId: refundRequest.booking.id,
          paymentId: payment.id,
          refundRequestId: refundRequest.id,
          gatewayRequestId: createVnpRequestId(),
          transactionType,
          amount: requestedAmount,
          status: 'PROCESSING',
          reason: refundRequest.reason,
          processedById: req.user.id,
          submittedAt: new Date(),
          rawRequest: { originalTransactionId: payment.transactionId, orderInfo },
        },
      });

      try {
        gatewayResult = await refundViaVnpay({
          payment,
          amount: requestedAmount,
          transactionType,
          createBy: req.user.email,
          ipAddr: getClientIp(req),
          orderInfo,
          requestId: refundTransaction.gatewayRequestId,
        });
      } catch (gatewayError) {
        if (gatewayError.gatewayAttempted !== true) {
          await prisma.$transaction(async (tx) => {
            await tx.refundTransaction.update({
              where: { id: refundTransaction.id },
              data: {
                status: 'FAILED',
                rawResponse: { error: gatewayError.message },
                processedAt: new Date(),
              },
            });
            await tx.refundRequest.update({
              where: { id: refundId },
              data: {
                status: 'PENDING',
                processedById: null,
                processingStartedAt: null,
                staffNotes: `Không thể gửi yêu cầu sang VNPay: ${gatewayError.message}`,
              },
            });
          });
          refundClaimed = false;
          throw gatewayError;
        }
        keepProcessing = true;
        refundClaimed = false;
        await prisma.refundTransaction.update({
          where: { id: refundTransaction.id },
          data: {
            status: 'NEEDS_RECONCILIATION',
            rawResponse: { error: gatewayError.message },
            submittedAt: new Date(),
            processedAt: new Date(),
          },
        });
        return res.status(202).json({
          success: true,
          data: { status: 'PROCESSING', requiresReconciliation: true },
          message: 'Chưa xác định được kết quả từ VNPay. Yêu cầu đã chuyển sang đối soát và sẽ không bị gửi lặp.',
        });
      }

      const gatewayOutcome = classifyVnpayRefundResult(gatewayResult);
      if (gatewayOutcome === REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION) {
        keepProcessing = true;
        refundClaimed = false;
        await prisma.refundTransaction.update({
          where: { id: refundTransaction.id },
          data: {
            status: 'NEEDS_RECONCILIATION',
            ...buildGatewayTransactionData(gatewayResult),
            processedAt: new Date(),
          },
        });
        return res.status(202).json({
          success: true,
          data: { status: 'PROCESSING', requiresReconciliation: true },
          message: 'VNPay đang xử lý khoản hoàn. Hệ thống sẽ đối soát trước khi cập nhật hoàn tất.',
        });
      }
      if (gatewayOutcome === REFUND_GATEWAY_OUTCOME.FAILED) {
        await prisma.$transaction(async (tx) => {
          await tx.refundTransaction.update({
            where: { id: refundTransaction.id },
            data: {
              status: 'FAILED',
              ...buildGatewayTransactionData(gatewayResult),
              processedAt: new Date(),
            },
          });
          await tx.refundRequest.update({
            where: { id: refundId },
            data: {
              status: 'PENDING',
              processedById: null,
              processingStartedAt: null,
              staffNotes: `VNPay từ chối: ${gatewayResult.responseCode || 'N/A'} ${gatewayResult.message || ''}`.trim(),
            },
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
      gatewayResult
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
      await prisma.refundTransaction.update({
        where: { id: refundTransaction.id },
        data: {
          status: 'NEEDS_RECONCILIATION',
          ...(gatewayResult ? buildGatewayTransactionData(gatewayResult) : {}),
          processedAt: new Date(),
        },
      }).catch(() => {});
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
    await sendRefundStatusEmail({
      to: refundRequest.booking.user.email,
      fullName: refundRequest.booking.user.fullName,
      bookingId: refundRequest.booking.id,
      action: 'APPROVED',
      refundAmount: Number(refundRequest.amount),
      staffNotes,
    }).catch((emailError) => {
      console.error('[staff-refund] Không thể gửi email:', emailError.message);
    });

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

    let queryResult;
    try {
      queryResult = await queryVnpayTransaction({
        payment: refundTransaction.payment,
        ipAddr: getClientIp(req),
        orderInfo: `Doi soat hoan tien don hang ${refundRequest.bookingId}`,
      });
    } catch (queryError) {
      await prisma.refundTransaction.update({
        where: { id: refundTransaction.id },
        data: {
          status: 'NEEDS_RECONCILIATION',
          reconciledAt: new Date(),
        },
      });
      throw queryError;
    }

    const outcome = classifyVnpayReconciliationResult(queryResult, refundTransaction);
    const reconciliationData = {
      gatewayResponseCode: queryResult.responseCode,
      gatewayTransactionStatus: queryResult.transactionStatus,
      gatewayTransactionId: String(queryResult.raw?.vnp_TransactionNo || '') || null,
      rawResponse: {
        ...(refundTransaction.rawResponse || {}),
        reconciliation: queryResult.raw,
      },
      reconciledAt: new Date(),
    };

    if (outcome === REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION) {
      await prisma.refundTransaction.update({
        where: { id: refundTransaction.id },
        data: { status: 'NEEDS_RECONCILIATION', ...reconciliationData },
      });
      return res.status(202).json({
        success: true,
        data: { status: 'PROCESSING', requiresReconciliation: true },
        message: 'VNPay chưa xác nhận khoản hoàn hoàn tất. Yêu cầu tiếp tục chờ đối soát.',
      });
    }

    if (outcome === REFUND_GATEWAY_OUTCOME.FAILED) {
      await prisma.$transaction(async (tx) => {
        await tx.refundTransaction.update({
          where: { id: refundTransaction.id },
          data: { status: 'FAILED', ...reconciliationData, processedAt: new Date() },
        });
        await tx.refundRequest.update({
          where: { id: refundId },
          data: {
            status: 'PENDING',
            processedById: null,
            processingStartedAt: null,
            staffNotes: 'Đối soát xác nhận VNPay từ chối khoản hoàn. Có thể kiểm tra và thử lại.',
          },
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
        await tx.refundTransaction.update({
          where: { id: refundTransaction.id },
          data: reconciliationData,
        });
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
    await sendRefundStatusEmail({
      to: refundRequest.booking.user.email,
      fullName: refundRequest.booking.user.fullName,
      bookingId: refundRequest.bookingId,
      action: 'APPROVED',
      refundAmount: Number(refundRequest.amount),
      staffNotes: 'Khoản hoàn đã được VNPay xác nhận thành công.',
    }).catch((emailError) => {
      console.error('[staff-refund] Không thể gửi email đối soát:', emailError.message);
    });

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

        if (!booking) {
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
function normalizeQrToken(raw) {
  const value = String(raw || '').trim();
  return value.startsWith('VIETTICKET:') ? value.slice('VIETTICKET:'.length) : value;
}

function toCheckinTicket(instance) {
  const booking = instance.booking;
  const reservation = booking.reservation;
  const visitDate = booking.snapshotVisitDate || reservation.date;
  const visitDay = new Date(visitDate).toISOString().slice(0, 10);
  const timeSlot = reservation.timeSlot;

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

    const instance = await prisma.ticketInstance.findUnique({
      where: { qrCodeToken: token },
      include: {
        booking: {
          include: {
            reservation: {
              include: {
                timeSlot: true,
                ticketProduct: {
                  include: {
                    attraction: {
                      select: { id: true, title: true, openTime: true, closeTime: true },
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
        const instance = await tx.ticketInstance.findUnique({
          where: { qrCodeToken: token },
          include: {
            booking: {
              include: {
                reservation: {
                  include: {
                    timeSlot: true,
                    ticketProduct: {
                      include: {
                        attraction: {
                          select: { id: true, title: true, openTime: true, closeTime: true },
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
            ticketInstanceId: instance.id,
          },
        });

        return {
          instance,
          checkedInCount: updated.count,
          checkedInAt,
          bookingStatus,
        };
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
        checkedInAt: result.checkedInAt,
        checkedInBy: req.user.email,
        bookingStatus: result.bookingStatus,
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
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
  reissueTicket,
  lookupTicketByQr,
  checkInTicket,
  listTodayBookings,
  listStaffAssignments,
  replaceStaffAssignments,
};
