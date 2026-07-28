import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import RefundModal from '../components/tickets/RefundModal.jsx'
import ReviewModal from '../components/tickets/ReviewModal.jsx'
import useSocket from '../context/useSocket.js'
import bookingService from '../services/bookingService.js'
import { getLiveTrips } from '../services/liveTripApi.js'
import { listRecoveryCases } from '../services/recoveryApi.js'
import { getBookingStatusMeta } from '../utils/bookingStatus.js'
import { formatBookingReference } from '../utils/bookingReference.js'
import { hasUsableTicketInstances } from '../utils/ticketInstanceStatus.js'
import { sortRecoveryCases } from '../utils/recoveryPresentation.js'
import {
  filterBookingsByTicketTab,
  getRemainingPaymentTime,
  isPaymentExpired,
  normalizeBookingStatus,
} from '../utils/myTicketsFilters.js'
import { isLiveTripOperable } from '../utils/journeyCenter.js'

const tabs = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unpaid', label: 'Chờ thanh toán' },
  { id: 'active', label: 'Đang sử dụng' },
  { id: 'history', label: 'Lịch sử' },
]

const fallbackImage =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80'

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const formatDate = (value) => {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

const formatBookingCode = formatBookingReference

const formatCountdown = (milliseconds) => {
  const safeMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0
  const totalSeconds = Math.ceil(safeMilliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const getTicketOverviewItems = (bookings, nowMs, recoveryCases = []) => {
  const list = Array.isArray(bookings) ? bookings : []
  const unpaidCount = list.filter((booking) => {
    const status = normalizeBookingStatus(booking.status)
    return status === 'unpaid' && !isPaymentExpired(booking, nowMs)
  }).length
  const readyCount = list.filter((booking) => {
    const status = normalizeBookingStatus(booking.status)
    return status === 'confirmed' && hasUsableTicketInstances(booking.ticketInstances)
  }).length
  const watchingBookingIds = new Set()
  list.forEach((booking, index) => {
    if (['pending_partner', 'refund_requested'].includes(normalizeBookingStatus(booking.status))) {
      watchingBookingIds.add(`booking:${booking.id || index}`)
    }
  })
  recoveryCases.forEach((recoveryCase, index) => {
    if (['OPEN', 'REFUND_PENDING'].includes(recoveryCase.status)) {
      watchingBookingIds.add(
        recoveryCase.originalBookingId
          ? `booking:${recoveryCase.originalBookingId}`
          : `rescue:${recoveryCase.id || index}`,
      )
    }
  })
  const watchingCount = watchingBookingIds.size

  return [
    {
      label: 'Cần thanh toán',
      value: unpaidCount,
      description: 'Đơn giữ chỗ còn hạn',
      icon: 'timer',
      tone: 'bg-[#fff8e2] text-[#6b4b00]',
    },
    {
      label: 'Vé sẵn sàng',
      value: readyCount,
      description: 'Có thể mở QR tại cổng',
      icon: 'qr_code_2',
      tone: 'bg-[#eefcff] text-[#00474d]',
    },
    {
      label: 'Cần theo dõi',
      value: watchingCount,
      description: 'Chờ duyệt, Rescue hoặc hoàn tiền',
      icon: 'hourglass_top',
      tone: 'bg-[#f6f3ff] text-[#4d3f77]',
    },
  ]
}

function canReviewNow(booking) {
  return String(booking.status || '').toLowerCase() === 'completed'
}

function MyTicketsPage() {
  const navigate = useNavigate()
  const socket = useSocket()
  const [activeTab, setActiveTab] = useState('all')
  const [bookings, setBookings] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedReviewBooking, setSelectedReviewBooking] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [liveTrips, setLiveTrips] = useState([])
  const [recoveryCases, setRecoveryCases] = useState([])
  const [recoverySyncFailed, setRecoverySyncFailed] = useState(false)
  const refreshSequence = useRef(0)
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true

    getLiveTrips()
      .then((response) => {
        if (active) setLiveTrips(Array.isArray(response?.data) ? response.data : [])
      })
      .catch(() => {
        // Trip Mode is an additional surface; a temporary failure must not hide tickets.
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function handleBookingStatusUpdated(payload) {
      const status = String(payload.status || '').toLowerCase()
      const shortCode = formatBookingReference(payload.bookingId)

      let message = payload.message
      if (!message) {
        if (status === 'confirmed' || status === 'completed') {
          message = `Đặt vé ${shortCode} của bạn đã được phê duyệt thành công!`
        } else if (status === 'pending_partner') {
          message = `Đơn hàng ${shortCode} đã thanh toán thành công và đang chờ đối tác phê duyệt.`
        } else if (status === 'refunded') {
          message = `Khoản hoàn tiền của đơn hàng ${shortCode} đã được xác nhận.`
        } else if (['refund_requested', 'processing', 'refund_pending'].includes(status)) {
          message = `Khoản hoàn tiền của đơn hàng ${shortCode} đang được xử lý.`
        } else {
          message = `Rất tiếc, yêu cầu đặt vé ${shortCode} đã bị từ chối.`
        }
      }

      if (['confirmed', 'completed', 'refunded'].includes(status)) toast.success(message)
      else if (['pending_partner', 'refund_requested', 'processing', 'refund_pending'].includes(status)) {
        toast.info(message)
      } else toast.warning(message)

      setBookings((current) =>
        current.map((booking) =>
          String(booking.id) === String(payload.bookingId) ? { ...booking, status } : booking,
        ),
      )

      const sequence = ++refreshSequence.current
      void bookingService
        .getBookings()
        .then((data) => {
          if (sequence !== refreshSequence.current) return
          setBookings(data)
          setErrorMessage('')
        })
        .catch(() => {
          // The optimistic status update remains visible until the next normal fetch.
        })
    }

    socket.on('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    return () => {
      socket.off('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    }
  }, [socket])

  useEffect(() => {
    let active = true
    const refreshAll = async () => {
      const sequence = ++refreshSequence.current
      if (!hasLoadedRef.current) setIsLoading(true)
      const [bookingResult, recoveryResult] = await Promise.allSettled([
        bookingService.getBookings(),
        listRecoveryCases(),
      ])
      if (!active || sequence !== refreshSequence.current) return
      if (bookingResult.status === 'fulfilled') {
        setBookings(bookingResult.value)
        setErrorMessage('')
      } else {
        setErrorMessage(bookingResult.reason?.message || 'Không thể tải danh sách vé.')
      }
      if (recoveryResult.status === 'fulfilled') {
        setRecoveryCases(sortRecoveryCases(recoveryResult.value))
        setRecoverySyncFailed(false)
      } else {
        setRecoverySyncFailed(true)
      }
      hasLoadedRef.current = true
      setIsLoading(false)
    }
    void refreshAll()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshAll()
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll()
    }, 45000)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  useEffect(() => {
    const refreshRecoveryCases = () => {
      const sequence = ++refreshSequence.current
      void Promise.allSettled([
        listRecoveryCases(),
        bookingService.getBookings(),
      ]).then(([recoveryResult, bookingResult]) => {
        if (sequence !== refreshSequence.current) return
        if (recoveryResult.status === 'fulfilled') {
          setRecoveryCases(sortRecoveryCases(recoveryResult.value))
          setRecoverySyncFailed(false)
        } else {
          setRecoverySyncFailed(true)
        }
        if (bookingResult.status === 'fulfilled') setBookings(bookingResult.value)
      })
    }

    socket.on('RECOVERY_CASE_CREATED', refreshRecoveryCases)
    socket.on('RECOVERY_CASE_UPDATED', refreshRecoveryCases)
    return () => {
      socket.off('RECOVERY_CASE_CREATED', refreshRecoveryCases)
      socket.off('RECOVERY_CASE_UPDATED', refreshRecoveryCases)
    }
  }, [socket])

  useEffect(() => {
    const refreshAfterRefund = (payload = {}) => {
      const status = String(payload.status || '').toUpperCase()
      if (status === 'APPROVED') {
        toast.success(payload.message || 'Khoản hoàn tiền đã được cổng thanh toán xác nhận.')
      } else {
        toast.info(payload.message || 'Trạng thái hoàn tiền vừa được cập nhật.')
      }
      const sequence = ++refreshSequence.current
      void Promise.allSettled([
        bookingService.getBookings(),
        listRecoveryCases(),
      ]).then(([bookingResult, recoveryResult]) => {
        if (sequence !== refreshSequence.current) return
        if (bookingResult.status === 'fulfilled') setBookings(bookingResult.value)
        if (recoveryResult.status === 'fulfilled') {
          setRecoveryCases(sortRecoveryCases(recoveryResult.value))
          setRecoverySyncFailed(false)
        }
      })
    }
    socket.on('REFUND_STATUS_UPDATED', refreshAfterRefund)
    return () => socket.off('REFUND_STATUS_UPDATED', refreshAfterRefund)
  }, [socket])

  const refetchBookings = () => {
    const sequence = ++refreshSequence.current
    void bookingService
      .getBookings()
      .then((data) => {
        if (sequence === refreshSequence.current) setBookings(data)
      })
      .catch(() => {
        // Giữ nguyên danh sách hiện tại nếu tải lại thất bại.
      })
  }
  const retryRecoverySync = () => {
    const sequence = ++refreshSequence.current
    void listRecoveryCases()
      .then((data) => {
        if (sequence !== refreshSequence.current) return
        setRecoveryCases(sortRecoveryCases(data))
        setRecoverySyncFailed(false)
      })
      .catch(() => {
        if (sequence === refreshSequence.current) setRecoverySyncFailed(true)
      })
  }

  const filteredBookings = useMemo(
    () => filterBookingsByTicketTab(bookings, activeTab, now),
    [activeTab, bookings, now],
  )
  const overviewItems = useMemo(
    () => getTicketOverviewItems(bookings, now, recoveryCases),
    [bookings, now, recoveryCases],
  )
  const recoveryByOriginalBooking = useMemo(
    () => new Map(recoveryCases.map((recoveryCase) => [
      String(recoveryCase.originalBookingId),
      recoveryCase,
    ])),
    [recoveryCases],
  )
  const recoveryByReplacementBooking = useMemo(
    () => new Map(
      recoveryCases
        .filter((recoveryCase) => recoveryCase.replacementBookingId)
        .map((recoveryCase) => [
          String(recoveryCase.replacementBookingId),
          recoveryCase,
        ]),
    ),
    [recoveryCases],
  )
  const openRecoveryCases = useMemo(
    () => recoveryCases.filter((recoveryCase) => recoveryCase.status === 'OPEN'),
    [recoveryCases],
  )
  const activeLiveTrips = useMemo(
    () => liveTrips.filter((trip) => isLiveTripOperable(trip, new Date(now))),
    [liveTrips, now],
  )

  return (
    <>
      <Header activeLink="Hành trình" />
      <div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[1440px] bg-surface">
        <aside className="hidden w-64 shrink-0 border-r border-outline-variant/10 bg-primary p-6 md:block">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-white">Xin chào</h2>
            <p className="mt-1 text-sm font-medium text-white/75">
              Sẵn sàng cho hành trình tiếp theo
            </p>
          </div>
          <nav className="flex flex-col gap-2">
            <SidebarLink href="/profile" icon="person" label="Hồ sơ" />
            <SidebarLink href="/journey" icon="travel_explore" label="Trung tâm hành trình" />
            <SidebarLink
              active
              href="/my-tickets"
              icon="confirmation_number"
              label="Vé của tôi"
            />
            <SidebarLink href="/favorites" icon="favorite" label="Yêu thích" />
            <SidebarLink href="/my-support" icon="support_agent" label="Hỗ trợ của tôi" />
            <SidebarLink href="/change-password" icon="settings" label="Cài đặt" />
          </nav>
          <button
            className="mt-8 w-full rounded-xl bg-[#136870] px-4 py-3 font-bold text-white shadow-md transition hover:bg-[#136870]/90 active:scale-95"
            onClick={() => navigate('/attractions')}
            type="button"
          >
            Đặt chuyến mới
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-8 md:p-8 lg:px-16">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-primary md:text-4xl">Vé của tôi</h1>
            <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
              {tabs.map((tab) => (
                <button
                  className={`whitespace-nowrap rounded-full px-6 py-2.5 text-sm font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {!isLoading && bookings.length > 0 && (
            <TicketOverview items={overviewItems} />
          )}

          {activeLiveTrips.length > 0 && (
            <LiveTripStrip trips={activeLiveTrips} />
          )}

          {recoverySyncFailed && (
            <section
              className="mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm"
              role="status"
            >
              <p className="font-semibold leading-6 text-amber-950">
                Chưa thể đồng bộ trạng thái Rescue mới nhất. Danh sách vé bên dưới vẫn được giữ nguyên.
              </p>
              <button
                className="rounded-xl border border-amber-400 bg-white px-4 py-2 font-extrabold text-amber-900 hover:bg-amber-100"
                type="button"
                onClick={retryRecoverySync}
              >
                Thử đồng bộ lại
              </button>
            </section>
          )}

          {openRecoveryCases.length > 0 && (
            <OpenRescueStrip recoveryCases={openRecoveryCases} />
          )}

          <div className="flex max-w-4xl flex-col gap-6">
            {isLoading ? (
              <p className="py-12 text-center font-semibold text-primary">
                Đang tải danh sách vé...
              </p>
            ) : errorMessage ? (
              <p className="rounded-xl bg-red-50 p-4 text-center font-semibold text-error">
                {errorMessage}
              </p>
            ) : filteredBookings.length === 0 ? (
              <EmptyTickets activeTab={activeTab} />
            ) : (
              filteredBookings.map((booking) => (
                <TicketCard
                  booking={booking}
                  key={booking.id}
                  now={now}
                  onRefetch={refetchBookings}
                  onOpenReview={setSelectedReviewBooking}
                  recoveryCase={recoveryByOriginalBooking.get(String(booking.id))}
                  sourceRecoveryCase={recoveryByReplacementBooking.get(String(booking.id))}
                />
              ))
            )}
          </div>
        </main>
      </div>
      <Footer />
      {selectedReviewBooking && (
        <ReviewModal
          booking={selectedReviewBooking}
          onClose={() => setSelectedReviewBooking(null)}
          onSuccess={refetchBookings}
        />
      )}
    </>
  )
}

function SidebarLink({ active = false, href, icon, label }) {
  return (
    <Link
      className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
        active
          ? 'bg-white/15 text-white shadow-sm'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
      to={href}
    >
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      {label}
    </Link>
  )
}

function TicketOverview({ items }) {
  return (
    <section className="mb-6 grid max-w-4xl gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <article
          className={`rounded-2xl p-4 shadow-sm ${item.tone}`}
          key={item.label}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-extrabold">{item.label}</span>
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
              {item.icon}
            </span>
          </div>
          <p className="mt-3 text-3xl font-extrabold">{item.value}</p>
          <p className="mt-1 text-xs font-semibold opacity-80">{item.description}</p>
        </article>
      ))}
    </section>
  )
}

function LiveTripStrip({ trips }) {
  return (
    <section className="mb-6 max-w-4xl rounded-2xl border border-[#b7e9e6] bg-[#effcfb] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#00858a]">VietTicket Live</p>
          <h2 className="mt-1 text-lg font-black text-primary">Chuyến đi đang được theo dõi</h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#006b72]">
          {trips.length} chuyến đang bật
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {trips.map((trip) => (
          <Link
            className="group rounded-xl border border-[#c9ece9] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#00858a] hover:shadow-sm"
            key={trip.id}
            to={`/trip-mode/${trip.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-primary">{trip.title}</p>
                <p className="mt-1 text-xs font-medium text-on-surface-variant">
                  {formatDate(trip.startDate)} · {trip.itemCount || 0} hoạt động
                </p>
              </div>
              <span className="material-symbols-outlined text-[#00858a] transition group-hover:translate-x-0.5" aria-hidden="true">
                arrow_forward
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function OpenRescueStrip({ recoveryCases }) {
  const urgentCase = recoveryCases[0]
  return (
    <section
      className="mb-6 max-w-4xl overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-sm"
      aria-labelledby="open-rescue-title"
    >
      <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-amber-800">
            VietTicket Rescue · {recoveryCases.length} booking cần quyết định
          </p>
          <h2 className="mt-1 text-xl font-black text-primary" id="open-rescue-title">
            Kế hoạch tại {urgentCase.original?.attractionTitle} cần bạn xem ngay
          </h2>
          <p className="mt-1 text-sm leading-6 text-on-surface-variant">
            Đổi sang vé còn chỗ mà không thanh toán lại, hoặc nhận hoàn tiền 100%.
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white"
          to={`/rescue/${urgentCase.id}`}
        >
          Xem phương án
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            arrow_forward
          </span>
        </Link>
      </div>
    </section>
  )
}

function RecoveryBookingNotice({ recoveryCase, sourceRecoveryCase }) {
  return (
    <div className="space-y-3">
      {sourceRecoveryCase && sourceRecoveryCase.id !== recoveryCase?.id && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">
            <span className="material-symbols-outlined mr-2 align-middle text-[19px]" aria-hidden="true">
              published_with_changes
            </span>
            Vé thay thế cho {formatBookingReference(sourceRecoveryCase.originalBookingId)}
          </p>
          <Link
            className="font-extrabold text-emerald-800 underline-offset-4 hover:underline"
            to={`/rescue/${sourceRecoveryCase.id}`}
          >
            Xem lịch sử Rescue
          </Link>
        </div>
      )}

      {recoveryCase?.status === 'OPEN' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-950">
            Vé bị gián đoạn — phương án thay thế đang chờ bạn
          </p>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            {recoveryCase.reason}. Quyền hoàn 100% vẫn được giữ.
          </p>
          <Link
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-800 px-4 py-2 text-sm font-extrabold text-white"
            to={`/rescue/${recoveryCase.id}`}
          >
            Chọn đổi vé hoặc hoàn tiền
            <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        </div>
      )}

      {recoveryCase?.status === 'REPLACED' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">
            Kế hoạch đã được cứu bằng booking{' '}
            <strong>{formatBookingReference(recoveryCase.replacementBookingId)}</strong>.
          </p>
          <Link className="font-extrabold text-emerald-800" to={`/rescue/${recoveryCase.id}`}>
            Xem chi tiết
          </Link>
        </div>
      )}

      {recoveryCase?.status === 'REFUND_PENDING' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
          <p className="font-semibold text-sky-900">
            Hoàn 100% đang được xử lý về phương thức thanh toán gốc.
          </p>
          <Link className="font-extrabold text-sky-800" to={`/rescue/${recoveryCase.id}`}>
            Theo dõi khoản hoàn
          </Link>
        </div>
      )}

      {recoveryCase?.status === 'REFUNDED' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-800">
            Cổng thanh toán đã xác nhận hoàn 100% cho booking này.
          </p>
          <Link className="font-extrabold text-primary" to={`/rescue/${recoveryCase.id}`}>
            Xem xác nhận
          </Link>
        </div>
      )}
    </div>
  )
}

function TicketCard({
  booking,
  now,
  onRefetch,
  onOpenReview,
  recoveryCase,
  sourceRecoveryCase,
}) {
  const [showRefund, setShowRefund] = useState(false)
  const status = normalizeBookingStatus(booking.status)
  const remainingTime = getRemainingPaymentTime(booking.expiresAt, now)
  const isExpired = isPaymentExpired(booking, now)
  const hasUsableQr = hasUsableTicketInstances(booking.ticketInstances)
  const quantityText = `${booking.quantity || 1} vé`

  return (
    <>
    <article className="group overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-[0_4px_20px_rgba(0,40,50,0.05)] transition hover:shadow-[0_8px_30px_rgba(0,40,50,0.08)] md:flex">
      <div className="h-48 overflow-hidden md:h-auto md:w-64 md:shrink-0">
        <img
          alt={booking.attractionTitle}
          className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
          src={booking.attractionImage || fallbackImage}
        />
      </div>
      <div className="flex flex-1 flex-col justify-between p-6">
        <div>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-on-surface">
                {booking.attractionTitle}
              </h2>
              <p className="mt-1 flex items-center gap-1 text-sm font-medium text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  location_on
                </span>
                {booking.attractionLocation}
              </p>
            </div>
            <StatusBadge booking={booking} isExpired={isExpired} />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <TicketFact label="Mã đặt chỗ" title={formatBookingCode(booking.id)} value={formatBookingCode(booking.id)} />
            <TicketFact label="Ngày" value={formatDate(booking.visitDate)} />
            <TicketFact label="Số lượng" value={quantityText} />
            <TicketFact
              emphasized
              label="Giá"
              value={formatCurrency(booking.totalAmount)}
            />
          </div>
        </div>

        {(recoveryCase || sourceRecoveryCase) && (
          <div className="mb-4">
            <RecoveryBookingNotice
              recoveryCase={recoveryCase}
              sourceRecoveryCase={sourceRecoveryCase}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-outline-variant/30 pt-4">
          {status === 'unpaid' && !isExpired && (
            <>
              <span className="mr-auto flex items-center gap-1 text-sm font-semibold text-error">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  timer
                </span>
                {formatCountdown(remainingTime)} còn lại
              </span>
              <Link
                className="rounded-xl bg-primary px-7 py-2.5 font-bold text-on-primary transition hover:brightness-110 active:scale-95"
                to={`/checkout/${booking.reservationId}`}
              >
                Thanh toán ngay
              </Link>
            </>
          )}
          {status === 'confirmed' && (
            <>
              {booking.refundRequest?.status === 'REJECTED' ? (
                <div className="mr-auto flex items-start gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm">
                  <span
                    className="material-symbols-outlined mt-0.5 text-[18px] text-error"
                    aria-hidden="true"
                  >
                    block
                  </span>
                  <div>
                    <p className="font-bold text-error">Yêu cầu hoàn tiền đã bị từ chối</p>
                    {booking.refundRequest.staffNotes && (
                      <p className="mt-0.5 text-xs text-on-surface-variant">
                        Lý do: {booking.refundRequest.staffNotes}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-error transition hover:bg-error/5 active:scale-95"
                  onClick={() => setShowRefund(true)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    currency_exchange
                  </span>
                  Yêu cầu hoàn tiền
                </button>
              )}
              <Link
                className="flex items-center gap-2 rounded-xl border border-primary px-7 py-2.5 font-bold text-primary transition hover:bg-primary/5 active:scale-95"
                to={`/tickets/${booking.id}`}
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  {hasUsableQr ? 'qr_code_2' : 'receipt_long'}
                </span>
                {hasUsableQr ? 'Xem mã QR' : 'Xem chi tiết vé'}
              </Link>
            </>
          )}
          {status === 'refund_requested' && (
            <span className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                hourglass_top
              </span>
              Đang chờ duyệt hoàn tiền
              {booking.refundRequest
                ? ` — dự kiến nhận ${formatCurrency(booking.refundRequest.amount)}`
                : ''}
            </span>
          )}
          {status === 'refunded' && (
            <span className="flex items-center gap-1 text-sm font-semibold text-primary">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                price_check
              </span>
              Đã hoàn {booking.refundRequest ? formatCurrency(booking.refundRequest.amount) : 'tiền'}
              {' — tiền về tài khoản trong 3-5 ngày làm việc'}
            </span>
          )}
          {canReviewNow(booking) && !(booking.reviewed || booking.review) && (
            <button
              className="flex items-center gap-2 rounded-xl bg-secondary-container text-on-secondary-container px-7 py-2.5 font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-sm"
              onClick={() => onOpenReview(booking)}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                rate_review
              </span>
              Đánh giá ngay
            </button>
          )}
          {canReviewNow(booking) && (booking.reviewed || booking.review) && (
            <>
              <div className="flex gap-0.5 text-[#feb700] mr-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className="material-symbols-outlined text-[18px]"
                    style={{ fontVariationSettings: i < (booking.rating || booking.review?.rating || 5) ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    star
                  </span>
                ))}
              </div>
              <button
                className="flex items-center gap-2 rounded-xl bg-surface-container text-on-surface-variant px-7 py-2.5 font-bold cursor-default"
                disabled
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  check_circle
                </span>
                Đã gửi đánh giá
              </button>
            </>
          )}
          {isExpired && (
            <span className="text-sm font-semibold text-on-surface-variant">
              Thời gian giữ vé đã kết thúc
            </span>
          )}
        </div>
      </div>
    </article>
    {showRefund && (
      <RefundModal
        booking={booking}
        onClose={() => setShowRefund(false)}
        onSuccess={onRefetch}
      />
    )}
    </>
  )
}

function StatusBadge({ booking, isExpired }) {
  // Nhãn + màu lấy từ nguồn dùng chung; riêng 2 trường hợp đặc thù của trang này
  // (đơn quá hạn thanh toán, đơn hoàn thành đã đánh giá) thì ghi đè tại chỗ.
  const status = normalizeBookingStatus(booking.status)
  let statusConfig
  if (isExpired) {
    statusConfig = { label: 'Đã hết hạn', className: 'bg-surface-container-high text-on-surface-variant' }
  } else if (status === 'completed' && (booking.reviewed || booking.review)) {
    statusConfig = { label: 'Đã xong & Đánh giá', className: 'bg-outline text-white' }
  } else {
    statusConfig = getBookingStatusMeta(status)
  }

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusConfig.className}`}>
      {statusConfig.label}
    </span>
  )
}

function TicketFact({ emphasized = false, label, title, value }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p
        className={emphasized ? 'text-lg font-bold text-primary' : 'font-semibold text-on-surface'}
        title={title}
      >
        {value}
      </p>
    </div>
  )
}

function EmptyTickets({ activeTab }) {
  return (
    <div className="rounded-2xl border border-dashed border-outline-variant bg-white px-6 py-16 text-center">
      <span className="material-symbols-outlined text-5xl text-primary" aria-hidden="true">
        confirmation_number
      </span>
      <h2 className="mt-4 text-xl font-bold text-on-surface">Chưa có vé phù hợp</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-variant">
        {activeTab === 'all'
          ? 'Các vé bạn đặt sẽ xuất hiện tại đây và được lưu lại ngay cả khi tải lại trang.'
          : 'Không có vé nào trong trạng thái này.'}
      </p>
      <Link
        className="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-bold text-on-primary"
        to="/attractions"
      >
        Khám phá điểm tham quan
      </Link>
    </div>
  )
}

export default MyTicketsPage
