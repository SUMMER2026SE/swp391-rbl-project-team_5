import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import { LiveNotificationPermissionControl } from '../components/LiveOperationsAlert.jsx'
import AutopilotSimulationPanel from '../components/live-trip/AutopilotSimulationPanel.jsx'
import LiveTripCommandCenter from '../components/live-trip/LiveTripCommandCenter.jsx'
import useSocket from '../context/useSocket.js'
import {
  decideLiveTripProposal,
  getLiveTrip,
  joinSmartQueue,
  leaveSmartQueue,
  refreshLiveTripAutopilot,
  simulateLiveTripAutopilot,
} from '../services/liveTripApi.js'
import { isLiveTripOperable } from '../utils/journeyCenter.js'
import {
  getSimulationPresentation,
  hasOpenTripActivityWindow,
} from '../utils/liveTripExperience.js'
import { selectLiveTripPressure } from '../utils/liveTripPressure.js'

const PRESSURE_STYLES = {
  QUIET: {
    label: 'Nhu cầu thấp',
    badge: 'bg-emerald-50 text-emerald-700',
    bar: 'bg-emerald-500',
  },
  MODERATE: {
    label: 'Nhu cầu vừa',
    badge: 'bg-amber-50 text-amber-700',
    bar: 'bg-amber-500',
  },
  BUSY: {
    label: 'Nhu cầu cao',
    badge: 'bg-orange-50 text-orange-700',
    bar: 'bg-orange-500',
  },
  VERY_BUSY: {
    label: 'Nhu cầu rất cao',
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
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    })
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
    ? `Nhu cầu VietTicket · khung ${selected.slot.startTime} - ${selected.slot.endTime}`
    : 'Nhu cầu quan sát trên VietTicket'

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{pressureLabel}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">
            {metrics?.bookedQty ?? 0} vé VietTicket đã đặt · còn {metrics?.availableTickets ?? 0} vé trong quota
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.badge}`}>
          {style.label} · {score}/100
        </span>
      </div>
      <div
        aria-label={`Chỉ số nhu cầu VietTicket ${score} trên 100`}
        aria-valuemax="100"
        aria-valuemin="0"
        aria-valuenow={score}
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${score}%` }} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
        <span>Check-in 15 phút: {metrics?.checkinsLast15Minutes ?? 0}</span>
        <span>Đang chờ thông minh: {metrics?.waitingGuests ?? 0} khách</span>
        <span>Độ ổn định show-rate: {pressure.confidence === 'HIGH' ? 'Cao' : pressure.confidence === 'MEDIUM' ? 'Vừa' : 'Thấp'}</span>
        <span>Phạm vi: chỉ khách VietTicket</span>
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
        Không phải mật độ toàn địa điểm: VietTicket không nhìn thấy khách mua từ kênh khác
        hoặc khách vãng lai nếu điểm đến không cung cấp dữ liệu đó.
      </p>
    </div>
  )
}

function AutopilotProposalPanel({ proposal, busy, interactive = true, onDecision }) {
  if (!proposal) return null
  const snapshot = proposal.snapshot && typeof proposal.snapshot === 'object'
    ? proposal.snapshot
    : {}
  const currentPressure = snapshot.currentPressure
  const proposedSlot = snapshot.proposedSlot
  const predictiveSignal = snapshot.predictiveSignal

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
          {(currentPressure || proposedSlot || predictiveSignal) && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {currentPressure && (
                <EvidenceMetric
                  label="Khung hiện tại"
                  value={`${Number(currentPressure.score || 0)}/100`}
                />
              )}
              {proposedSlot && (
                <EvidenceMetric
                  label={`Khung ${proposedSlot.startTime || 'đề xuất'}`}
                  value={`${Number(proposedSlot.score || 0)}/100`}
                />
              )}
              {predictiveSignal && (
                <EvidenceMetric
                  label={`ML ${predictiveSignal.confidence || 'đủ điều kiện'}`}
                  value={`${Number(predictiveSignal.p90Per15Minutes || 0).toFixed(1)} lượt/15 phút (P90)`}
                />
              )}
            </div>
          )}
          <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-5 text-violet-800">
            Bộ quyết định lai luật + ML định lượng · Không đổi booking · Không giữ vé/tồn chỗ ·
            Có đệm di chuyển {snapshot.safeguards?.travelBufferMinutes || 30} phút ·
            Hết hạn {formatDateTime(proposal.expiresAt)}
          </div>
          {interactive ? (
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
          ) : (
            <p className="mt-3 rounded-xl bg-white/80 p-3 text-xs font-semibold leading-5 text-violet-800">
              Đề xuất được giữ lại để đối chiếu lịch sử. Chuyến đã kết thúc nên không
              thể áp dụng thay đổi mới.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SmartQueuePanel({ item, busy, interactive = true, onAction }) {
  if (!item.bookingId) return null
  const queue = item.smartQueue
  const selectedPressure = selectLiveTripPressure(item.pressure, item)
  const pressureLevel = selectedPressure.metrics?.level
  const queueUseful = ['BUSY', 'VERY_BUSY'].includes(pressureLevel)
  const availability = item.smartQueueAvailability
  const readyDeadline = queue?.readyExpiresAt
    && !Number.isNaN(new Date(queue.readyExpiresAt).getTime())
    ? formatTime(queue.readyExpiresAt)
    : null

  if (!interactive) {
    if (!queue) return null
    return (
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-black">SmartQueue đã được lưu vào lịch sử chuyến đi</p>
        <p className="mt-1 text-xs leading-5">
          Trạng thái cuối: {queue.status}. Hàng chờ đã đóng nên không còn thao tác
          tham gia hoặc rời lượt.
        </p>
      </div>
    )
  }

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
    if (!queueUseful && (!availability || availability.code === 'QUEUE_NOT_NEEDED')) return null
    const isEligible = availability?.eligible === true
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
        <div>
          <p className="text-sm font-black text-cyan-950">
            {isEligible ? 'SmartQueue đang khả dụng' : 'SmartQueue chưa thể đăng ký'}
          </p>
          <p className="mt-1 text-xs leading-5 text-cyan-800">
            {availability?.message || 'Hệ thống chưa xác minh được chính sách vận hành của cổng. SmartQueue được khóa an toàn cho đến khi dữ liệu được đồng bộ.'}
          </p>
        </div>
        <button
          className="rounded-xl bg-[#006b72] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy || !isEligible}
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
              ? queue.policy?.paused
                ? 'Cổng đang tạm dừng xử lý; chưa tính bạn là no-show trong thời gian này.'
                : readyDeadline
                  ? `Di chuyển đến cổng và mở mã QR trước ${readyDeadline}.`
                  : 'Đã đến lượt; hệ thống đang đối soát cửa sổ quay lại trước khi hiển thị hạn cuối.'
              : `Ước tính còn ${queue.estimatedWaitMinutes || '—'} phút · ${queue.guestsAhead || 0} khách phía trước`}
          </p>
          {queue.policy?.paused && (
            <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
              Hàng chờ đang tạm dừng: {queue.policy.pauseReason || 'lý do vận hành'}.
              Thứ tự và thời gian quay lại được bảo lưu trong giới hạn giờ vé.
            </p>
          )}
          {queue.refreshError && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" role="status">
              ETA/vị trí mới chưa đồng bộ được. Trạng thái gần nhất vẫn được giữ; hãy
              chờ realtime hoặc lần làm mới dự phòng tiếp theo.
            </p>
          )}
          {!isReady && (
            <p className="mt-1 text-xs text-cyan-800">
              ETA dựa trên {queue.estimateBasis === 'RECENT_QR_THROUGHPUT' ? 'tốc độ check-in QR 15 phút gần nhất' : 'throughput bảo thủ do đối tác cấu hình'} · độ tin cậy {queue.confidence === 'HIGH' ? 'cao' : queue.confidence === 'MEDIUM' ? 'vừa' : 'thấp'}
            </p>
          )}
          <p className={`mt-1 text-xs ${isReady ? 'text-emerald-800' : 'text-cyan-800'}`}>
            Lượt áp dụng cho cả nhóm {queue.partySize || 1} khách; khi QR đầu tiên được
            check-in, lượt SmartQueue kết thúc nhưng các vé còn lại vẫn giữ hiệu lực riêng.
          </p>
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
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Nhật ký giữ nguyên nội dung tại thời điểm phát sinh. Mọi từ “đông” hoặc
          “áp lực” trong lịch sử chỉ nói về nhu cầu VietTicket quan sát được, không
          phải tổng khách tại địa điểm.
        </p>
      </div>
      <div aria-live="polite" className="mt-5 space-y-3">
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
  const [isSyncing, setIsSyncing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulation, setSimulation] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [syncWarning, setSyncWarning] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [socketConnected, setSocketConnected] = useState(Boolean(socket.connected))
  const [queueActionItemId, setQueueActionItemId] = useState('')
  const [proposalActionId, setProposalActionId] = useState('')
  const [decisionClock, setDecisionClock] = useState(() => new Date())
  const loadRequestRef = useRef(0)
  const hasLoadedTripRef = useRef(false)

  const loadTrip = useCallback(async ({ silent = false } = {}) => {
    if (!tripId) return false
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId

    if (silent) setIsSyncing(true)
    else setIsLoading(true)

    try {
      const response = await getLiveTrip(tripId)
      if (requestId !== loadRequestRef.current) return false
      setTrip(response.data)
      hasLoadedTripRef.current = true
      setLastSyncedAt(response.data?.calculatedAt || new Date())
      setErrorMessage('')
      setSyncWarning('')
      return true
    } catch (error) {
      if (requestId !== loadRequestRef.current) return false
      const message = error?.message || 'Không thể đồng bộ Live Trip.'
      if (silent && hasLoadedTripRef.current) setSyncWarning(message)
      else setErrorMessage(message)
      return false
    } finally {
      if (requestId === loadRequestRef.current) {
        setIsLoading(false)
        setIsSyncing(false)
      }
    }
  }, [tripId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTrip()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      loadRequestRef.current += 1
    }
  }, [loadTrip])

  useEffect(() => {
    function handleLiveTripUpdated(payload) {
      if (String(payload?.tripId) !== String(tripId)) return
      void loadTrip({ silent: true })
    }

    socket.on('LIVE_TRIP_UPDATED', handleLiveTripUpdated)
    return () => socket.off('LIVE_TRIP_UPDATED', handleLiveTripUpdated)
  }, [loadTrip, socket, tripId])

  useEffect(() => {
    const handleConnect = () => setSocketConnected(true)
    const handleDisconnect = () => setSocketConnected(false)

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
    }
  }, [socket])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void loadTrip({ silent: true })
      }
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [loadTrip])

  useEffect(() => {
    const timer = window.setInterval(() => setDecisionClock(new Date()), 15 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const syncWhenAvailable = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void loadTrip({ silent: true })
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

  const isTripActive = isLiveTripOperable(trip, decisionClock)
    && hasOpenTripActivityWindow(trip, decisionClock)
  const tripStatus = String(trip?.status || '').toUpperCase() === 'CANCELLED'
    ? { label: 'Đã hủy', className: 'bg-rose-100 text-rose-800', icon: 'cancel' }
    : isTripActive
      ? { label: 'Đang hoạt động', className: 'bg-emerald-100 text-emerald-800', icon: 'sensors' }
      : { label: 'Đã kết thúc', className: 'bg-slate-100 text-slate-700', icon: 'history' }

  const proposalsByItem = useMemo(
    () => new Map((trip?.proposals || []).map((proposal) => [proposal.liveTripItemId, proposal])),
    [trip?.proposals],
  )

  async function handleRefresh() {
    if (!tripId || isAnalyzing) return
    setIsAnalyzing(true)
    try {
      const response = await refreshLiveTripAutopilot(tripId)
      setAnalysis(response.data)
      const loaded = await loadTrip({ silent: true })
      if (loaded) toast.success('Autopilot đã phân tích lại chuyến đi.')
    } catch (error) {
      toast.error(error.message || 'Không thể phân tích lại chuyến đi.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleSimulation() {
    if (!tripId || isSimulating) return
    setIsSimulating(true)
    try {
      const response = await simulateLiveTripAutopilot(tripId)
      setSimulation(response.data)
      const presentation = getSimulationPresentation(response.data)
      if (
        presentation?.fallback
        || !presentation?.metricsAvailable
        || presentation?.hasRegression
        || presentation?.hasConstraintViolations
      ) {
        toast.warning('Kết quả tối ưu không vượt qua cổng an toàn; hệ thống đã giữ nguyên lịch.')
      } else {
        toast.success('Đã chạy mô phỏng ràng buộc Autopilot; lịch trình chưa bị thay đổi.')
      }
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
      let response
      if (action === 'join') {
        response = await joinSmartQueue(tripId, item.id)
        toast.success('Đã tham gia SmartQueue.')
      } else {
        response = await leaveSmartQueue(tripId, item.id)
        toast.info('Đã rời SmartQueue.')
      }
      setTrip((current) => current
        ? {
            ...current,
            items: (current.items || []).map((candidate) => (
              candidate.id === item.id
                ? { ...candidate, smartQueue: response.data }
                : candidate
            )),
          }
        : current)
      void loadTrip({ silent: true })
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
      const response = await decideLiveTripProposal(tripId, proposal.id, decision)
      setTrip((current) => current
        ? {
            ...current,
            items: response.data?.item
              ? (current.items || []).map((item) => (
                  item.id === response.data.item.id
                    ? { ...item, ...response.data.item }
                    : item
                ))
              : current.items,
            proposals: (current.proposals || []).filter((candidate) => candidate.id !== proposal.id),
          }
        : current)
      toast.success(decision === 'ACCEPT'
        ? 'Đã áp dụng khung giờ mới. Booking của bạn không bị thay đổi.'
        : 'Đã giữ nguyên lịch trình hiện tại.')
      void loadTrip({ silent: true })
    } catch (error) {
      toast.error(error.message || 'Không thể xử lý đề xuất Autopilot.')
      await loadTrip({ silent: true })
    } finally {
      setProposalActionId('')
    }
  }

  return (
    <>
      <Header activeLink="Hành trình" />
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
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-xl bg-[#00474d] px-4 py-2 text-sm font-bold text-white"
                  onClick={() => void loadTrip()}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>
                  Thử đồng bộ lại
                </button>
                <Link className="inline-flex rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700" to="/journey">
                  Trung tâm hành trình
                </Link>
              </div>
            </div>
          ) : trip ? (
            <>
              <section className="rounded-3xl bg-[#00474d] p-6 text-white shadow-xl md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a9e8e5]">VietTicket Live</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${tripStatus.className}`}>
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{tripStatus.icon}</span>
                        {tripStatus.label}
                      </span>
                    </div>
                    <h1 className="mt-2 text-3xl font-black md:text-4xl">{trip.title}</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d4f2f1]">
                      {isTripActive
                        ? 'Autopilot giám sát lịch trình, SmartQueue giữ lượt vào cổng và mọi đề xuất đổi lịch đều cần bạn xác nhận.'
                        : 'Đây là hồ sơ hành trình đã lưu. Các quyết định, tín hiệu áp lực và sự kiện được giữ lại để bạn đối chiếu sau chuyến đi.'}
                    </p>
                  </div>
                  {isTripActive ? (
                    <div className="flex flex-wrap gap-3">
                      <LiveNotificationPermissionControl />
                      <button
                        className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/20 disabled:opacity-60"
                        disabled={isAnalyzing || isSimulating}
                        onClick={handleRefresh}
                        type="button"
                      >
                        <span className={`material-symbols-outlined text-[18px] ${isAnalyzing ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
                        Phân tích lại
                      </button>
                      <button
                        className="inline-flex items-center gap-2 rounded-xl bg-[#a9e8e5] px-4 py-2 text-sm font-black text-[#00474d] transition hover:bg-white disabled:opacity-60"
                        disabled={isAnalyzing || isSimulating}
                        onClick={handleSimulation}
                        type="button"
                      >
                        <span className={`material-symbols-outlined text-[18px] ${isSimulating ? 'animate-spin' : ''}`} aria-hidden="true">science</span>
                        Mô phỏng tối ưu
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <Link
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-black text-[#00474d]"
                        to="/journey"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">travel_explore</span>
                        Trung tâm hành trình
                      </Link>
                      <Link
                        className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-bold"
                        to="/rewards"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">redeem</span>
                        Xem điểm thưởng
                      </Link>
                    </div>
                  )}
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="Hoạt động" value={summary.activities} />
                  <StatCard label="Đã liên kết vé" value={summary.linkedBookings} />
                  <StatCard label="Cần theo dõi" value={summary.atRisk} />
                  <StatCard label="SmartQueue đang bật" value={summary.activeQueues} />
                </div>
              </section>

              <div className={`mt-6 rounded-2xl border p-4 text-sm leading-6 ${
                isTripActive
                  ? 'border-sky-200 bg-sky-50 text-sky-900'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}>
                <strong>{isTripActive ? 'Minh bạch & an toàn:' : 'Hồ sơ đã khóa thao tác:'}</strong>{' '}
                {isTripActive
                  ? 'chỉ số nhu cầu chỉ phản ánh dữ liệu VietTicket quan sát được, không phải tổng khách tại địa điểm. Autopilot không tự đổi/hủy booking, không giữ tồn chỗ; SmartQueue chỉ hoạt động khi partner đã kích hoạt luồng tại cổng.'
                  : 'chuyến đã qua ngày hoạt động hoặc đã đóng trạng thái. VietTicket giữ lịch sử để đối chiếu nhưng không cho chạy lại Autopilot, tham gia SmartQueue hoặc áp dụng đề xuất cũ.'}
              </div>

              <LiveTripCommandCenter
                analysis={analysis}
                connected={socketConnected}
                interactive={isTripActive}
                lastSyncedAt={lastSyncedAt}
                syncError={syncWarning}
                syncing={isSyncing}
                trip={trip}
              />

              {isTripActive && simulation && (
                <AutopilotSimulationPanel items={trip.items} simulation={simulation} />
              )}

              <section className="mt-8 space-y-6" id="live-itinerary">
                {dayGroups.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-slate-400" aria-hidden="true">event_busy</span>
                    <h2 className="mt-3 text-xl font-black text-[#00474d]">Chưa có hoạt động hợp lệ</h2>
                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      Live Trip vẫn được giữ an toàn, nhưng lịch trình nguồn chưa cung cấp
                      hoạt động để AI theo dõi. Hãy kiểm tra lại kế hoạch đã lưu.
                    </p>
                    <Link className="mt-4 inline-flex rounded-xl bg-[#00474d] px-4 py-2 text-sm font-bold text-white" to="/journey">
                      Kiểm tra kế hoạch
                    </Link>
                  </div>
                ) : dayGroups.map(([dayIndex, items]) => (
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7" key={dayIndex}>
                    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#00858a]">Ngày {dayIndex + 1}</p>
                        <h2 className="mt-1 text-xl font-black text-[#00474d]">
                          {formatDate(items[0]?.snapshot?.visitDate || items[0]?.scheduledStart)}
                        </h2>
                      </div>
                      <span className="text-sm font-semibold text-slate-500">{items.length} hoạt động</span>
                    </div>

                    <div className="mt-5 space-y-5">
                      {items.map((item) => {
                        const status = ITEM_STATUS[item.status] || ITEM_STATUS.PLANNED
                        return (
                          <article
                            className="relative scroll-mt-24 pl-8"
                            id={`activity-${encodeURIComponent(item.id)}`}
                            key={item.id}
                          >
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
                              interactive={isTripActive}
                              onDecision={handleProposalDecision}
                              proposal={proposalsByItem.get(item.id)}
                            />
                            <SmartQueuePanel
                              busy={Boolean(queueActionItemId)}
                              interactive={isTripActive}
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

function EvidenceMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-violet-200 bg-white/80 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">{label}</p>
      <p className="mt-1 text-sm font-black text-violet-950">{value}</p>
    </div>
  )
}

export default LiveTripPage
