import { getRemainingPaymentTime, normalizeBookingStatus } from './myTicketsFilters.js'

const TERMINAL_BOOKING_STATUSES = new Set([
  'cancelled',
  'completed',
  'no_show',
  'refunded',
])

const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const asList = (value) => (Array.isArray(value) ? value : [])

const TRIP_SIGNAL_PRIORITY = Object.freeze({
  QUEUE_READY: 4,
  PROPOSAL: 3,
  AT_RISK: 2,
  QUEUE_WAITING: 1,
})

function signalDeadline(signal) {
  const candidates = signal.type === 'QUEUE_READY'
    ? [signal.item?.smartQueue?.readyExpiresAt, signal.item?.smartQueue?.expiresAt]
    : signal.type === 'PROPOSAL'
      ? [signal.proposal?.expiresAt, signal.proposal?.proposedStart]
      : [signal.item?.scheduledStart, signal.item?.smartQueue?.expiresAt]

  for (const value of candidates) {
    const timestamp = Date.parse(String(value || ''))
    if (Number.isFinite(timestamp)) return timestamp
  }
  return Number.POSITIVE_INFINITY
}

export function getVietnamDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = VIETNAM_DATE_FORMATTER.formatToParts(date)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

export function isLiveTripOperable(trip, now = new Date()) {
  if (String(trip?.status || '').toUpperCase() !== 'ACTIVE') return false
  const todayKey = getVietnamDateKey(now)
  const endDate = String(trip?.endDate || trip?.startDate || '').slice(0, 10)
  return !endDate || !todayKey || endDate >= todayKey
}

export function getUpcomingBookings(bookings, now = new Date()) {
  const parsedNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date(now)
  const referenceNow = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow
  const todayKey = getVietnamDateKey(referenceNow)
  return asList(bookings)
    .filter((booking) => {
      const status = normalizeBookingStatus(booking?.status)
      if (TERMINAL_BOOKING_STATUSES.has(status)) return false
      const visitDate = String(booking?.visitDate || '').slice(0, 10)
      return !visitDate || !todayKey || visitDate >= todayKey
    })
    .sort((left, right) => {
      const leftDate = String(left?.visitDate || '9999-12-31').slice(0, 10)
      const rightDate = String(right?.visitDate || '9999-12-31').slice(0, 10)
      return leftDate.localeCompare(rightDate)
    })
}

function isAfterNow(value, now) {
  if (!value) return true
  const timestamp = Date.parse(String(value))
  return Number.isFinite(timestamp) && timestamp > now.getTime()
}

function isItemWindowOpen(item, now) {
  if (!item?.scheduledEnd) return true
  const timestamp = Date.parse(String(item.scheduledEnd))
  return Number.isFinite(timestamp) && timestamp > now.getTime()
}

function findTripSignal(trips, now = new Date()) {
  const referenceNow = now instanceof Date && !Number.isNaN(now.getTime())
    ? now
    : new Date()
  const candidates = []

  asList(trips).forEach((trip, tripIndex) => {
    const items = asList(trip?.items)
    const proposal = asList(trip?.proposals).find(
      (candidate) => String(candidate?.status || '').toUpperCase() === 'PENDING'
        && isAfterNow(candidate?.expiresAt, referenceNow)
        && isAfterNow(candidate?.proposedStart, referenceNow),
    )
    const readyQueueItem = items.find(
      (item) => String(item?.smartQueue?.status || '').toUpperCase() === 'READY'
        && isItemWindowOpen(item, referenceNow)
        && isAfterNow(
          item?.smartQueue?.readyExpiresAt || item?.smartQueue?.expiresAt,
          referenceNow,
        ),
    )
    const atRiskItem = items.find((item) =>
      ['AT_RISK', 'REVISION_PROPOSED'].includes(String(item?.status || '').toUpperCase())
        && isItemWindowOpen(item, referenceNow),
    )
    const waitingQueueItem = items.find(
      (item) => String(item?.smartQueue?.status || '').toUpperCase() === 'WAITING'
        && isItemWindowOpen(item, referenceNow)
        && isAfterNow(item?.smartQueue?.expiresAt, referenceNow),
    )

    if (readyQueueItem) candidates.push({
      trip,
      type: 'QUEUE_READY',
      item: readyQueueItem,
      tripIndex,
      order: 0,
    })
    if (proposal) candidates.push({
      trip,
      type: 'PROPOSAL',
      proposal,
      tripIndex,
      order: 1,
    })
    if (atRiskItem) candidates.push({
      trip,
      type: 'AT_RISK',
      item: atRiskItem,
      tripIndex,
      order: 2,
    })
    if (waitingQueueItem) candidates.push({
      trip,
      type: 'QUEUE_WAITING',
      item: waitingQueueItem,
      tripIndex,
      order: 3,
    })
  })

  return candidates.sort((left, right) => {
    const priorityDelta =
      (TRIP_SIGNAL_PRIORITY[right.type] || 0) - (TRIP_SIGNAL_PRIORITY[left.type] || 0)
    if (priorityDelta !== 0) return priorityDelta

    const leftDeadline = signalDeadline(left)
    const rightDeadline = signalDeadline(right)
    if (leftDeadline !== rightDeadline) {
      if (leftDeadline === Number.POSITIVE_INFINITY) return 1
      if (rightDeadline === Number.POSITIVE_INFINITY) return -1
      return leftDeadline - rightDeadline
    }

    return (left.tripIndex - right.tripIndex) || (left.order - right.order)
  })[0] || null
}

function bookingHref(booking, type) {
  if (type === 'PAYMENT' && booking?.reservationId) {
    return `/checkout/${booking.reservationId}`
  }
  if (booking?.id) return `/tickets/${booking.id}`
  return '/my-tickets'
}

export function buildJourneyOverview({
  bookings,
  liveTrips,
  recoveryCases,
  loyaltySummary,
  now = new Date(),
} = {}) {
  const parsedNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date(now)
  const referenceNow = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow
  const bookingList = asList(bookings)
  const tripList = asList(liveTrips).filter((trip) => isLiveTripOperable(trip, referenceNow))
  const recoveryList = asList(recoveryCases)
  const upcomingBookings = getUpcomingBookings(bookingList, referenceNow)
  const openRecoveryCases = recoveryList.filter(
    (recoveryCase) => String(recoveryCase?.status || '').toUpperCase() === 'OPEN',
  )
  const unpaidBookings = upcomingBookings.filter((booking) => {
    const status = normalizeBookingStatus(booking?.status)
    return status === 'unpaid' && getRemainingPaymentTime(booking?.expiresAt, referenceNow.getTime()) > 0
  })
  const confirmedBookings = upcomingBookings.filter(
    (booking) => normalizeBookingStatus(booking?.status) === 'confirmed',
  )
  const pendingBookings = upcomingBookings.filter((booking) =>
    ['pending_partner', 'refund_requested'].includes(normalizeBookingStatus(booking?.status)),
  )
  const tripSignal = findTripSignal(tripList, referenceNow)

  let nextAction
  if (openRecoveryCases[0]) {
    nextAction = {
      eyebrow: 'Cần quyết định để bảo vệ chuyến đi',
      title: 'VietTicket Rescue đã tìm phương án thay thế',
      description:
        'Booking bị gián đoạn đang được bảo toàn giá trị. Bạn có thể chọn vé thay thế còn chỗ hoặc nhận hoàn tiền 100%.',
      label: 'Xử lý cứu chuyến',
      href: `/rescue/${openRecoveryCases[0].id}`,
      icon: 'shield',
      tone: 'critical',
      reason: 'Ưu tiên cao nhất vì có booking đang bị gián đoạn.',
    }
  } else if (tripSignal?.type === 'QUEUE_READY') {
    nextAction = {
      eyebrow: 'SmartQueue vừa gọi lượt',
      title: 'Đã đến lượt vào cổng',
      description: 'Di chuyển tới cổng và mở mã QR trong thời gian được giữ lượt.',
      label: 'Mở hành trình trực tiếp',
      href: `/trip-mode/${tripSignal.trip.id}`,
      icon: 'directions_run',
      tone: 'success',
      reason: 'Ưu tiên theo trạng thái READY của SmartQueue.',
    }
  } else if (tripSignal?.type === 'PROPOSAL' || tripSignal?.type === 'AT_RISK') {
    nextAction = {
      eyebrow: 'Autopilot phát hiện rủi ro',
      title: tripSignal.type === 'PROPOSAL'
        ? 'Có đề xuất điều chỉnh lịch cần xác nhận'
        : 'Một hoạt động cần được theo dõi',
      description:
        'Hệ thống đã đối chiếu lịch, quota vé và nhu cầu quan sát trên VietTicket. Mọi thay đổi vẫn cần bạn quyết định.',
      label: 'Xem phân tích',
      href: `/trip-mode/${tripSignal.trip.id}`,
      icon: 'auto_awesome',
      tone: 'warning',
      reason: 'Ưu tiên theo tín hiệu vận hành trong Live Trip.',
    }
  } else if (unpaidBookings[0]) {
    nextAction = {
      eyebrow: 'Giữ chỗ có thời hạn',
      title: `Hoàn tất thanh toán cho ${unpaidBookings[0].attractionTitle || 'booking của bạn'}`,
      description: 'Kho vé đang được giữ tạm thời. Thanh toán trước khi bộ đếm kết thúc để không mất chỗ.',
      label: 'Thanh toán ngay',
      href: bookingHref(unpaidBookings[0], 'PAYMENT'),
      icon: 'timer',
      tone: 'warning',
      reason: 'Ưu tiên vì reservation chưa thanh toán có thời gian hết hạn.',
    }
  } else if (tripList[0]) {
    nextAction = {
      eyebrow: 'Chuyến đi đang hoạt động',
      title: tripSignal?.type === 'QUEUE_WAITING'
        ? 'SmartQueue đang giữ vị trí của bạn'
        : 'Theo dõi hành trình theo thời gian thực',
      description:
        'Kiểm tra lịch, nhu cầu VietTicket, SmartQueue và các cảnh báo vận hành mới nhất.',
      label: 'Mở Live Trip',
      href: `/trip-mode/${tripList[0].id}`,
      icon: 'explore',
      tone: 'live',
      reason: 'Ưu tiên vì có Live Trip đang hoạt động trong ngày.',
    }
  } else if (confirmedBookings[0]) {
    nextAction = {
      eyebrow: 'Vé đã sẵn sàng',
      title: `Chuẩn bị cho ${confirmedBookings[0].attractionTitle || 'chuyến đi sắp tới'}`,
      description:
        'Kiểm tra ngày, khung giờ và mở sẵn QR trước khi đến cổng để quá trình check-in nhanh hơn.',
      label: 'Mở vé QR',
      href: bookingHref(confirmedBookings[0], 'TICKET'),
      icon: 'qr_code_2',
      tone: 'success',
      reason: 'Ưu tiên booking đã xác nhận có ngày sử dụng gần nhất.',
    }
  } else if (pendingBookings[0]) {
    const isRefund = normalizeBookingStatus(pendingBookings[0].status) === 'refund_requested'
    nextAction = {
      eyebrow: isRefund ? 'Đang bảo vệ dòng tiền' : 'Booking đang được xử lý',
      title: isRefund ? 'Yêu cầu hoàn tiền đang được theo dõi' : 'Đang chờ đối tác xác nhận dịch vụ',
      description: isRefund
        ? 'Bạn sẽ nhận cập nhật khi yêu cầu được kiểm tra và hoàn về phương thức thanh toán gốc.'
        : 'Tồn kho đã được ghi nhận; hệ thống sẽ thông báo ngay khi đối tác phản hồi.',
      label: 'Theo dõi booking',
      href: '/my-tickets',
      icon: isRefund ? 'currency_exchange' : 'hourglass_top',
      tone: 'neutral',
      reason: 'Ưu tiên trạng thái nghiệp vụ đang chờ xử lý.',
    }
  } else {
    nextAction = {
      eyebrow: 'Bắt đầu một hành trình mới',
      title: 'Khám phá trải nghiệm phù hợp với bạn',
      description:
        'Tìm theo nhu cầu, tạo lịch trình AI hoặc mời cả nhóm bình chọn trước khi đặt vé.',
      label: 'Khám phá ngay',
      href: '/attractions',
      icon: 'travel_explore',
      tone: 'live',
      reason: 'Hiện không có booking nào cần xử lý.',
    }
  }

  return {
    nextAction,
    upcomingBookings,
    activeTrips: tripList,
    openRecoveryCases,
    counts: {
      actionRequired:
        openRecoveryCases.length
        + unpaidBookings.length
        + (tripSignal && ['QUEUE_READY', 'PROPOSAL', 'AT_RISK'].includes(tripSignal.type) ? 1 : 0),
      readyTickets: confirmedBookings.length,
      activeTrips: tripList.length,
      pendingBookings: pendingBookings.length,
      rewardPoints: Math.max(0, Number(loyaltySummary?.redeemable) || 0),
    },
  }
}
