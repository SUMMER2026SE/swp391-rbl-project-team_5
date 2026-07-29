'use strict';

// Hằng số & chính sách dùng chung cho thanh toán chuyển khoản.
// Tách riêng (không phụ thuộc prisma/controller) để cả bookingController lẫn
// bankTransferService cùng dùng mà không tạo phụ thuộc vòng.

const { formatBookingReference } = require('./bookingReference');

const BANK_TRANSFER_METHOD = 'bank_transfer';
const DEFAULT_HOLD_MINUTES = 240;
const MIN_HOLD_MINUTES = 15;
const MAX_HOLD_MINUTES = 720;

// Giữ chỗ mặc định của hệ thống chỉ 10 phút — không đủ cho khách chuyển khoản
// rồi chờ Admin đối chiếu sao kê. Đơn chuyển khoản được nới hạn theo cấu hình.
function getBankTransferHoldMinutes() {
  const parsed = Number(process.env.BANK_TRANSFER_HOLD_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_HOLD_MINUTES;
  return Math.min(Math.max(Math.round(parsed), MIN_HOLD_MINUTES), MAX_HOLD_MINUTES);
}

function getBankTransferHoldMs() {
  return getBankTransferHoldMinutes() * 60 * 1000;
}

// Nội dung chuyển khoản để đối soát: bỏ dấu gạch cho an toàn với mọi app
// ngân hàng. VT-1234567890AB -> VT1234567890AB
function buildTransferContent(bookingId) {
  return formatBookingReference(bookingId).replace(/-/gu, '');
}

module.exports = {
  BANK_TRANSFER_METHOD,
  buildTransferContent,
  getBankTransferHoldMinutes,
  getBankTransferHoldMs,
};
