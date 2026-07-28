const STATUS_PRIORITY = {
  OPEN: 0,
  REFUND_PENDING: 1,
  REPLACED: 2,
  REFUNDED: 3,
}

const timestamp = (value, fallback = 0) => {
  const parsed = new Date(value || 0).getTime()
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
