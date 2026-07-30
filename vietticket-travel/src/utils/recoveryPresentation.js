const STATUS_PRIORITY = {
  OPEN: 0,
  REFUND_PENDING: 1,
  REPLACED: 2,
  REFUNDED: 3,
}

// `new Date(undefined || 0)` là epoch 0 — một số hữu hạn — nên nhánh fallback
// sẽ không bao giờ chạy nếu chỉ dựa vào Number.isFinite. Phải bắt giá trị rỗng
// trước, nếu không một case OPEN thiếu expiresAt sẽ nhảy lên đầu danh sách và
// đẩy case sắp hết hạn xuống dưới.
const timestamp = (value, fallback = 0) => {
  if (value == null || value === '') return fallback
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : fallback
}

export function sortRecoveryCases(cases) {
  return [...(Array.isArray(cases) ? cases : [])].sort((left, right) => {
    const leftPriority = STATUS_PRIORITY[left?.status] ?? 99
    const rightPriority = STATUS_PRIORITY[right?.status] ?? 99
    if (leftPriority !== rightPriority) return leftPriority - rightPriority

    if (left?.status === 'OPEN' && right?.status === 'OPEN') {
      return timestamp(left.expiresAt, Number.MAX_SAFE_INTEGER)
        - timestamp(right.expiresAt, Number.MAX_SAFE_INTEGER)
    }

    return timestamp(right?.createdAt) - timestamp(left?.createdAt)
  })
}

/**
 * Đồng hồ đếm ngược tới hạn chọn của một case Rescue.
 *
 * Tách khỏi component vì `expired` không chỉ để hiển thị: nó khoá nút chọn vé
 * thay thế và nút từ chối. Kết luận sai ở đây là chặn khách khỏi thao tác trên
 * chính case của mình, nên phần tính toán phải kiểm thử được độc lập.
 */
export function getCountdownState(expiresAt, now = Date.now()) {
  const parsed = expiresAt == null || expiresAt === ''
    ? Number.NaN
    : new Date(expiresAt).getTime()
  const hasDeadline = Number.isFinite(parsed)
  const remaining = hasDeadline ? Math.max(0, parsed - now) : 0
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)

  return {
    hasDeadline,
    remaining,
    // Không biết hạn chót thì không được kết luận là đã hết hạn.
    expired: hasDeadline && remaining <= 0,
    label: hasDeadline
      ? `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : '--:--',
  }
}

export function getRecoveryResolutionContent(recoveryCase) {
  const amount = Number(recoveryCase?.refundAmount || recoveryCase?.creditAmount || 0)

  if (recoveryCase?.status === 'REFUNDED') {
    return {
      tone: 'completed',
      icon: 'price_check',
      title: 'Hoàn tiền 100% đã được xác nhận',
      description:
        'Cổng thanh toán đã xác nhận khoản hoàn. Thời điểm tiền hiển thị phụ thuộc ngân hàng phát hành.',
      amount,
    }
  }

  return {
    tone: 'pending',
    icon: 'payments',
    title: 'Hoàn tiền 100% đang được xử lý',
    description:
      'Yêu cầu đã được ghi nhận về phương thức thanh toán gốc. Không có phí hủy.',
    amount,
  }
}

export function getRecoveryRefundStage(recoveryCase) {
  const progress = recoveryCase?.refundProgress
  const transactionStatus = progress?.transaction?.status

  if (
    recoveryCase?.status === 'REFUNDED'
    || progress?.status === 'APPROVED'
    || transactionStatus === 'SUCCESS'
  ) {
    return 'CONFIRMED'
  }
  if (transactionStatus === 'NEEDS_RECONCILIATION') return 'RECONCILING'
  if (
    transactionStatus === 'PROCESSING'
    && !progress?.transaction?.submittedAt
  ) return 'PREPARING'
  if (transactionStatus === 'PROCESSING') return 'PROCESSING'
  if (transactionStatus === 'FAILED') return 'RETRY_PENDING'
  return 'QUEUED'
}

/**
 * Builds the customer-facing Rescue history from the durable case links.
 *
 * A later incident is a new RecoveryCase whose originalBookingId points to
 * the previous case's replacementBookingId.  The API deliberately keeps
 * cases independent, so the UI must join them into one understandable chain.
 */
export function buildRecoveryChain(cases, anchorCase) {
  const rows = Array.isArray(cases) ? cases : []
  const byId = new Map(rows.filter((item) => item?.id).map((item) => [String(item.id), item]))
  if (anchorCase?.id) byId.set(String(anchorCase.id), {
    ...byId.get(String(anchorCase.id)),
    ...anchorCase,
  })

  const allCases = [...byId.values()].filter((item) => item?.originalBookingId)
  if (!anchorCase?.originalBookingId) return []

  const replacementToCase = new Map(
    allCases
      .filter((item) => item.replacementBookingId)
      .map((item) => [String(item.replacementBookingId), item]),
  )

  let root = anchorCase
  const visited = new Set()
  while (root?.originalBookingId) {
    const predecessor = replacementToCase.get(String(root.originalBookingId))
    if (!predecessor || predecessor.id === root.id || visited.has(String(predecessor.id))) break
    visited.add(String(root.id))
    root = predecessor
  }

  const byOriginalBooking = new Map(
    allCases.map((item) => [String(item.originalBookingId), item]),
  )
  const chain = []
  let bookingId = String(root.originalBookingId)
  const seenBookings = new Set()
  while (bookingId && !seenBookings.has(bookingId)) {
    seenBookings.add(bookingId)
    const item = byOriginalBooking.get(bookingId)
    if (!item) break
    chain.push(item)
    if (!item.replacementBookingId) break
    bookingId = String(item.replacementBookingId)
  }

  // A detail response can be newer than the list response. Keep the detail
  // case visible even if a stale list did not contain the whole chain yet.
  if (!chain.some((item) => item.id === anchorCase.id)) chain.push(anchorCase)
  return chain
}

export function recoveryChainBookingLabel(recoveryCase, fallback = 'Booking thay thế') {
  return recoveryCase?.replacementBooking?.attractionTitle
    || recoveryCase?.selectedOption?.attractionTitle
    || fallback
}
