export function formatManualApprovalDeadline(value) {
  if (!value) return 'Chưa xác định'
  const deadline = new Date(value)
  if (Number.isNaN(deadline.getTime())) return 'Chưa xác định'
  return deadline.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function getManualApprovalTiming(booking, now = Date.now()) {
  const deadlineValue = booking?.manualApproval?.approvalDeadline
    || booking?.approvalDeadline
  const deadlineMs = new Date(deadlineValue || '').getTime()
  if (!Number.isFinite(deadlineMs)) {
    return {
      deadlineLabel: 'Chưa xác định',
      isOverdue: false,
      remainingMs: null,
    }
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const remainingMs = Math.max(0, deadlineMs - (Number.isFinite(nowMs) ? nowMs : Date.now()))
  return {
    deadlineLabel: formatManualApprovalDeadline(deadlineValue),
    isOverdue: remainingMs === 0,
    remainingMs,
  }
}
