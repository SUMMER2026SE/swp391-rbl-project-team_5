// ============================================================
// Nguồn chân lý DUY NHẤT cho nhãn + màu trạng thái đặt vé.
// Dùng chung cho mọi vai trò (customer / partner / staff / admin)
// để cùng một trạng thái luôn hiển thị cùng tên, cùng màu.
// Key nhận cả dạng FE (lowercase) lẫn enum backend (UPPERCASE).
// ============================================================

const BOOKING_STATUS_META = {
  pending_payment: {
    label: 'Chờ thanh toán',
    className: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  },
  pending_partner: {
    label: 'Chờ đối tác duyệt',
    className: 'bg-secondary-fixed/40 text-on-secondary-fixed',
  },
  confirmed: {
    label: 'Đã xác nhận',
    className: 'bg-primary-container text-on-primary',
  },
  completed: {
    label: 'Đã hoàn thành',
    className: 'bg-primary-fixed-dim/30 text-primary',
  },
  no_show: {
    label: 'Không đến sử dụng',
    className: 'bg-surface-container-high text-on-surface-variant',
  },
  cancelled: {
    label: 'Đã hủy',
    className: 'bg-error-container/50 text-error',
  },
  refund_requested: {
    label: 'Chờ hoàn tiền',
    className: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  },
  refunded: {
    label: 'Đã hoàn tiền',
    className: 'bg-surface-container-high text-on-surface-variant',
  },
}

// Một số màn hình cũ dùng key khác cho cùng trạng thái.
const STATUS_ALIASES = {
  unpaid: 'pending_payment',
  pending: 'pending_payment',
}

const FALLBACK_META = {
  label: null,
  className: 'bg-surface-container-high text-on-surface-variant',
}

/**
 * Lấy { label, className } cho một trạng thái đặt vé.
 * @param {string} status 'confirmed' | 'CONFIRMED' | 'unpaid' | ...
 */
export function getBookingStatusMeta(status) {
  const raw = String(status || '').toLowerCase()
  const key = STATUS_ALIASES[raw] || raw
  const meta = BOOKING_STATUS_META[key]
  if (!meta) return { ...FALLBACK_META, label: status }
  return meta
}

// Nhãn trạng thái yêu cầu hoàn tiền (RefundRequest.status).
export const REFUND_STATUS_META = {
  PENDING: { label: 'Chờ duyệt hoàn tiền', className: 'bg-secondary-fixed/40 text-on-secondary-fixed' },
  PROCESSING: { label: 'Đang xử lý hoàn tiền', className: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  APPROVED: { label: 'Đã hoàn tiền', className: 'bg-primary-fixed-dim/30 text-primary' },
  REJECTED: { label: 'Từ chối hoàn tiền', className: 'bg-error-container/50 text-error' },
}
