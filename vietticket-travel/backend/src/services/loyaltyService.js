'use strict';

// ============================================================
// loyaltyService.js — Ví điểm thưởng / Loyalty
// ------------------------------------------------------------
// Nghiệp vụ:
//   1. awardPointsForBooking(tx, booking)  — cộng điểm khi đơn CONFIRMED.
//   2. reversePointsForBooking(tx, booking) — thu hồi điểm khi đơn đã cộng
//      điểm bị HOÀN TIỀN (chống lạm dụng: đặt -> nhận điểm -> đổi -> hoàn).
//   3. redeemPoints({ userId, tierId }) — đổi điểm lấy voucher cá nhân.
//   4. getSummary / listTransactions / listVouchers — đọc dữ liệu cho UI.
//
// Nguyên tắc:
//   - Sổ cái LoyaltyTransaction là bất biến; User.loyaltyPoints là số dư cache
//     luôn cập nhật nguyên tử CÙNG transaction với dòng sổ cái.
//   - Idempotent qua ràng buộc UNIQUE(bookingId, type): một đơn chỉ EARN 1 lần
//     và REVERSAL 1 lần.
//   - Điểm tính trên totalAmount (tiền thực trả sau giảm giá). Bỏ qua dữ liệu
//     giả lập cho ML (isForecastTrainingSample).
//   - Số dư có thể tạm ÂM nếu khách đã đổi điểm rồi mới bị thu hồi; khi âm sẽ
//     không cho đổi tiếp cho tới khi dương trở lại.
// ============================================================

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');

// ---- Tham số kinh tế điểm (có thể chỉnh qua ENV) ----
// Tích: 1 điểm cho mỗi 1.000đ chi tiêu.
const EARN_VND_PER_POINT = toPositiveInt(process.env.LOYALTY_VND_PER_POINT, 1000);

// Catalog đổi điểm (~5% hoàn lại: 1 điểm ≈ 50đ). Voucher FIXED, cá nhân,
// dùng 1 lần, hết hạn sau validityDays. minSpend chặn dùng voucher cho đơn quá nhỏ.
const REDEMPTION_TIERS = [
  {
    id: 'LT_10K',
    label: 'Voucher 10.000đ',
    pointsCost: 200,
    discountValue: 10000,
    minSpend: 50000,
    validityDays: 90,
  },
  {
    id: 'LT_25K',
    label: 'Voucher 25.000đ',
    pointsCost: 500,
    discountValue: 25000,
    minSpend: 100000,
    validityDays: 90,
  },
  {
    id: 'LT_50K',
    label: 'Voucher 50.000đ',
    pointsCost: 1000,
    discountValue: 50000,
    minSpend: 200000,
    validityDays: 90,
  },
  {
    id: 'LT_100K',
    label: 'Voucher 100.000đ',
    pointsCost: 2000,
    discountValue: 100000,
    minSpend: 400000,
    validityDays: 90,
  },
];

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRedemptionTier(tierId) {
  return REDEMPTION_TIERS.find((tier) => tier.id === tierId) || null;
}

// Số điểm nhận được từ số tiền thực trả (làm tròn xuống).
function computeEarnedPoints(totalAmount) {
  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount / EARN_VND_PER_POINT);
}

function shortBookingRef(bookingId) {
  return `#${String(bookingId).slice(0, 8).toUpperCase()}`;
}

// ------------------------------------------------------------
// 1. Cộng điểm khi đơn CONFIRMED — gọi TRONG transaction xác nhận đơn.
//    booking cần các trường: id, userId, totalAmount, isForecastTrainingSample.
// ------------------------------------------------------------
async function awardPointsForBooking(tx, booking) {
  if (!booking || !booking.id || !booking.userId) return null;
  // Không bao giờ cộng điểm cho dữ liệu giả lập phục vụ dự báo.
  if (booking.isForecastTrainingSample) return null;

  const points = computeEarnedPoints(booking.totalAmount);
  if (points <= 0) return null;

  // Idempotent: nếu đơn đã được cộng điểm thì bỏ qua.
  const existing = await tx.loyaltyTransaction.findUnique({
    where: { bookingId_type: { bookingId: booking.id, type: 'EARN' } },
  });
  if (existing) return existing;

  const user = await tx.user.update({
    where: { id: booking.userId },
    data: { loyaltyPoints: { increment: points } },
    select: { loyaltyPoints: true },
  });

  return tx.loyaltyTransaction.create({
    data: {
      userId: booking.userId,
      bookingId: booking.id,
      type: 'EARN',
      points,
      balanceAfter: user.loyaltyPoints,
      description: `Tích ${points.toLocaleString('vi-VN')} điểm từ đơn ${shortBookingRef(booking.id)}`,
    },
  });
}

// ------------------------------------------------------------
// 2. Thu hồi điểm khi đơn đã cộng điểm bị HOÀN TIỀN — gọi TRONG transaction
//    hoàn tiền. booking cần: id.
// ------------------------------------------------------------
async function reversePointsForBooking(tx, booking) {
  if (!booking || !booking.id) return null;

  const earn = await tx.loyaltyTransaction.findUnique({
    where: { bookingId_type: { bookingId: booking.id, type: 'EARN' } },
  });
  // Đơn chưa từng cộng điểm -> không có gì để thu hồi.
  if (!earn || earn.points <= 0) return null;

  // Idempotent: đã thu hồi rồi thì thôi.
  const existingReversal = await tx.loyaltyTransaction.findUnique({
    where: { bookingId_type: { bookingId: booking.id, type: 'REVERSAL' } },
  });
  if (existingReversal) return existingReversal;

  const user = await tx.user.update({
    where: { id: earn.userId },
    data: { loyaltyPoints: { decrement: earn.points } },
    select: { loyaltyPoints: true },
  });

  const reversal = await tx.loyaltyTransaction.create({
    data: {
      userId: earn.userId,
      bookingId: booking.id,
      type: 'REVERSAL',
      points: -earn.points,
      balanceAfter: user.loyaltyPoints,
      description: `Thu hồi ${earn.points.toLocaleString('vi-VN')} điểm do đơn ${shortBookingRef(booking.id)} được hoàn tiền`,
    },
  });

  // Nếu số dư âm sau khi thu hồi (khách đã lỡ đổi điểm của đơn này thành
  // voucher) -> thu hồi các voucher loyalty CHƯA DÙNG để bù lại, tránh lỗ hổng
  // "đặt -> nhận điểm -> đổi voucher -> hoàn tiền mà vẫn giữ voucher".
  if (user.loyaltyPoints < 0) {
    await reclaimUnusedLoyaltyVouchers(tx, earn.userId, user.loyaltyPoints);
  }

  return reversal;
}

// Thu hồi voucher loyalty chưa dùng (hoàn điểm + vô hiệu hóa) cho tới khi số dư
// không còn âm. Ưu tiên voucher đổi gần nhất (nhiều khả năng là voucher "đầu cơ").
async function reclaimUnusedLoyaltyVouchers(tx, userId, startingBalance) {
  let balance = startingBalance;
  if (balance >= 0) return;

  const vouchers = await tx.voucher.findMany({
    where: { userId, source: 'LOYALTY', isActive: true, usedCount: 0 },
    orderBy: { createdAt: 'desc' },
  });

  for (const voucher of vouchers) {
    if (balance >= 0) break;

    const redeemTxn = await tx.loyaltyTransaction.findFirst({
      where: { voucherId: voucher.id, type: 'REDEEM' },
    });
    const refundPoints = redeemTxn ? Math.abs(redeemTxn.points) : 0;

    // Vô hiệu hóa voucher (không xóa để giữ dấu vết).
    await tx.voucher.update({
      where: { id: voucher.id },
      data: { isActive: false },
    });

    if (refundPoints > 0) {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { loyaltyPoints: { increment: refundPoints } },
        select: { loyaltyPoints: true },
      });
      balance = updated.loyaltyPoints;
      await tx.loyaltyTransaction.create({
        data: {
          userId,
          voucherId: voucher.id,
          type: 'ADJUSTMENT',
          points: refundPoints,
          balanceAfter: balance,
          description: `Hoàn ${refundPoints.toLocaleString('vi-VN')} điểm và thu hồi voucher ${voucher.code} do đơn tích điểm bị hoàn tiền`,
        },
      });
    }
  }
}

// Sinh mã voucher cá nhân duy nhất dạng LT-XXXXXXXX.
async function generateUniqueVoucherCode(tx) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm 0/O/1/I
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let suffix = '';
    for (let i = 0; i < 8; i += 1) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const code = `LT${suffix}`;
    const clash = await tx.voucher.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }
  throw httpError(500, 'Không tạo được mã voucher, vui lòng thử lại.');
}

// ------------------------------------------------------------
// 3. Đổi điểm lấy voucher cá nhân — transaction Serializable chống đổi trùng.
// ------------------------------------------------------------
// Các trạng thái đơn được coi là GIỮ CHẮC (không thể hoàn tiền nữa): điểm tích
// từ những đơn này mới được phép đổi. COMPLETED = đã check-in dùng vé;
// NO_SHOW = qua ngày không đến. Đơn REFUNDED đã được thu hồi điểm (REVERSAL)
// nên cũng không tính vào "điểm bị khóa" (loại khỏi phép tính bên dưới).
const KEPT_BOOKING_STATUSES = ['COMPLETED', 'NO_SHOW'];

// Điểm đang bị KHÓA = điểm EARN từ các đơn CHƯA giữ chắc và CHƯA bị hoàn.
// Đơn REFUNDED đã có REVERSAL trừ vào số dư nên loại ra để không khóa trùng.
async function computeLockedPoints(client, userId) {
  const agg = await client.loyaltyTransaction.aggregate({
    where: {
      userId,
      type: 'EARN',
      booking: { status: { notIn: [...KEPT_BOOKING_STATUSES, 'REFUNDED'] } },
    },
    _sum: { points: true },
  });
  return agg._sum.points || 0;
}

// Số dư + số điểm khả dụng để đổi (đã trừ điểm đang khóa).
async function getRedeemableBalance(userId, client = prisma) {
  const [user, locked] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true } }),
    computeLockedPoints(client, userId),
  ]);
  const balance = user?.loyaltyPoints ?? 0;
  // locked có thể lớn hơn balance trong vài trường hợp biên -> kẹp lại.
  const effectiveLocked = Math.max(0, Math.min(locked, balance));
  return {
    balance,
    locked: effectiveLocked,
    redeemable: Math.max(0, balance - effectiveLocked),
  };
}

async function redeemPoints({ userId, tierId }) {
  const tier = getRedemptionTier(tierId);
  if (!tier) throw httpError(400, 'Gói đổi điểm không hợp lệ.');

  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { loyaltyPoints: true },
      });
      if (!user) throw httpError(404, 'Không tìm thấy tài khoản.');

      // Chỉ cho đổi điểm đã "giữ chắc" (đơn COMPLETED/NO_SHOW). Điểm từ đơn còn
      // có thể hoàn (CONFIRMED/đang hoàn/đã hủy chờ hoàn) bị khóa, tránh lỗ hổng
      // "đặt -> nhận điểm -> đổi voucher -> hoàn tiền".
      const locked = await computeLockedPoints(tx, userId);
      const redeemable = Math.max(0, user.loyaltyPoints - Math.max(0, locked));
      if (redeemable < tier.pointsCost) {
        throw httpError(
          400,
          'Bạn chưa đủ điểm khả dụng để đổi gói này. Điểm từ đơn chưa hoàn tất chuyến đi sẽ khả dụng sau khi bạn sử dụng vé.',
        );
      }

      const now = new Date();
      const expiryDate = new Date(now.getTime() + tier.validityDays * 24 * 60 * 60 * 1000);
      const code = await generateUniqueVoucherCode(tx);

      const voucher = await tx.voucher.create({
        data: {
          code,
          discountType: 'FIXED',
          discountValue: tier.discountValue,
          maxDiscount: null,
          minSpend: tier.minSpend,
          expiryDate,
          isActive: true,
          usageLimit: 1,
          usedCount: 0,
          userId,
          source: 'LOYALTY',
          fundingSource: 'PLATFORM',
          platformFundingPercent: 100,
        },
      });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { loyaltyPoints: { decrement: tier.pointsCost } },
        select: { loyaltyPoints: true },
      });
      // Chốt chặn cuối: không cho số dư âm do đổi điểm.
      if (updated.loyaltyPoints < 0) {
        throw httpError(409, 'Số dư điểm không đủ, vui lòng thử lại.');
      }

      const transaction = await tx.loyaltyTransaction.create({
        data: {
          userId,
          voucherId: voucher.id,
          type: 'REDEEM',
          points: -tier.pointsCost,
          balanceAfter: updated.loyaltyPoints,
          description: `Đổi ${tier.pointsCost.toLocaleString('vi-VN')} điểm lấy ${tier.label}`,
        },
      });

      return { voucher, transaction, balance: updated.loyaltyPoints, tier };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// ------------------------------------------------------------
// 4. Đọc dữ liệu cho UI
// ------------------------------------------------------------
async function getSummary(userId) {
  const [balances, earnedAgg, transactions] = await Promise.all([
    getRedeemableBalance(userId),
    prisma.loyaltyTransaction.aggregate({
      where: { userId, type: 'EARN' },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  return {
    balance: balances.balance,
    redeemable: balances.redeemable,
    pending: balances.locked,
    lifetimeEarned: earnedAgg._sum.points ?? 0,
    vndPerPoint: EARN_VND_PER_POINT,
    recentTransactions: transactions.map(serializeTransaction),
  };
}

async function listTransactions(userId, { limit = 20, cursor } = {}) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = await prisma.loyaltyTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items: items.map(serializeTransaction),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}

function getCatalog(redeemable = 0) {
  return REDEMPTION_TIERS.map((tier) => ({
    id: tier.id,
    label: tier.label,
    pointsCost: tier.pointsCost,
    discountValue: tier.discountValue,
    minSpend: tier.minSpend,
    validityDays: tier.validityDays,
    affordable: redeemable >= tier.pointsCost,
  }));
}

async function listUserVouchers(userId) {
  const now = new Date();
  const vouchers = await prisma.voucher.findMany({
    where: { userId, source: 'LOYALTY' },
    orderBy: { createdAt: 'desc' },
  });
  return vouchers.map((voucher) => {
    let state = 'active';
    if (voucher.usedCount > 0) state = 'used';
    else if (!voucher.isActive) state = 'inactive';
    else if (voucher.expiryDate <= now) state = 'expired';
    return {
      id: voucher.id,
      code: voucher.code,
      discountType: voucher.discountType,
      discountValue: Number(voucher.discountValue),
      minSpend: voucher.minSpend != null ? Number(voucher.minSpend) : null,
      expiryDate: voucher.expiryDate,
      state,
      createdAt: voucher.createdAt,
    };
  });
}

function serializeTransaction(txn) {
  return {
    id: txn.id,
    type: txn.type,
    points: txn.points,
    balanceAfter: txn.balanceAfter,
    description: txn.description,
    bookingId: txn.bookingId,
    voucherId: txn.voucherId,
    createdAt: txn.createdAt,
  };
}

module.exports = {
  EARN_VND_PER_POINT,
  REDEMPTION_TIERS,
  computeEarnedPoints,
  getRedemptionTier,
  awardPointsForBooking,
  reversePointsForBooking,
  redeemPoints,
  getSummary,
  listTransactions,
  getCatalog,
  getRedeemableBalance,
  computeLockedPoints,
  listUserVouchers,
};
