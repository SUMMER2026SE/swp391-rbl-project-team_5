import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import useSocket from '../context/useSocket.js'
import {
  decideLiveTripProposal,
  getLiveTrip,
  joinSmartQueue,
  leaveSmartQueue,
  refreshLiveTripAutopilot,
  simulateLiveTripAutopilot,
} from '../services/liveTripApi.js'
import { selectLiveTripPressure } from '../utils/liveTripPressure.js'

const PRESSURE_STYLES = {
  QUIET: {
    label: 'Thoáng',
    badge: 'bg-emerald-50 text-emerald-700',
    bar: 'bg-emerald-500',
  },
  MODERATE: {
    label: 'Vừa phải',
    badge: 'bg-amber-50 text-amber-700',
    bar: 'bg-amber-500',
  },
  BUSY: {
    label: 'Đông',
    badge: 'bg-orange-50 text-orange-700',
    bar: 'bg-orange-500',
  },
  VERY_BUSY: {
    label: 'Rất đông',
    badge: 'bg-red-50 text-red-700',
    bar: 'bg-red-500',
  },
  CLOSED: {
    label: 'Đang đóng cửa',
    badge: 'bg-slate-100 text-slate-700',
    bar: 'bg-slate-500',
  },
}

const ITEM_STATUS = {
  PLANNED: { label: 'Theo kế hoạch', className: 'bg-slate-100 text-slate-600' },
  UPDATED: { label: 'Đã cập nhật', className: 'bg-sky-50 text-sky-700' },
  AT_RISK: { label: 'Cần theo dõi', className: 'bg-amber-50 text-amber-700' },
  REVISION_PROPOSED: { label: 'Có đề xuất mới', className: 'bg-violet-50 text-violet-700' },
  COMPLETED: { label: 'Đã hoàn thành', className: 'bg-emerald-50 text-emerald-700' },
  SKIPPED: { label: 'Đã bỏ qua', className: 'bg-slate-100 text-slate-500' },
}

function formatDate(value) {
  if (!value) return 'Chưa có ngày'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(value) {
  if (!value) return 'Chưa có giờ'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Chưa có giờ'
    : date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Ho_Chi_Minh',
    })
}

function formatDateTime(value) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Chưa cập nhật'
  return `${formatTime(value)} · ${date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  })}`
}

function getPressureStyle(pressure) {
  return PRESSURE_STYLES[pressure?.summary?.level] || PRESSURE_STYLES.MODERATE
}

function PressurePanel({ pressure, item }) {
  if (!pressure) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        Chưa có đủ dữ liệu áp lực cho hoạt động này.
      </div>
    )
  }

  const selected = selectLiveTripPressure(pressure, item)
  const metrics = selected.metrics || pressure.summary
  const style = getPressureStyle({ summary: metrics })
  const score = Math.max(0, Math.min(100, Number(metrics?.score) || 0))
  const pressureLabel = selected.basis === 'TIME_SLOT'
    ? `Áp lực khung ${selected.slot.startTime} - ${selected.slot.endTime}`
    : 'Áp lực lượt đến'

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{pressureLabel}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">
            {metrics?.bookedQty ?? 0} vé đã đặt · còn {metrics?.availableTickets ?? 0} vé
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.badge}`}>
          {style.label} · {score}/100
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`Áp lực ${score} trên 100`}>
        <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${score}%` }} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
        <span>Check-in 15 phút: {metrics?.checkinsLast15Minutes ?? 0}</span>
        <span>Đang chờ thông minh: {metrics?.waitingGuests ?? 0} khách</span>
        <span>Độ tin cậy: {pressure.confidence === 'HIGH' ? 'Cao' : pressure.confidence === 'MEDIUM' ? 'Vừa' : 'Thấp'}</span>
        <span>Dữ liệu: booking + queue + QR</span>
      </div>
    </div>
  )
}

function AutopilotProposalPanel({ proposal, busy, onDecision }) {
  if (!proposal) return null

  return (
    <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined rounded-xl bg-violet-100 p-2 text-violet-700" aria-hidden="true">
          auto_awesome
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Autopilot đề xuất</p>
          <p className="mt-1 font-bold text-violet-950">
            Đổi từ {formatTime(proposal.originalStart)} sang {formatTime(proposal.proposedStart)}
          </p>
          <p className="mt-2 text-sm leading-6 text-violet-800">{proposal.rationale}</p>
          <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-5 text-violet-800">
            Không có booking nào bị thay đổi · Có đệm di chuyển 30 phút · Hết hạn {formatDateTime(proposal.expiresAt)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => onDecision(proposal, 'ACCEPT')}
              type="button"
            >
              Chấp nhận đổi giờ
            </button>
            <button
              className="rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-bold text-violet-800 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => onDecision(proposal, 'REJECT')}
              type="button"
            >
              Giữ lịch hiện tại
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SmartQueuePanel({ item, busy, onAction }) {
  if (!item.bookingId) return null
  const queue = item.smartQueue
  const pressureLevel = item.pressure?.summary?.level
  const queueUseful = ['BUSY', 'VERY_BUSY'].includes(pressureLevel)

  if (queue?.status === 'NO_SHOW') {
    return (
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-black">SmartQueue đã đóng lượt</p>
        <p className="mt-1 text-xs leading-5">Lượt đã quá thời gian gọi tại cổng. Bạn vẫn có thể dùng vé hợp lệ theo điều kiện booking.</p>
      </div>
    )
  }

  if (queue && ['CANCELLED', 'EXPIRED'].includes(queue.status)) {
    return (
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-black">SmartQueue đã kết thúc</p>
        <p className="mt-1 text-xs leading-5">Mỗi booking chỉ có một lượt đăng ký SmartQueue cho hoạt động này trong ngày. Vé gốc không bị hủy và vẫn áp dụng theo điều kiện booking.</p>
      </div>
    )
  }

  if (!queue) {
    if (!queueUseful) return null
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
        <div>
          <p className="text-sm font-black text-cyan-950">SmartQueue đang khả dụng</p>
          <p className="mt-1 text-xs leading-5 text-cyan-800">
            Suất có giới hạn, mỗi booking đăng ký một lần trong ngày và vào cổng bằng QR trong cửa sổ được gọi.
          </p>
        </div>
        <button
          className="rounded-xl bg-[#006b72] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          onClick={() => onAction(item, 'join')}
          type="button"
        >
          {busy ? 'Đang xử lý...' : 'Tham gia SmartQueue'}
        </button>
      </div>
    )
  }

  if (queue.status === 'ADMITTED') {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
        <span className="material-symbols-outlined mr-2 align-middle" aria-hidden="true">verified</span>
        SmartQueue đã xác nhận bạn vào cổng bằng QR.
      </div>
    )
  }

  const isReady = queue.status === 'READY'
  return (
    <div className={`mt-4 rounded-2xl border p-4 ${isReady ? 'border-emerald-300 bg-emerald-50' : 'border-cyan-200 bg-cyan-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-black uppercase tracking-[0.14em] ${isReady ? 'text-emerald-700' : 'text-cyan-700'}`}>
            SmartQueue · {isReady ? 'Đã đến lượt' : `Vị trí ${queue.position || '—'}`}
          </p>
          <p className={`mt-1 font-bold ${isReady ? 'text-emerald-950' : 'text-cyan-950'}`}>
            {isReady
              ? `Di chuyển đến cổng và mở mã QR trước ${formatTime(queue.readyExpiresAt)}.`
              : `Ước tính còn ${queue.estimatedWaitMinutes || '—'} phút · ${queue.guestsAhead || 0} khách phía trước`}
          </p>
          {queue.policy?.paused && (
            <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
              Hàng chờ đang tạm dừng: {queue.policy.pauseReason || 'lý do vận hành'}. Thứ tự của bạn vẫn được bảo lưu.
            </p>
          )}
          {!isReady && (
            <p className="mt-1 text-xs text-cyan-800">
              ETA dựa trên {queue.estimateBasis === 'ML_ARRIVAL_PREDICTION' ? 'dự báo ML arrival p50/p90' : queue.estimateBasis === 'RECENT_QR_THROUGHPUT' ? 'tốc độ QR 15 phút gần nhất' : 'fallback sức chứa'} · độ tin cậy {queue.confidence === 'HIGH' ? 'cao' : queue.confidence === 'MEDIUM' ? 'vừa' : 'thấp'}
            </p>
          )}
        </div>
        <button
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Rời SmartQueue sẽ kết thúc lượt đăng ký hôm nay và bạn không thể tham gia lại cho hoạt động này. Tiếp tục?')) onAction(item, 'leave')
          }}
          type="button"
        >
          Rời hàng chờ
        </button>
      </div>
    </div>
  )
}

function LiveEventFeed({ events }) {
  const severityClass = {
    SUCCESS: 'bg-emerald-100 text-emerald-700',
    WARNING: 'bg-amber-100 text-amber-700',
    CRITICAL: 'bg-red-100 text-red-700',
    INFO: 'bg-sky-100 text-sky-700',
  }

  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#00858a]">Live event history</p>
        <h2 className="mt-1 text-xl font-black text-[#00474d]">Vì sao hệ thống đưa ra quyết định?</h2>
      </div>
      <div className="mt-5 space-y-3">
        {events.slice(0, 12).map((event) => (
          <article className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4" key={event.id}>
            <span className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${severityClass[event.severity] || severityClass.INFO}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-slate-800">{event.title}</p>
                <time className="text-xs font-medium text-slate-500">{formatDateTime(event.createdAt)}</time>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">{event.message}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function LiveTripPage() {
  const { tripId } = useParams()
  const socket = useSocket()
  const [trip, setTrip] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulation, setSimulation] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [queueActionItemId, setQueueActionItemId] = useState('')
  const [proposalActionId, setProposalActionId] = useState('')

  const loadTrip = useCallback(async ({ silent = false } = {}) => {
    if (!tripId) return
    if (silent) setIsRefreshing(true)
    else setIsLoading(true)

    try {
      const response = await getLiveTrip(tripId)
      setTrip(response.data)
      setErrorMessage('')
      return true
    } catch (error) {
      setErrorMessage(error.message)
      return false
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [tripId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTrip()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadTrip])

  useEffect(() => {
    function handleLiveTripUpdated(payload) {
      if (String(payload?.tripId) !== String(tripId)) return
      if (payload.reason === 'QUEUE_READY') {
        toast.success('SmartQueue: đã đến lượt bạn vào cổng!')
      } else if (payload.reason === 'QUEUE_ADMITTED') {
        toast.success('SmartQueue đã xác nhận check-in thành công.')
      } else if (payload.reason === 'QUEUE_PAUSED') {
        toast.warning('SmartQueue tạm dừng vận hành; thứ tự của bạn vẫn được bảo lưu.')
      } else if (payload.reason === 'QUEUE_RESUMED') {
        toast.info('SmartQueue đã hoạt động trở lại.')
      } else if (payload.reason === 'AUTOPILOT_PROPOSED') {
        toast.info('Autopilot vừa tạo một đề xuất an toàn mới.')
      }
      void loadTrip({ silent: true })
    }

    socket.on('LIVE_TRIP_UPDATED', handleLiveTripUpdated)
    return () => socket.off('LIVE_TRIP_UPDATED', handleLiveTripUpdated)
  }, [loadTrip, socket, tripId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTrip({ silent: true })
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [loadTrip])

  const dayGroups = useMemo(() => {
    const groups = new Map()
    for (const item of trip?.items || []) {
      const key = Number(item.dayIndex) || 0
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    for (const items of groups.values()) {
      items.sort((left, right) => new Date(left.scheduledStart) - new Date(right.scheduledStart))
    }
    return [...groups.entries()].sort((left, right) => left[0] - right[0])
  }, [trip?.items])

  const summary = useMemo(() => {
    const items = trip?.items || []
    return {
      activities: items.length,
      linkedBookings: items.filter((item) => item.bookingId).length,
      atRisk: items.filter((item) => ['AT_RISK', 'REVISION_PROPOSED'].includes(item.status)).length,
      activeQueues: items.filter((item) => ['WAITING', 'READY'].includes(item.smartQueue?.status)).length,
    }
  }, [trip?.items])

  const proposalsByItem = useMemo(
    () => new Map((trip?.proposals || []).map((proposal) => [proposal.liveTripItemId, proposal])),
    [trip?.proposals],
  )

  async function handleRefresh() {
    if (!tripId || isRefreshing) return
    setIsRefreshing(true)
    try {
      await refreshLiveTripAutopilot(tripId)
      const loaded = await loadTrip({ silent: true })
      if (loaded) toast.success('Autopilot đã phân tích lại chuyến đi.')
    } catch (error) {
      toast.error(error.message || 'Không thể phân tích lại chuyến đi.')
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleSimulation() {
    if (!tripId || isSimulating) return
    setIsSimulating(true)
    try {
      const response = await simulateLiveTripAutopilot(tripId)
      setSimulation(response.data)
      toast.success('Đã chạy mô phỏng ràng buộc Autopilot; lịch trình chưa bị thay đổi.')
    } catch (error) {
      toast.error(error.message || 'Không thể chạy mô phỏng Autopilot.')
    } finally {
      setIsSimulating(false)
    }
  }

  async function handleQueueAction(item, action) {
    if (!tripId || queueActionItemId) return
    setQueueActionItemId(item.id)
    try {
      if (action === 'join') {
        await joinSmartQueue(tripId, item.id)
        toast.success('Đã tham gia SmartQueue.')
      } else {
        await leaveSmartQueue(tripId, item.id)
        toast.info('Đã rời SmartQueue.')
      }
      await loadTrip({ silent: true })
    } catch (error) {
      toast.error(error.message || 'Không thể cập nhật SmartQueue.')
    } finally {
      setQueueActionItemId('')
    }
  }

  async function handleProposalDecision(proposal, decision) {
    if (!tripId || proposalActionId) return
    setProposalActionId(proposal.id)
    try {
      await decideLiveTripProposal(tripId, proposal.id, decision)
      toast.success(decision === 'ACCEPT'
        ? 'Đã áp dụng khung giờ mới. Booking của bạn không bị thay đổi.'
        : 'Đã giữ nguyên lịch trình hiện tại.')
      await loadTrip({ silent: true })
    } catch (error) {
      toast.error(error.message || 'Không thể xử lý đề xuất Autopilot.')
      await loadTrip({ silent: true })
    } finally {
      setProposalActionId('')
    }
  }

  return (
    <>
      <Header activeLink="My Tickets" />
      <main className="min-h-[calc(100vh-80px)] bg-[#f5fafb]">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 lg:py-12">
          {isLoading ? (
            <div className="rounded-3xl bg-white p-12 text-center font-semibold text-[#00474d]" role="status">
              Đang tải chế độ chuyến đi...
            </div>
          ) : errorMessage ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-700">
              <span className="material-symbols-outlined text-4xl" aria-hidden="true">error</span>
              <p className="mt-3 font-semibold">{errorMessage}</p>
              <Link className="mt-5 inline-flex rounded-xl bg-[#00474d] px-4 py-2 text-sm font-bold text-white" to="/">
                Về trang chủ
              </Link>
            </div>
          ) : trip ? (
            <>
              <section className="rounded-3xl bg-[#00474d] p-6 text-white shadow-xl md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a9e8e5]">VietTicket Live</p>
                    <h1 className="mt-2 text-3xl font-black md:text-4xl">{trip.title}</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d4f2f1]">
                      Autopilot giám sát lịch trình, SmartQueue giữ lượt vào cổng và mọi đề xuất đổi lịch đều cần bạn xác nhận.
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/20 disabled:opacity-60"
                    disabled={isRefreshing || isSimulating}
                    onClick={handleRefresh}
                    type="button"
                  >
                    <span className={`material-symbols-outlined text-[18px] ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
                    Phân tích lại
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-xl bg-[#a9e8e5] px-4 py-2 text-sm font-black text-[#00474d] transition hover:bg-white disabled:opacity-60"
                    disabled={isRefreshing || isSimulating}
                    onClick={handleSimulation}
                    type="button"
                  >
                    <span className={`material-symbols-outlined text-[18px] ${isSimulating ? 'animate-spin' : ''}`} aria-hidden="true">science</span>
                    Mô phỏng tối ưu
                  </button>
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="Hoạt động" value={summary.activities} />
                  <StatCard label="Đã liên kết vé" value={summary.linkedBookings} />
                  <StatCard label="Cần theo dõi" value={summary.atRisk} />
                  <StatCard label="SmartQueue đang bật" value={summary.activeQueues} />
                </div>
              </section>

              <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">
                <strong>Minh bạch & an toàn:</strong> chỉ số áp lực được tính từ tồn chỗ, booking, SmartQueue và QR check-in. Đây là ước tính, không phải cảm biến đếm người. Autopilot không tự đổi hoặc hủy booking đã thanh toán.
              </div>

              {simulation && (
                <section className="mt-5 rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm md:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Autopilot simulation</p>
                      <h2 className="mt-1 text-xl font-black text-violet-950">Mô phỏng có ràng buộc, chưa áp dụng</h2>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-violet-700">{simulation.algorithm_version}</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <SimulationMetric label="Điểm trước" value={Number(simulation.baseline_score || 0).toFixed(1)} />
                    <SimulationMetric label="Điểm sau" value={Number(simulation.optimized_score || 0).toFixed(1)} />
                    <SimulationMetric label="Tổng phút điều chỉnh" value={`${simulation.total_shift_minutes || 0} phút`} />
                  </div>
                  <p className="mt-4 text-sm leading-6 text-violet-800">
                    Bảo vệ {simulation.protected_booking_count || 0} hoạt động đã liên kết booking · {simulation.proposals?.length || 0} thay đổi tiềm năng. Đây là bộ giải ràng buộc, không tuyên bố “phút tiết kiệm” khi chưa có đường cong thời gian chờ cho từng khung; lịch chỉ đổi sau khi bạn xác nhận.
                  </p>
                </section>
              )}

              <section className="mt-8 space-y-6">
                {dayGroups.map(([dayIndex, items]) => (
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7" key={dayIndex}>
                    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#00858a]">Ngày {dayIndex + 1}</p>
                        <h2 className="mt-1 text-xl font-black text-[#00474d]">
                          {formatDate(items[0]?.snapshot?.visitDate)}
                        </h2>
                      </div>
                      <span className="text-sm font-semibold text-slate-500">{items.length} hoạt động</span>
                    </div>

                    <div className="mt-5 space-y-5">
                      {items.map((item) => {
                        const status = ITEM_STATUS[item.status] || ITEM_STATUS.PLANNED
                        return (
                          <article className="relative pl-8" key={item.id}>
                            <span className="absolute left-0 top-1 h-4 w-4 rounded-full border-4 border-[#d7f3f1] bg-[#00858a]" aria-hidden="true" />
                            <div className="absolute bottom-0 left-[7px] top-6 w-px bg-slate-200" aria-hidden="true" />
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-[#00474d]">
                                  {formatTime(item.scheduledStart)} · {item.snapshot?.title || item.attraction?.title || 'Điểm tham quan'}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {item.attraction?.city || item.snapshot?.city || 'Địa điểm trong lịch trình'}
                                  {item.bookingId ? ' · Đã liên kết booking' : ' · Chưa liên kết booking'}
                                </p>
                              </div>
                              <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                            </div>
                            <PressurePanel item={item} pressure={item.pressure} />
                            <AutopilotProposalPanel
                              busy={proposalActionId === proposalsByItem.get(item.id)?.id}
                              onDecision={handleProposalDecision}
                              proposal={proposalsByItem.get(item.id)}
                            />
                            <SmartQueuePanel
                              busy={queueActionItemId === item.id}
                              item={item}
                              onAction={handleQueueAction}
                            />
                            {item.bookingId && (
                              <Link
                                className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#006b72] hover:underline"
                                to={`/tickets/${item.bookingId}`}
                              >
                                Mở vé QR
                                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span>
                              </Link>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </section>

              {Array.isArray(trip.events) && trip.events.length > 0 && (
                <LiveEventFeed events={trip.events} />
              )}
            </>
          ) : null}
        </div>
      </main>
      <Footer />
    </>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
      <p className="text-xs font-semibold text-[#bde8e6]">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  )
}

function SimulationMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold text-violet-600">{label}</p>
      <p className="mt-1 text-xl font-black text-violet-950">{value}</p>
    </div>
  )
}

export default LiveTripPage
