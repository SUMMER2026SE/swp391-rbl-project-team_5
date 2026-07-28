import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import useSocket from '../context/useSocket.js'
import { useAuth } from '../context/useAuth.js'
import bookingService from '../services/bookingService.js'
import { getLiveTrip, getLiveTrips } from '../services/liveTripApi.js'
import { getLoyaltySummary, getMyLoyaltyVouchers } from '../services/loyaltyApi.js'
import { listRecoveryCases } from '../services/recoveryApi.js'
import { getBookingStatusMeta } from '../utils/bookingStatus.js'
import {
  buildJourneyOverview,
  isLiveTripOperable,
} from '../utils/journeyCenter.js'

const fallbackImage =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80'

const ACTION_TONES = {
  critical: {
    shell: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white',
    icon: 'bg-rose-100 text-rose-700',
    eyebrow: 'text-rose-700',
    button: 'bg-rose-700 text-white hover:bg-rose-800',
  },
  warning: {
    shell: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white',
    icon: 'bg-amber-100 text-amber-800',
    eyebrow: 'text-amber-700',
    button: 'bg-amber-700 text-white hover:bg-amber-800',
  },
  success: {
    shell: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white',
    icon: 'bg-emerald-100 text-emerald-700',
    eyebrow: 'text-emerald-700',
    button: 'bg-emerald-700 text-white hover:bg-emerald-800',
  },
  neutral: {
    shell: 'border-slate-200 bg-gradient-to-br from-slate-50 to-white',
    icon: 'bg-slate-100 text-slate-700',
    eyebrow: 'text-slate-600',
    button: 'bg-slate-800 text-white hover:bg-slate-900',
  },
  live: {
    shell: 'border-cyan-200 bg-gradient-to-br from-cyan-50 to-white',
    icon: 'bg-cyan-100 text-cyan-800',
    eyebrow: 'text-cyan-700',
    button: 'bg-[#006b72] text-white hover:bg-[#004f55]',
  },
}

const JOURNEY_SOURCE_KEYS = ['bookings', 'liveTrips', 'recovery', 'loyalty', 'vouchers']

const JOURNEY_SOURCE_LABELS = {
  bookings: 'Booking & vé QR',
  liveTrips: 'Live Trip & SmartQueue',
  recovery: 'VietTicket Rescue',
  loyalty: 'Điểm thưởng',
  vouchers: 'Voucher',
}

function createInitialSourceStatus() {
  return {
    sources: Object.fromEntries(
      JOURNEY_SOURCE_KEYS.map((key) => [key, { state: 'pending', error: '' }]),
    ),
    detailFailures: 0,
    checkedAt: null,
  }
}

function getSettledError(result, fallback) {
  if (result?.status === 'rejected') {
    return result.reason?.message || fallback
  }
  return fallback
}

function formatSyncTime(value) {
  if (!value) return 'chưa có lần đồng bộ thành công'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'chưa có lần đồng bộ thành công'
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const UNVERIFIED_NEXT_ACTION = {
  eyebrow: 'Đang xác minh dữ liệu',
  title: 'Chưa thể xác định ưu tiên an toàn',
  description:
    'Một hoặc nhiều nguồn nghiệp vụ chưa phản hồi. Hãy đồng bộ lại trước khi quyết định thanh toán, di chuyển hoặc xử lý Rescue.',
  label: 'Đồng bộ lại',
  icon: 'sync_problem',
  tone: 'neutral',
  reason: 'VietTicket không tự suy đoán hành động tiếp theo khi dữ liệu quan trọng chưa đầy đủ.',
}

function formatDate(value) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('vi-VN', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
}

function formatPoints(value) {
  return new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0))
}

function JourneyCenterPage() {
  const { user } = useAuth()
  const socket = useSocket()
  const [bookings, setBookings] = useState(null)
  const [liveTrips, setLiveTrips] = useState(null)
  const [recoveryCases, setRecoveryCases] = useState(null)
  const [loyaltySummary, setLoyaltySummary] = useState(null)
  const [vouchers, setVouchers] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [decisionClock, setDecisionClock] = useState(() => new Date())
  const [sourceStatus, setSourceStatus] = useState(createInitialSourceStatus)
  const requestVersionRef = useRef(0)
  const socketRefreshTimerRef = useRef(null)

  const loadJourney = useCallback(async ({ silent = false } = {}) => {
    const requestVersion = ++requestVersionRef.current
    if (!silent) setLoading(true)
    setRefreshing(true)

    const results = await Promise.allSettled([
      bookingService.getBookings(),
      getLiveTrips(),
      listRecoveryCases(),
      getLoyaltySummary(),
      getMyLoyaltyVouchers(),
    ])
    if (requestVersion !== requestVersionRef.current) return

    const bookingsResult = results[0]
    const tripsResult = results[1]
    const recoveryResult = results[2]
    const loyaltyResult = results[3]
    const vouchersResult = results[4]

    const bookingsValid = bookingsResult.status === 'fulfilled'
      && Array.isArray(bookingsResult.value)
    const tripsValid = tripsResult.status === 'fulfilled'
      && Array.isArray(tripsResult.value?.data)
    const recoveryValid = recoveryResult.status === 'fulfilled'
      && Array.isArray(recoveryResult.value)
    const loyaltyValid = loyaltyResult.status === 'fulfilled'
      && loyaltyResult.value?.data
      && typeof loyaltyResult.value.data === 'object'
    const vouchersValid = vouchersResult.status === 'fulfilled'
      && Array.isArray(vouchersResult.value?.data)

    if (bookingsValid) setBookings(bookingsResult.value)
    if (recoveryValid) setRecoveryCases(recoveryResult.value)
    if (loyaltyValid) setLoyaltySummary(loyaltyResult.value.data)
    if (vouchersValid) setVouchers(vouchersResult.value.data)

    let mergedTrips = null
    let detailFailures = 0
    let liveTripState

    if (tripsValid) {
      const tripSummaries = tripsResult.value.data
      const operableTrips = tripSummaries.filter((trip) => isLiveTripOperable(trip))
      const detailTargets = operableTrips.filter((trip) => trip?.id)
      detailFailures += operableTrips.length - detailTargets.length

      const detailResults = await Promise.allSettled(
        detailTargets.map((trip) => getLiveTrip(trip.id)),
      )
      if (requestVersion !== requestVersionRef.current) return

      const detailsById = new Map(
        detailResults
          .filter((result) => result.status === 'fulfilled' && result.value?.data?.id)
          .map((result) => [result.value.data.id, result.value.data]),
      )
      detailFailures += detailResults.filter(
        (result) => result.status !== 'fulfilled' || !result.value?.data?.id,
      ).length
      mergedTrips = tripSummaries.map((trip) => detailsById.get(trip.id) || trip)
      liveTripState = detailFailures > 0
        ? {
          state: 'partial',
          error: `${detailFailures} Live Trip chưa tải được chi tiết.`,
        }
        : { state: 'ready', error: '' }
    } else {
      liveTripState = {
        state: 'error',
        error: getSettledError(tripsResult, 'Không thể tải danh sách Live Trip.'),
      }
    }

    if (requestVersion !== requestVersionRef.current) return

    if (mergedTrips) setLiveTrips(mergedTrips)
    setSourceStatus({
      sources: {
        bookings: bookingsValid
          ? { state: 'ready', error: '' }
          : {
            state: 'error',
            error: getSettledError(bookingsResult, 'Không thể tải booking và vé QR.'),
          },
        liveTrips: liveTripState,
        recovery: recoveryValid
          ? { state: 'ready', error: '' }
          : {
            state: 'error',
            error: getSettledError(recoveryResult, 'Không thể tải trạng thái Rescue.'),
          },
        loyalty: loyaltyValid
          ? { state: 'ready', error: '' }
          : {
            state: 'error',
            error: getSettledError(loyaltyResult, 'Không thể tải điểm thưởng.'),
          },
        vouchers: vouchersValid
          ? { state: 'ready', error: '' }
          : {
            state: 'error',
            error: getSettledError(vouchersResult, 'Không thể tải voucher.'),
          },
      },
      detailFailures,
      checkedAt: new Date().toISOString(),
    })
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadJourney()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestVersionRef.current += 1
    }
  }, [loadJourney])

  useEffect(() => {
    function handleLiveTripUpdated(payload) {
      if (!payload?.tripId) return
      window.clearTimeout(socketRefreshTimerRef.current)
      socketRefreshTimerRef.current = window.setTimeout(() => {
        void loadJourney({ silent: true })
      }, 250)
    }

    socket.on('LIVE_TRIP_UPDATED', handleLiveTripUpdated)
    return () => {
      socket.off('LIVE_TRIP_UPDATED', handleLiveTripUpdated)
      window.clearTimeout(socketRefreshTimerRef.current)
    }
  }, [loadJourney, socket])

  useEffect(() => {
    const clock = window.setInterval(() => {
      if (document.visibilityState === 'visible') setDecisionClock(new Date())
    }, 15000)
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void loadJourney({ silent: true })
      }
    }, 60000)
    return () => {
      window.clearInterval(clock)
      window.clearInterval(refresh)
    }
  }, [loadJourney])

  useEffect(() => {
    const syncWhenAvailable = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        setDecisionClock(new Date())
        void loadJourney({ silent: true })
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncWhenAvailable()
    }

    window.addEventListener('online', syncWhenAvailable)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('online', syncWhenAvailable)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadJourney])

  const overview = useMemo(
    () => buildJourneyOverview({
      bookings: bookings || [],
      liveTrips: liveTrips || [],
      recoveryCases: recoveryCases || [],
      loyaltySummary,
      now: decisionClock,
    }),
    [bookings, decisionClock, liveTrips, loyaltySummary, recoveryCases],
  )

  const activeVouchers = useMemo(
    () => (vouchers || []).filter((voucher) => voucher?.state === 'active').length,
    [vouchers],
  )
  const firstName = user?.fullName?.trim().split(' ').pop() || 'bạn'
  const sourceEntries = JOURNEY_SOURCE_KEYS.map((key) => ({
    key,
    label: JOURNEY_SOURCE_LABELS[key],
    ...sourceStatus.sources[key],
  }))
  const healthySourceCount = sourceEntries.filter((source) => source.state === 'ready').length
  const sourceIssues = sourceEntries.filter((source) => source.state !== 'ready')
  const decisionDataComplete = ['bookings', 'liveTrips', 'recovery'].every(
    (key) => sourceStatus.sources[key]?.state === 'ready',
  )
  const nextAction = decisionDataComplete ? overview.nextAction : UNVERIFIED_NEXT_ACTION
  const actionTone = ACTION_TONES[nextAction.tone] || ACTION_TONES.live
  const nearestBookings = overview.upcomingBookings.slice(0, 3)
  const allSourcesReady = sourceIssues.length === 0 && !loading && !refreshing

  return (
    <>
      <Seo
        title="Trung tâm hành trình | VietTicket Travel"
        description="Một nơi để theo dõi booking, vé QR, Live Trip, SmartQueue, Rescue và điểm thưởng theo thời gian thực."
        noIndex
      />
      <Header activeLink="Hành trình" />
      <main className="min-h-[calc(100vh-80px)] bg-[#f4f8f8]">
        <section className="relative overflow-hidden bg-[#003f45] text-white">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-emerald-300/10 blur-3xl" aria-hidden="true" />
          <div className="container relative py-10 sm:py-14 lg:py-16">
            <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
                  <span className="relative flex h-2.5 w-2.5">
                    {allSourcesReady && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                    )}
                    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${allSourcesReady ? 'bg-emerald-300' : 'bg-amber-300'}`} />
                  </span>
                  VietTicket Journey Intelligence
                </div>
                <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                  Chào {firstName}, hành trình của bạn đang ở đây.
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-cyan-50/85 sm:text-lg">
                  Booking, vé QR, Live Trip, SmartQueue, Rescue và điểm thưởng được
                  kết nối thành một luồng duy nhất — để bạn luôn biết việc quan trọng
                  nhất cần làm tiếp theo.
                </p>
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-md">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-cyan-100">
                      Trạng thái dữ liệu
                    </p>
                    <p className="mt-1 text-lg font-black">
                      {healthySourceCount}/{sourceEntries.length} nguồn đã xác minh
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-4xl text-cyan-200" aria-hidden="true">
                    hub
                  </span>
                </div>
                <div
                  className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-label="Tiến độ đồng bộ dữ liệu hành trình"
                  aria-valuemin="0"
                  aria-valuemax={sourceEntries.length}
                  aria-valuenow={healthySourceCount}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 transition-all"
                    style={{ width: `${(healthySourceCount / sourceEntries.length) * 100}%` }}
                  />
                </div>
                <p className="mt-3 text-xs leading-5 text-cyan-50/75">
                  Quyết định ưu tiên dựa trên trạng thái nghiệp vụ thật, không dùng
                  số liệu minh họa hoặc để AI tự thay đổi booking.
                </p>
                <p className="mt-2 text-xs text-cyan-100/70" role="status">
                  {refreshing
                    ? 'Đang kiểm tra dữ liệu mới nhất…'
                    : `Kiểm tra lúc ${formatSyncTime(sourceStatus.checkedAt)}`}
                </p>
                {sourceIssues.length > 0 && !loading && (
                  <div className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-300/10 p-3 text-xs text-amber-50" role="alert">
                    <p className="font-black">Một số nguồn chưa thể xác minh:</p>
                    <ul className="mt-2 space-y-1.5">
                      {sourceIssues.map((source) => (
                        <li key={source.key}>
                          <span className="font-bold">{source.label}:</span> {source.error || 'Cần thử lại'}
                        </li>
                      ))}
                    </ul>
                    <button
                      className="mt-3 rounded-lg border border-white/30 px-3 py-2 font-black transition hover:bg-white/10 disabled:opacity-50"
                      disabled={refreshing}
                      onClick={() => void loadJourney()}
                      type="button"
                    >
                      {refreshing ? 'Đang đồng bộ…' : 'Thử đồng bộ lại'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="container py-8 sm:py-10 lg:py-12">
          {loading ? (
            <JourneySkeleton />
          ) : (
            <>
              <section className={`rounded-3xl border p-5 shadow-sm sm:p-7 ${actionTone.shell}`}>
                <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                  <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${actionTone.icon}`}>
                    <span className="material-symbols-outlined text-[34px]" aria-hidden="true">
                      {nextAction.icon}
                    </span>
                  </div>
                  <div>
                    <p className={`text-xs font-black uppercase tracking-[0.17em] ${actionTone.eyebrow}`}>
                      Hành động thông minh tiếp theo · {nextAction.eyebrow}
                    </p>
                    <h2 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
                      {nextAction.title}
                    </h2>
                    <p className="mt-2 max-w-3xl leading-7 text-slate-600">
                      {nextAction.description}
                    </p>
                    <details className="mt-3 text-xs text-slate-500">
                      <summary className="cursor-pointer font-bold text-slate-600">Vì sao được ưu tiên?</summary>
                      <p className="mt-1 leading-5">{nextAction.reason}</p>
                    </details>
                  </div>
                  {decisionDataComplete ? (
                    <Link
                      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black shadow-sm transition active:scale-95 ${actionTone.button}`}
                      to={overview.nextAction.href}
                    >
                      {nextAction.label}
                      <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
                        arrow_forward
                      </span>
                    </Link>
                  ) : (
                    <button
                      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${actionTone.button}`}
                      disabled={refreshing}
                      onClick={() => void loadJourney()}
                      type="button"
                    >
                      {refreshing ? 'Đang đồng bộ…' : nextAction.label}
                      <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
                        {refreshing ? 'sync' : 'refresh'}
                      </span>
                    </button>
                  )}
                </div>
              </section>

              <JourneyMetrics
                activeVouchers={activeVouchers}
                counts={overview.counts}
                availability={{
                  actionRequired: decisionDataComplete,
                  activeTrips: sourceStatus.sources.liveTrips?.state === 'ready',
                  readyTickets: sourceStatus.sources.bookings?.state === 'ready',
                  rewards: sourceStatus.sources.loyalty?.state === 'ready'
                    && sourceStatus.sources.vouchers?.state === 'ready',
                }}
              />

              <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.17em] text-[#00858a]">
                        Một hành trình liền mạch
                      </p>
                      <h2 className="mt-1 text-2xl font-black text-[#003f45]">
                        Từ ý tưởng đến sau chuyến đi
                      </h2>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                      Có kiểm soát nghiệp vụ
                    </span>
                  </div>
                  <JourneyLifecycle
                    hasBooking={(bookings || []).length > 0}
                    hasLiveTrip={overview.activeTrips.length > 0}
                    hasRecovery={(recoveryCases || []).length > 0}
                    hasRewards={(Number(loyaltySummary?.lifetimeEarned) || 0) > 0}
                  />
                </div>

                <aside className="overflow-hidden rounded-3xl bg-[#071f23] p-6 text-white shadow-sm sm:p-7">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/15 text-cyan-200">
                    <span className="material-symbols-outlined text-3xl" aria-hidden="true">verified_user</span>
                  </div>
                  <p className="mt-5 text-xs font-black uppercase tracking-[0.17em] text-cyan-300">
                    Safety net luôn sẵn sàng
                  </p>
                  <h2 className="mt-2 text-2xl font-black">Bạn giữ quyền quyết định.</h2>
                  <ul className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
                    <TrustItem text="Autopilot chỉ đề xuất, không tự đổi booking đã thanh toán." />
                    <TrustItem text="SmartQueue chỉ giữ lượt trong luồng cổng VietTicket do partner kích hoạt và không làm mất hiệu lực vé gốc." />
                    <TrustItem text="Rescue chỉ hiển thị phương án còn tồn kho và không vượt khoản đã trả." />
                    <TrustItem text="Mọi thay đổi nhạy cảm đều có trạng thái và dấu vết xử lý." />
                  </ul>
                  <Link
                    className="mt-6 inline-flex items-center gap-2 text-sm font-black text-cyan-200 hover:text-white"
                    to="/rescue"
                  >
                    Mở trung tâm Rescue
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                  </Link>
                </aside>
              </section>

              <section className="mt-8">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.17em] text-[#00858a]">
                      Chuyến sắp tới
                    </p>
                    <h2 className="mt-1 text-2xl font-black text-[#003f45]">Mọi thứ cần thiết trước khi đi</h2>
                  </div>
                  <Link className="text-sm font-black text-[#006b72] hover:underline" to="/my-tickets">
                    Xem tất cả vé
                  </Link>
                </div>
                {nearestBookings.length > 0 ? (
                  <div className="mt-5 grid gap-5 lg:grid-cols-3">
                    {nearestBookings.map((booking) => (
                      <JourneyBookingCard booking={booking} key={booking.id} />
                    ))}
                  </div>
                ) : sourceStatus.sources.bookings?.state === 'ready' ? (
                  <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
                    <span className="material-symbols-outlined text-5xl text-[#00858a]" aria-hidden="true">
                      luggage
                    </span>
                    <h3 className="mt-3 text-xl font-black text-slate-900">Sẵn sàng cho chuyến đi mới</h3>
                    <p className="mx-auto mt-2 max-w-xl leading-7 text-slate-600">
                      Dùng AI để tạo lịch trình hoặc PartySync để cả nhóm cùng chọn
                      trải nghiệm trước khi đặt vé.
                    </p>
                    <Link className="mt-5 inline-flex rounded-xl bg-[#006b72] px-5 py-3 text-sm font-black text-white" to="/attractions">
                      Lên kế hoạch ngay
                    </Link>
                  </div>
                ) : (
                  <DataUnavailableState
                    label="Booking & vé QR"
                    onRetry={() => void loadJourney()}
                    refreshing={refreshing}
                  />
                )}
              </section>

              <section className="mt-10">
                <div className="max-w-3xl">
                  <p className="text-xs font-black uppercase tracking-[0.17em] text-[#00858a]">
                    Intelligence suite
                  </p>
                  <h2 className="mt-1 text-3xl font-black text-[#003f45]">
                    Bốn năng lực khác biệt, cùng phục vụ một chuyến đi
                  </h2>
                  <p className="mt-3 leading-7 text-slate-600">
                    Mỗi công cụ giải quyết một thời điểm khác nhau, nhưng đều dùng dữ
                    liệu catalog, booking và tồn kho của VietTicket.
                  </p>
                </div>
                <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                  <CapabilityCard
                    color="from-violet-600 to-indigo-700"
                    description="Mời nhóm bằng QR, bình chọn realtime và chốt phương án theo ngân sách chung."
                    href="/party"
                    icon="groups"
                    label="Cùng nhau quyết định"
                    title="PartySync"
                  />
                  <CapabilityCard
                    color="from-cyan-600 to-teal-700"
                    description="Tạo lịch trình từ catalog thật, có giá, khoảng cách, thời tiết và phương án dự phòng."
                    href="/attractions"
                    icon="route"
                    label="Lên kế hoạch có căn cứ"
                    title="AI Itinerary"
                  />
                  <CapabilityCard
                    color="from-amber-500 to-orange-700"
                    description="Theo dõi nhu cầu khách VietTicket, giữ lượt tại luồng cổng do partner vận hành và đề xuất điều chỉnh có xác nhận."
                    href={overview.activeTrips[0] ? `/trip-mode/${overview.activeTrips[0].id}` : '/my-tickets'}
                    icon="speed"
                    label="Điều phối tại điểm đến"
                    title="Live Trip"
                  />
                  <CapabilityCard
                    color="from-rose-600 to-pink-700"
                    description="Khi dịch vụ gián đoạn, đổi sang lựa chọn còn chỗ hoặc hoàn 100% theo luồng minh bạch."
                    href="/rescue"
                    icon="health_and_safety"
                    label="Bảo vệ sau thanh toán"
                    title="VietTicket Rescue"
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}

function JourneySkeleton() {
  return (
    <div className="space-y-6" role="status">
      <div className="h-48 animate-pulse rounded-3xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-28 animate-pulse rounded-2xl bg-slate-200" key={index} />
        ))}
      </div>
      <span className="sr-only">Đang đồng bộ trung tâm hành trình</span>
    </div>
  )
}

function DataUnavailableState({ label, onRetry, refreshing }) {
  return (
    <div
      className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center"
      role="status"
    >
      <span className="material-symbols-outlined text-5xl text-amber-700" aria-hidden="true">
        cloud_off
      </span>
      <h3 className="mt-3 text-xl font-black text-amber-950">
        Chưa thể xác minh {label}
      </h3>
      <p className="mx-auto mt-2 max-w-xl leading-7 text-amber-900/80">
        VietTicket giữ nguyên nguyên tắc không suy đoán dữ liệu nghiệp vụ khi nguồn này
        chưa phản hồi. Hãy thử đồng bộ lại trước khi tiếp tục.
      </p>
      <button
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={refreshing}
        onClick={onRetry}
        type="button"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          {refreshing ? 'sync' : 'refresh'}
        </span>
        {refreshing ? 'Đang đồng bộ…' : 'Thử lại'}
      </button>
    </div>
  )
}

function JourneyMetrics({ activeVouchers, counts, availability }) {
  const cards = [
    {
      label: 'Cần bạn xử lý',
      value: availability.actionRequired ? counts.actionRequired : '—',
      icon: 'priority_high',
      tone: counts.actionRequired > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700',
      hint: availability.actionRequired
        ? counts.actionRequired > 0 ? 'Đã xếp theo mức ưu tiên' : 'Không có cảnh báo khẩn'
        : 'Chưa thể xác minh',
    },
    {
      label: 'Vé sẵn sàng',
      value: availability.readyTickets ? counts.readyTickets : '—',
      icon: 'qr_code_2',
      tone: 'bg-cyan-50 text-cyan-800',
      hint: availability.readyTickets ? 'Booking đã xác nhận' : 'Nguồn booking chưa sẵn sàng',
    },
    {
      label: 'Live Trip',
      value: availability.activeTrips ? counts.activeTrips : '—',
      icon: 'explore',
      tone: 'bg-violet-50 text-violet-700',
      hint: availability.activeTrips ? 'Hành trình đang hoạt động' : 'Chi tiết Live Trip chưa đầy đủ',
    },
    {
      label: 'Điểm & ưu đãi',
      value: availability.rewards ? `${formatPoints(counts.rewardPoints)} · ${activeVouchers}` : '—',
      icon: 'redeem',
      tone: 'bg-rose-50 text-rose-700',
      hint: availability.rewards ? 'Điểm khả dụng · voucher' : 'Nguồn loyalty chưa sẵn sàng',
    },
  ]

  return (
    <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article className={`rounded-2xl p-5 shadow-sm ${card.tone}`} key={card.label}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black">{card.label}</p>
              <p className="mt-3 text-3xl font-black">{card.value}</p>
              <p className="mt-1 text-xs font-semibold opacity-75">{card.hint}</p>
            </div>
            <span className="material-symbols-outlined text-[28px]" aria-hidden="true">
              {card.icon}
            </span>
          </div>
        </article>
      ))}
    </section>
  )
}

function JourneyLifecycle({ hasBooking, hasLiveTrip, hasRecovery, hasRewards }) {
  const stages = [
    {
      title: 'Chọn cùng nhau',
      detail: 'AI itinerary + PartySync',
      icon: 'diversity_3',
      active: true,
      completed: hasBooking,
    },
    {
      title: 'Đặt & nhận QR',
      detail: 'Giá, tồn kho và chính sách thật',
      icon: 'confirmation_number',
      active: hasBooking,
      completed: hasLiveTrip || hasRecovery || hasRewards,
    },
    {
      title: 'Đi thông minh',
      detail: 'Live Trip + SmartQueue',
      icon: 'assistant_navigation',
      active: hasLiveTrip,
      completed: hasRewards,
    },
    {
      title: 'Được bảo vệ',
      detail: 'Rescue + điểm thưởng',
      icon: 'shield',
      active: hasRecovery || hasRewards,
      completed: false,
    },
  ]

  return (
    <ol className="mt-7 grid gap-3 md:grid-cols-4">
      {stages.map((stage, index) => (
        <li
          className={`relative rounded-2xl border p-4 ${
            stage.active || stage.completed
              ? 'border-teal-200 bg-teal-50/70'
              : 'border-slate-200 bg-slate-50'
          }`}
          key={stage.title}
        >
          {index < stages.length - 1 && (
            <span className="absolute -right-3 top-1/2 z-10 hidden h-px w-3 bg-teal-300 md:block" aria-hidden="true" />
          )}
          <div className="flex items-center justify-between gap-2">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              stage.active || stage.completed ? 'bg-[#006b72] text-white' : 'bg-slate-200 text-slate-500'
            }`}>
              <span className="material-symbols-outlined" aria-hidden="true">{stage.icon}</span>
            </span>
            <span className="text-xs font-black text-slate-400">0{index + 1}</span>
          </div>
          <h3 className="mt-4 font-black text-slate-900">{stage.title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">{stage.detail}</p>
        </li>
      ))}
    </ol>
  )
}

function TrustItem({ text }) {
  return (
    <li className="flex gap-3">
      <span className="material-symbols-outlined mt-0.5 text-[19px] text-emerald-300" aria-hidden="true">
        check_circle
      </span>
      <span>{text}</span>
    </li>
  )
}

function JourneyBookingCard({ booking }) {
  const meta = getBookingStatusMeta(booking.status)
  const status = String(booking.status || '').toLowerCase()
  const href = status === 'unpaid' && booking.reservationId
    ? `/checkout/${booking.reservationId}`
    : `/tickets/${booking.id}`
  const actionLabel = status === 'unpaid' ? 'Thanh toán' : status === 'confirmed' ? 'Mở vé QR' : 'Theo dõi'

  return (
    <article className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
      <div className="relative h-44 overflow-hidden">
        <img
          alt={booking.attractionTitle || 'Điểm tham quan'}
          className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
          src={booking.attractionImage || fallbackImage}
        />
        <span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-black shadow-sm ${meta.className}`}>
          {meta.label || booking.status}
        </span>
      </div>
      <div className="p-5">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-[#00858a]">
          {formatDate(booking.visitDate)}
        </p>
        <h3 className="mt-2 line-clamp-2 text-lg font-black text-slate-900">
          {booking.attractionTitle || 'Trải nghiệm VietTicket'}
        </h3>
        <p className="mt-2 line-clamp-1 text-sm text-slate-500">
          {booking.timeSlotLabel || 'Vé cả ngày'} · {booking.quantity || 1} khách
        </p>
        <Link className="mt-5 inline-flex items-center gap-1 text-sm font-black text-[#006b72] hover:underline" to={href}>
          {actionLabel}
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>
    </article>
  )
}

function CapabilityCard({ color, description, href, icon, label, title }) {
  return (
    <Link
      className="group relative min-h-64 overflow-hidden rounded-3xl bg-slate-900 p-6 text-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
      to={href}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-85 transition duration-500 group-hover:scale-105`} aria-hidden="true" />
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[28px] border-white/10" aria-hidden="true" />
      <div className="relative flex h-full flex-col">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
          <span className="material-symbols-outlined text-3xl" aria-hidden="true">{icon}</span>
        </span>
        <p className="mt-8 text-xs font-black uppercase tracking-[0.15em] text-white/75">{label}</p>
        <h3 className="mt-1 text-2xl font-black">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-white/85">{description}</p>
        <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-black">
          Khám phá
          <span className="material-symbols-outlined text-[18px] transition group-hover:translate-x-1" aria-hidden="true">
            arrow_forward
          </span>
        </span>
      </div>
    </Link>
  )
}

export default JourneyCenterPage
