const TERMINAL_ITEM_STATUSES = new Set(['COMPLETED', 'SKIPPED'])
const RISK_ITEM_STATUSES = new Set(['AT_RISK', 'REVISION_PROPOSED'])

const asList = (value) => (Array.isArray(value) ? value : [])
const asFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isNotExpired(value, referenceNow) {
  if (value === null || value === undefined || value === '') return true
  const date = asDate(value)
  return Boolean(date && date > referenceNow)
}

function isItemWindowOpen(item, referenceNow) {
  if (!item?.scheduledEnd) return true
  const end = asDate(item.scheduledEnd)
  return Boolean(end && end > referenceNow)
}

function byScheduledStart(left, right) {
  const leftTime = asDate(left?.scheduledStart)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const rightTime = asDate(right?.scheduledStart)?.getTime() ?? Number.MAX_SAFE_INTEGER
  return leftTime - rightTime
}

function activityAnchor(item) {
  return item?.id ? `#activity-${encodeURIComponent(item.id)}` : '#live-itinerary'
}

function itemTitle(item) {
  return item?.snapshot?.title || item?.attraction?.title || 'hoạt động tiếp theo'
}

export function getLiveTripProgress(trip) {
  const items = asList(trip?.items)
  const completed = items.filter((item) =>
    TERMINAL_ITEM_STATUSES.has(String(item?.status || '').toUpperCase()),
  ).length
  const total = items.length

  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  }
}

export function hasOpenTripActivityWindow(trip, now = new Date()) {
  const referenceNow = asDate(now) || new Date()
  const items = asList(trip?.items)
  if (items.length === 0) return false

  return items.some((item) => {
    const status = String(item?.status || '').toUpperCase()
    if (TERMINAL_ITEM_STATUSES.has(status)) return false
    if (!item?.scheduledEnd) return true
    const end = asDate(item.scheduledEnd)
    return Boolean(end && end > referenceNow)
  })
}

export function getLiveTripCommandState(trip, now = new Date(), { interactive = true } = {}) {
  const referenceNow = asDate(now) || new Date()
  const items = [...asList(trip?.items)].sort(byScheduledStart)
  const proposals = asList(trip?.proposals)
    .filter((proposal) => {
      if (String(proposal?.status || 'PENDING').toUpperCase() !== 'PENDING') return false
      return isNotExpired(proposal?.expiresAt, referenceNow)
        && isNotExpired(proposal?.proposedStart, referenceNow)
    })
    .sort((left, right) => {
      const leftTime = asDate(left?.expiresAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
      const rightTime = asDate(right?.expiresAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
      return leftTime - rightTime
    })

  if (!interactive) {
    return {
      kind: 'COMPLETE',
      tone: 'neutral',
      icon: 'task_alt',
      eyebrow: 'Hành trình đã được lưu',
      title: items.length > 0 ? 'Không còn hành động khẩn cấp' : 'Chưa có hoạt động để theo dõi',
      description: items.length > 0
        ? 'Chuyến đã khóa thao tác. Nhật ký quyết định, SmartQueue và các tín hiệu vận hành vẫn được giữ để đối chiếu.'
        : 'Live Trip chưa nhận được hoạt động hợp lệ từ lịch trình đã lưu.',
      primaryHref: '/journey',
      primaryLabel: 'Về Trung tâm hành trình',
    }
  }

  const readyItem = items
    .filter((item) => {
      if (String(item?.smartQueue?.status || '').toUpperCase() !== 'READY') return false
      const queue = item.smartQueue
      return isItemWindowOpen(item, referenceNow)
        && isNotExpired(queue?.readyExpiresAt || queue?.expiresAt, referenceNow)
    })
    .sort((left, right) => {
      const leftTime = asDate(left?.smartQueue?.readyExpiresAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
      const rightTime = asDate(right?.smartQueue?.readyExpiresAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
      return leftTime - rightTime
    })[0]

  if (readyItem) {
    const queue = readyItem.smartQueue
    const paused = Boolean(queue?.policy?.paused)
    return {
      kind: paused ? 'QUEUE_READY_PAUSED' : 'QUEUE_READY',
      tone: paused ? 'warning' : 'success',
      icon: paused ? 'pause_circle' : 'directions_run',
      eyebrow: paused ? 'Quyền lợi đang được bảo lưu' : 'Ưu tiên ngay lúc này',
      title: paused ? 'Cổng đang tạm dừng xử lý' : 'SmartQueue đã gọi lượt của bạn',
      description: paused
        ? `Giữ nguyên thứ tự cho ${itemTitle(readyItem)}; countdown chỉ tiếp tục khi cổng hoạt động lại.`
        : `Di chuyển đến cổng VietTicket của ${itemTitle(readyItem)} và mở mã QR trước khi cửa sổ quay lại kết thúc.`,
      item: readyItem,
      targetAt: paused ? null : queue?.readyExpiresAt || null,
      primaryHref: readyItem.bookingId
        ? `/tickets/${encodeURIComponent(readyItem.bookingId)}`
        : activityAnchor(readyItem),
      primaryLabel: readyItem.bookingId ? 'Mở vé QR ngay' : 'Xem lượt SmartQueue',
      secondaryHref: activityAnchor(readyItem),
      secondaryLabel: 'Xem chi tiết lượt',
    }
  }

  const proposal = proposals[0]
  if (proposal) {
    const item = items.find((candidate) => candidate.id === proposal.liveTripItemId) || null
    return {
      kind: 'PROPOSAL',
      tone: 'violet',
      icon: 'auto_awesome',
      eyebrow: 'Autopilot cần bạn quyết định',
      title: `Có đề xuất an toàn cho ${itemTitle(item)}`,
      description:
        'Hệ thống đã đối chiếu quota VietTicket, mức nhu cầu và xung đột lịch. Lịch chỉ thay đổi sau khi bạn xác nhận.',
      item,
      proposal,
      targetAt: proposal.expiresAt || null,
      primaryHref: activityAnchor(item),
      primaryLabel: 'Xem bằng chứng & quyết định',
    }
  }

  const waitingItem = items.find(
    (item) => String(item?.smartQueue?.status || '').toUpperCase() === 'WAITING'
      && isItemWindowOpen(item, referenceNow)
      && isNotExpired(item?.smartQueue?.expiresAt, referenceNow),
  )
  if (waitingItem) {
    const queue = waitingItem.smartQueue
    const hasEta = queue?.estimatedWaitMinutes !== null
      && queue?.estimatedWaitMinutes !== undefined
      && queue?.estimatedWaitMinutes !== ''
      && Number.isFinite(Number(queue.estimatedWaitMinutes))
    return {
      kind: 'QUEUE_WAITING',
      tone: 'cyan',
      icon: 'hourglass_top',
      eyebrow: 'SmartQueue đang bảo vệ vị trí',
      title: queue?.position
        ? `Bạn đang ở vị trí #${queue.position}`
        : 'Vị trí của bạn đang được đồng bộ',
      description: hasEta
        ? `Ước tính còn ${Number(queue.estimatedWaitMinutes)} phút với ${Number(queue.guestsAhead || 0)} khách phía trước.`
        : 'Hệ thống đang đo nhịp check-in QR để cập nhật thời gian chờ bảo thủ.',
      item: waitingItem,
      primaryHref: activityAnchor(waitingItem),
      primaryLabel: 'Theo dõi hàng chờ',
    }
  }

  const atRiskItem = items.find((item) =>
    RISK_ITEM_STATUSES.has(String(item?.status || '').toUpperCase())
      && isItemWindowOpen(item, referenceNow),
  )
  if (atRiskItem) {
    return {
      kind: 'AT_RISK',
      tone: 'warning',
      icon: 'shield_with_heart',
      eyebrow: 'Autopilot đang bảo vệ lịch',
      title: `${itemTitle(atRiskItem)} cần được theo dõi`,
      description: atRiskItem.bookingId
        ? 'Booking đã thanh toán được khóa an toàn; hệ thống chỉ cảnh báo và không tự ý đổi hoặc hủy vé.'
        : 'Chưa có phương án thay thế đủ điều kiện. Hệ thống tiếp tục theo dõi và không tự thay đổi lịch.',
      item: atRiskItem,
      primaryHref: activityAnchor(atRiskItem),
      primaryLabel: 'Xem nguyên nhân',
    }
  }

  const currentItem = items.find((item) => {
    if (TERMINAL_ITEM_STATUSES.has(String(item?.status || '').toUpperCase())) return false
    const start = asDate(item?.scheduledStart)
    const end = asDate(item?.scheduledEnd)
    return start && start <= referenceNow && (!end || end > referenceNow)
  })
  if (currentItem) {
    return {
      kind: 'IN_PROGRESS',
      tone: 'live',
      icon: 'explore',
      eyebrow: 'Đang trong khung hoạt động',
      title: itemTitle(currentItem),
      description:
        'Giữ sẵn mã QR nếu có booking và theo dõi các tín hiệu vận hành mới trong Live Trip.',
      item: currentItem,
      primaryHref: currentItem.bookingId
        ? `/tickets/${encodeURIComponent(currentItem.bookingId)}`
        : activityAnchor(currentItem),
      primaryLabel: currentItem.bookingId ? 'Mở vé QR' : 'Xem hoạt động',
    }
  }

  const upcomingItem = items.find((item) => {
    if (TERMINAL_ITEM_STATUSES.has(String(item?.status || '').toUpperCase())) return false
    const start = asDate(item?.scheduledStart)
    return start && start > referenceNow
  })
  if (upcomingItem) {
    return {
      kind: 'UPCOMING',
      tone: 'live',
      icon: 'schedule',
      eyebrow: 'Hoạt động tiếp theo',
      title: itemTitle(upcomingItem),
      description:
        'Autopilot tiếp tục đối chiếu lịch, booking, quota VietTicket và tín hiệu nhu cầu trước giờ bắt đầu.',
      item: upcomingItem,
      targetAt: upcomingItem.scheduledStart,
      primaryHref: activityAnchor(upcomingItem),
      primaryLabel: 'Xem kế hoạch',
    }
  }

  return {
    kind: 'COMPLETE',
    tone: 'neutral',
    icon: 'task_alt',
    eyebrow: 'Hành trình đã được lưu',
    title: items.length > 0 ? 'Không còn hành động khẩn cấp' : 'Chưa có hoạt động để theo dõi',
    description: items.length > 0
      ? 'Nhật ký quyết định, SmartQueue và các tín hiệu vận hành vẫn được giữ để đối chiếu.'
      : 'Live Trip chưa nhận được hoạt động hợp lệ từ lịch trình đã lưu.',
    primaryHref: '/journey',
    primaryLabel: 'Về Trung tâm hành trình',
  }
}

export function getSimulationPresentation(simulation) {
  if (!simulation || typeof simulation !== 'object') return null
  const algorithm = String(simulation.algorithm_version || '')
  const constraints = simulation.constraints && typeof simulation.constraints === 'object'
    ? simulation.constraints
    : {}
  const baselineRaw = Number(simulation.baseline_score)
  const optimizedRaw = Number(simulation.optimized_score)
  const baseline = asFiniteNumber(baselineRaw)
  const optimized = asFiniteNumber(optimizedRaw)
  const proposals = asList(simulation.proposals)
  const fallback = !algorithm
    || algorithm.startsWith('optimizer_unavailable')
    || Boolean(constraints.reason)

  const safeguards = [
    constraints.locked_items_immutable === true
      ? 'Booking đã liên kết được khóa bất biến'
      : null,
    constraints.no_overlapping_windows === true
      ? 'Không còn xung đột khung giờ'
      : null,
    constraints.day_index_isolated === true
      ? 'Tối ưu độc lập theo từng ngày'
      : null,
    Number.isFinite(Number(constraints.travel_buffer_minutes))
      ? `Đệm di chuyển ${Number(constraints.travel_buffer_minutes)} phút`
      : null,
    constraints.timezone ? `Múi giờ ${constraints.timezone}` : null,
  ].filter(Boolean)

  return {
    algorithm,
    baseline,
    optimized,
    improvement: optimized - baseline,
    // Zero is a valid score, so validity must be tracked separately from the
    // sanitized display values. A fallback/invalid response must never look
    // like a successful 0.0 → 0.0 optimization.
    metricsAvailable: !fallback && Number.isFinite(baselineRaw) && Number.isFinite(optimizedRaw),
    hasRegression: optimized < baseline,
    fallback,
    failureReason: constraints.reason || null,
    proposals,
    safeguards,
    hasConstraintViolations:
      Array.isArray(constraints.constraint_violations)
      && constraints.constraint_violations.length > 0,
  }
}

export function formatMinuteOfDay(value) {
  const minute = Number(value)
  if (!Number.isInteger(minute) || minute < 0 || minute > 24 * 60) return '—'
  const bounded = Math.min(minute, 24 * 60 - 1)
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`
}
