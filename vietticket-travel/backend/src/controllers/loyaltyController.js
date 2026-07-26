'use strict';

// ============================================================
// loyaltyController.js — API ví điểm thưởng cho khách hàng.
//   GET  /api/loyalty/me           - số dư + tổng đã tích + giao dịch gần đây
//   GET  /api/loyalty/transactions - sao kê điểm (phân trang cursor)
//   GET  /api/loyalty/catalog      - danh sách gói đổi điểm
//   POST /api/loyalty/redeem       - đổi điểm lấy voucher
//   GET  /api/loyalty/vouchers     - voucher cá nhân đã đổi
// ============================================================

const {
  getSummary,
  listTransactions,
  getCatalog,
  getRedeemableBalance,
  redeemPoints,
  listUserVouchers,
} = require('../services/loyaltyService');
const { writeAuditLog } = require('../utils/auditLog');

async function getMySummary(req, res, next) {
  try {
    const summary = await getSummary(req.user.id);
    return res.json({ success: true, data: summary });
  } catch (error) {
    return next(error);
  }
}

async function getMyTransactions(req, res, next) {
  try {
    const { limit, cursor } = req.query;
    const result = await listTransactions(req.user.id, { limit, cursor });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function getRedemptionCatalog(req, res, next) {
  try {
    const { balance, redeemable, locked } = await getRedeemableBalance(req.user.id);
    return res.json({
      success: true,
      data: {
        balance,
        redeemable,
        pending: locked,
        tiers: getCatalog(redeemable),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function postRedeem(req, res, next) {
  try {
    const tierId = String(req.body?.tierId || '').trim();
    if (!tierId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn gói đổi điểm.' });
    }

    const result = await redeemPoints({ userId: req.user.id, tierId });

    await writeAuditLog({
      req,
      action: 'LOYALTY_REDEEM',
      entityType: 'Voucher',
      entityId: result.voucher.id,
      metadata: {
        tierId,
        pointsCost: result.tier.pointsCost,
        voucherCode: result.voucher.code,
        balanceAfter: result.balance,
      },
    });

    return res.status(201).json({
      success: true,
      message: `Đổi điểm thành công! Mã ưu đãi ${result.voucher.code} đã sẵn sàng.`,
      data: {
        voucher: {
          id: result.voucher.id,
          code: result.voucher.code,
          discountValue: Number(result.voucher.discountValue),
          minSpend: result.voucher.minSpend != null ? Number(result.voucher.minSpend) : null,
          expiryDate: result.voucher.expiryDate,
        },
        balance: result.balance,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function getMyVouchers(req, res, next) {
  try {
    const vouchers = await listUserVouchers(req.user.id);
    return res.json({ success: true, data: vouchers });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMySummary,
  getMyTransactions,
  getRedemptionCatalog,
  postRedeem,
  getMyVouchers,
};
