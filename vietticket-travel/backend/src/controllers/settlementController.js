'use strict';

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { recognizedAmountsOf } = require('../services/financialReportService');
const { writeAuditLog } = require('../utils/auditLog');

const STATUSES = ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'];
const BOOKING_INCLUDE = {
  payments: {
    where: { status: 'SUCCESS', isDuplicate: false },
    select: { amount: true },
  },
  refundTransactions: {
    where: { status: 'SUCCESS' },
    select: {
      amount: true,
      refundRequest: { select: { type: true } },
    },
  },
};

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw
    ? null
    : date;
}

function toMoney(value) {
  return Math.round(Number(value || 0));
}

function serializeSettlement(settlement) {
  if (!settlement) return null;
  return {
    ...settlement,
    grossAmount: toMoney(settlement.grossAmount),
    refundAmount: toMoney(settlement.refundAmount),
    netAmount: toMoney(settlement.netAmount),
    commissionAmount: toMoney(settlement.commissionAmount),
    payableAmount: toMoney(settlement.payableAmount),
    items: settlement.items?.map((item) => ({
      ...item,
      grossAmount: toMoney(item.grossAmount),
      refundAmount: toMoney(item.refundAmount),
      netAmount: toMoney(item.netAmount),
      commissionAmount: toMoney(item.commissionAmount),
      payableAmount: toMoney(item.payableAmount),
    })),
  };
}

function validatePeriod(body) {
  const periodStart = parseDateOnly(body?.periodStart);
  const periodEnd = parseDateOnly(body?.periodEnd);
  if (!periodStart || !periodEnd) {
    return { error: 'Kỳ đối soát phải có ngày bắt đầu và kết thúc hợp lệ.' };
  }
  if (periodStart > periodEnd) {
    return { error: 'Ngày bắt đầu không được sau ngày kết thúc.' };
  }
  const durationDays = Math.floor((periodEnd - periodStart) / 86_400_000) + 1;
  if (durationDays > 366) {
    return { error: 'Một kỳ đối soát không được dài quá 366 ngày.' };
  }
  return { periodStart, periodEnd };
}

async function listSettlements(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = Math.min(parsePositiveInteger(req.query.limit, 20), 100);
    const status = String(req.query.status || '').trim().toUpperCase();
    const partnerId = String(req.query.partnerId || '').trim();
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái đối soát không hợp lệ.' });
    }
    const where = {
      ...(status ? { status } : {}),
      ...(partnerId ? { partnerId } : {}),
    };
    const [settlements, total, statusGroups] = await prisma.$transaction([
      prisma.partnerSettlement.findMany({
        where,
        include: {
          partner: { select: { id: true, businessName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.partnerSettlement.count({ where }),
      prisma.partnerSettlement.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { payableAmount: true },
      }),
    ]);
    const stats = Object.fromEntries(STATUSES.map((item) => [
      item,
      { count: 0, payableAmount: 0 },
    ]));
    for (const group of statusGroups) {
      stats[group.status] = {
        count: Number(group._count?._all || 0),
        payableAmount: toMoney(group._sum?.payableAmount),
      };
    }
    return res.json({
      success: true,
      data: settlements.map(serializeSettlement),
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listPartnerSettlements(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = Math.min(parsePositiveInteger(req.query.limit, 20), 50);
    const status = String(req.query.status || '').trim().toUpperCase();
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái đối soát không hợp lệ.' });
    }
    const where = {
      partnerId: req.partner.id,
      ...(status ? { status } : {}),
    };
    const [settlements, total] = await prisma.$transaction([
      prisma.partnerSettlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.partnerSettlement.count({ where }),
    ]);
    return res.json({
      success: true,
      data: settlements.map(serializeSettlement),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getSettlement(req, res, next) {
  try {
    const settlement = await prisma.partnerSettlement.findUnique({
      where: { id: req.params.id },
      include: {
        partner: {
          select: {
            id: true,
            businessName: true,
            taxCode: true,
          },
        },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            booking: {
              select: {
                id: true,
                status: true,
                snapshotVisitDate: true,
                snapshotAttractionTitle: true,
                snapshotTicketName: true,
                fullName: true,
              },
            },
          },
        },
      },
    });
    if (!settlement) {
      return res.status(404).json({ message: 'Không tìm thấy kỳ đối soát.' });
    }
    return res.json({ success: true, data: serializeSettlement(settlement) });
  } catch (error) {
    return next(error);
  }
}

async function createSettlement(req, res, next) {
  const period = validatePeriod(req.body);
  if (period.error) return res.status(400).json({ message: period.error });
  const partnerId = String(req.body?.partnerId || '').trim();
  if (!partnerId) return res.status(400).json({ message: 'Vui lòng chọn đối tác.' });

  try {
    const partner = await prisma.partnerProfile.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        businessName: true,
        status: true,
        bankName: true,
        bankAccountName: true,
        bankAccountNumber: true,
        payoutCurrency: true,
      },
    });
    if (!partner || !['APPROVED', 'SUSPENDED'].includes(partner.status)) {
      return res.status(409).json({
        message: 'Chỉ có thể đối soát hồ sơ đối tác đã được phê duyệt.',
      });
    }
    if (!partner.bankName || !partner.bankAccountName || !partner.bankAccountNumber) {
      return res.status(409).json({
        message: 'Hồ sơ đối tác chưa đủ thông tin ngân hàng để lập đối soát.',
      });
    }

    const settlement = await prisma.$transaction(async (tx) => {
      const bookings = await tx.booking.findMany({
        where: {
          isForecastTrainingSample: false,
          snapshotVisitDate: {
            gte: period.periodStart,
            lte: period.periodEnd,
          },
          status: { in: ['COMPLETED', 'NO_SHOW', 'REFUNDED'] },
          payments: { some: { status: 'SUCCESS', isDuplicate: false } },
          reservation: {
            ticketProduct: {
              attraction: { partnerId },
            },
          },
          settlementItems: { none: { releasedAt: null } },
        },
        select: {
          id: true,
          status: true,
          snapshotVisitDate: true,
          commissionRateSnapshot: true,
          commissionAmountSnapshot: true,
          partnerNetAmountSnapshot: true,
          ...BOOKING_INCLUDE,
        },
        orderBy: [{ snapshotVisitDate: 'asc' }, { id: 'asc' }],
      });

      const items = bookings
        .map((booking) => {
          const amounts = recognizedAmountsOf(booking);
          return {
            bookingId: booking.id,
            grossAmount: toMoney(amounts.grossAmount),
            refundAmount: toMoney(amounts.refundAmount),
            netAmount: toMoney(amounts.netAmount),
            commissionAmount: toMoney(amounts.commissionAmount),
            payableAmount: toMoney(amounts.partnerPayableAmount),
          };
        })
        .filter((item) => item.payableAmount > 0);
      if (items.length === 0) {
        const error = new Error('Không có booking đủ điều kiện và chưa được đối soát trong kỳ này.');
        error.statusCode = 409;
        throw error;
      }

      const totals = items.reduce((sum, item) => ({
        grossAmount: sum.grossAmount + item.grossAmount,
        refundAmount: sum.refundAmount + item.refundAmount,
        netAmount: sum.netAmount + item.netAmount,
        commissionAmount: sum.commissionAmount + item.commissionAmount,
        payableAmount: sum.payableAmount + item.payableAmount,
      }), {
        grossAmount: 0,
        refundAmount: 0,
        netAmount: 0,
        commissionAmount: 0,
        payableAmount: 0,
      });

      const created = await tx.partnerSettlement.create({
        data: {
          partnerId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          currency: partner.payoutCurrency || 'VND',
          ...totals,
          bookingCount: items.length,
          bankNameSnapshot: partner.bankName,
          bankAccountNameSnapshot: partner.bankAccountName,
          bankAccountLast4Snapshot: String(partner.bankAccountNumber).slice(-4),
          createdById: req.user.id,
        },
      });
      await tx.partnerSettlementItem.createMany({
        data: items.map((item) => ({ ...item, settlementId: created.id })),
      });
      await writeAuditLog({
        client: tx,
        req,
        action: 'PARTNER_SETTLEMENT_CREATED',
        entityType: 'SETTLEMENT',
        entityId: created.id,
        metadata: {
          partnerId,
          periodStart: req.body.periodStart,
          periodEnd: req.body.periodEnd,
          bookingCount: items.length,
          payableAmount: totals.payableAmount,
        },
      });
      return tx.partnerSettlement.findUnique({
        where: { id: created.id },
        include: {
          partner: { select: { id: true, businessName: true } },
          items: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return res.status(201).json({
      success: true,
      message: 'Đã lập kỳ đối soát ở trạng thái nháp.',
      data: serializeSettlement(settlement),
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (['P2002', 'P2034'].includes(error?.code)) {
      return res.status(409).json({
        message: 'Kỳ hoặc booking này vừa được đối soát bởi thao tác khác. Vui lòng tải lại.',
      });
    }
    return next(error);
  }
}

async function updateSettlementStatus(req, res, next) {
  try {
    const targetStatus = String(req.body?.status || '').trim().toUpperCase();
    const bankReference = String(req.body?.bankReference || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!['APPROVED', 'PAID', 'CANCELLED'].includes(targetStatus)) {
      return res.status(400).json({ message: 'Chuyển trạng thái đối soát không hợp lệ.' });
    }
    if (
      targetStatus === 'PAID'
      && (
        bankReference.length < 3
        || bankReference.length > 100
        || !/^[\p{L}\p{N}._/-]+$/u.test(bankReference)
      )
    ) {
      return res.status(400).json({
        message: 'Mã tham chiếu ngân hàng phải có từ 3 đến 100 ký tự hợp lệ.',
      });
    }
    if (targetStatus === 'CANCELLED' && (reason.length < 10 || reason.length > 1000)) {
      return res.status(400).json({
        message: 'Lý do hủy phải có từ 10 đến 1000 ký tự.',
      });
    }

    const current = await prisma.partnerSettlement.findUnique({
      where: { id: req.params.id },
    });
    if (!current) {
      return res.status(404).json({ message: 'Không tìm thấy kỳ đối soát.' });
    }
    const allowedFrom = {
      APPROVED: ['DRAFT'],
      PAID: ['APPROVED'],
      CANCELLED: ['DRAFT', 'APPROVED'],
    };
    if (!allowedFrom[targetStatus].includes(current.status)) {
      return res.status(409).json({
        message: `Không thể chuyển kỳ đối soát từ ${current.status} sang ${targetStatus}.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.partnerSettlement.updateMany({
        where: { id: current.id, status: current.status },
        data: targetStatus === 'APPROVED'
          ? {
              status: 'APPROVED',
              approvedById: req.user.id,
              approvedAt: now,
            }
          : targetStatus === 'PAID'
            ? {
                status: 'PAID',
                paidById: req.user.id,
                paidAt: now,
                bankReference,
              }
            : {
                status: 'CANCELLED',
                cancelledById: req.user.id,
                cancelledAt: now,
                cancellationReason: reason,
              },
      });
      if (changed.count !== 1) {
        const error = new Error('Kỳ đối soát vừa được cập nhật bởi người khác.');
        error.statusCode = 409;
        throw error;
      }
      if (targetStatus === 'CANCELLED') {
        await tx.partnerSettlementItem.updateMany({
          where: { settlementId: current.id, releasedAt: null },
          data: { releasedAt: now },
        });
      }
      await writeAuditLog({
        client: tx,
        req,
        action: `PARTNER_SETTLEMENT_${targetStatus}`,
        entityType: 'SETTLEMENT',
        entityId: current.id,
        metadata: {
          previousStatus: current.status,
          status: targetStatus,
          ...(bankReference ? { bankReference } : {}),
          ...(reason ? { reason } : {}),
        },
      });
      return tx.partnerSettlement.findUnique({
        where: { id: current.id },
        include: {
          partner: { select: { id: true, businessName: true } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return res.json({
      success: true,
      message: targetStatus === 'PAID'
        ? 'Đã ghi nhận chuyển khoản cho đối tác.'
        : targetStatus === 'APPROVED'
          ? 'Đã duyệt kỳ đối soát.'
          : 'Đã hủy kỳ đối soát và giải phóng các booking.',
      data: serializeSettlement(updated),
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Mã tham chiếu ngân hàng đã được sử dụng.' });
    }
    if (error?.code === 'P2034') {
      return res.status(409).json({ message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại.' });
    }
    return next(error);
  }
}

module.exports = {
  createSettlement,
  getSettlement,
  listSettlements,
  listPartnerSettlements,
  updateSettlementStatus,
};
