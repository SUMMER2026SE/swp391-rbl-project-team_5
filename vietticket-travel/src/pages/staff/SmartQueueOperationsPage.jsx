import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import {
  callSmartQueueEntry,
  getSmartQueueOverview,
  listSmartQueueAttractions,
  noShowSmartQueueEntry,
  pauseSmartQueue,
  resumeSmartQueue,
} from '../../services/staffApi.js'

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
}

function SmartQueueOperationsPage() {
  const [attractions, setAttractions] = useState([])
  const [attractionId, setAttractionId] = useState('')
  const [date, setDate] = useState(todayKey)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [attractionsLoading, setAttractionsLoading] = useState(true)
  const [attractionsError, setAttractionsError] = useState('')
  const [overviewError, setOverviewError] = useState('')
  const [loadedScope, setLoadedScope] = useState(null)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [workingId, setWorkingId] = useState('')
  const [paused, setPaused] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [confirmationTarget, setConfirmationTarget] = useState(null)
  const overviewRequestRef = useRef(0)

  const loadAttractions = useCallback(async () => {
    setAttractionsLoading(true)
    setAttractionsError('')
    try {
      const response = await listSmartQueueAttractions()
      const rows = response.data || []
      setAttractions(rows)
      setAttractionId((current) => (
        rows.some((attraction) => attraction.id === current)
          ? current
          : rows[0]?.id || ''
      ))
      if (rows.length === 0) {
        overviewRequestRef.current += 1
        setOverview(null)
        setLoadedScope(null)
        setLoading(false)
        setSyncing(false)
      }
    } catch (error) {
      setAttractions([])
      setAttractionId('')
      setAttractionsError(error.message || 'Không thể tải danh sách điểm tham quan.')
      overviewRequestRef.current += 1
      setOverview(null)
      setLoadedScope(null)
      setLoading(false)
      setSyncing(false)
    } finally {
      setAttractionsLoading(false)
    }
  }, [])

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    const requestedAttractionId = attractionId
    const requestedDate = date
    const requestId = ++overviewRequestRef.current

    if (!requestedAttractionId) {
      setOverview(null)
      setLoadedScope(null)
      setLoading(false)
      setSyncing(false)
      return false
    }

    setSyncing(true)
    if (!silent) {
      setLoading(true)
      setOverviewError('')
    }

    try {
      const response = await getSmartQueueOverview(requestedAttractionId, requestedDate)
      if (requestId !== overviewRequestRef.current) return false
      setOverview(response.data)
      setLoadedScope({ attractionId: requestedAttractionId, date: requestedDate })
      setPaused(Boolean(response.data?.policy?.pausedAt))
      setLastSyncedAt(response.data?.generatedAt || new Date().toISOString())
      setOverviewError('')
      return true
    } catch (error) {
      if (requestId !== overviewRequestRef.current) return false
      const message = error.message || 'Không thể tải trạng thái SmartQueue.'
      setOverviewError(message)
      if (!silent) toast.error(message)
      return false
    } finally {
      if (requestId === overviewRequestRef.current) {
        setLoading(false)
        setSyncing(false)
      }
    }
  }, [attractionId, date])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAttractions() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAttractions])
  useEffect(() => {
    if (!attractionId) {
      return undefined
    }
    const timer = window.setTimeout(() => { void loadOverview() }, 0)
    const poller = window.setInterval(() => { void loadOverview({ silent: true }) }, 15000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poller)
      overviewRequestRef.current += 1
    }
  }, [attractionId, loadOverview])

  const overviewCurrent = Boolean(
    overview
    && loadedScope?.attractionId === attractionId
    && loadedScope?.date === date,
  )
  const waiting = useMemo(
    () => (overviewCurrent ? overview?.entries || [] : []).filter((entry) => entry.status === 'WAITING'),
    [overview, overviewCurrent],
  )
  const ready = useMemo(
    () => (overviewCurrent ? overview?.entries || [] : []).filter((entry) => entry.status === 'READY'),
    [overview, overviewCurrent],
  )
  const policyEnabled = overviewCurrent && overview?.policy?.enabled === true
  const actionsLocked = loading || syncing || !overviewCurrent || Boolean(overviewError) || Boolean(workingId)

  function invalidateOverview(nextAttractionId) {
    overviewRequestRef.current += 1
    setOverview(null)
    setLoadedScope(null)
    setOverviewError('')
    setLastSyncedAt(null)
    setConfirmationTarget(null)
    setPaused(false)
    setLoading(Boolean(nextAttractionId))
    setSyncing(false)
  }

  function canCall(entry) {
    return policyEnabled
      && !paused
      && !actionsLocked
      && entry.status === 'WAITING'
      && entry.callWindowOpen
      && entry.position === 1
      && Number(entry.readyPartiesInScope || 0) < Number(overview?.policy?.maxReadyParties || 3)
      && Number(entry.readyGuestsInScope || 0) + Number(entry.partySize || 1)
        <= Number(overview?.policy?.maxReadyGuests || 20)
  }

  function canNoShow(entry) {
    return policyEnabled
      && !paused
      && !actionsLocked
      && entry.status === 'READY'
      && entry.readyExpiresAt
      && new Date(entry.readyExpiresAt) <= new Date()
  }

  function requestAction(entry, action) {
    if ((action === 'CALL' && !canCall(entry)) || (action === 'NO_SHOW' && !canNoShow(entry))) {
      return
    }
    setConfirmationTarget({
      action,
      entry,
      scope: { attractionId, date },
    })
  }

  async function act() {
    if (!confirmationTarget) return
    const { action, entry, scope } = confirmationTarget
    const currentEntry = overview?.entries?.find((candidate) => candidate.id === entry.id)
    const scopeStillCurrent = scope.attractionId === attractionId
      && scope.date === date
      && overviewCurrent
    const actionStillValid = currentEntry
      && ((action === 'CALL' && canCall(currentEntry)) || (action === 'NO_SHOW' && canNoShow(currentEntry)))

    if (!scopeStillCurrent || !actionStillValid) {
      setConfirmationTarget(null)
      toast.warning('Lượt vừa thay đổi hoặc dữ liệu đã cũ. Hãy tải lại trước khi thao tác.')
      void loadOverview()
      return
    }

    setWorkingId(entry.id)
    setConfirmationTarget(null)
    try {
      if (action === 'CALL') await callSmartQueueEntry(entry.id)
      else await noShowSmartQueueEntry(entry.id)
      toast.success(action === 'CALL' ? 'Đã gọi khách đến cổng.' : 'Đã ghi nhận no-show.')
      await loadOverview()
    } catch (error) {
      const message = error.message || 'Trạng thái hàng chờ vừa thay đổi, vui lòng tải lại.'
      setOverviewError(message)
      toast.error(message)
      await loadOverview({ silent: true })
    } finally {
      setWorkingId('')
    }
  }

  async function togglePause() {
    if (!attractionId || actionsLocked) return
    if (!paused && pauseReason.trim().length < 5) {
      toast.error('Hãy nhập lý do tạm dừng cụ thể (ít nhất 5 ký tự).')
      return
    }
    const wasPaused = paused
    setWorkingId('policy')
    try {
      if (wasPaused) await resumeSmartQueue(attractionId)
      else await pauseSmartQueue(attractionId, pauseReason.trim())
      if (!wasPaused) setPauseReason('')
      toast.success(wasPaused ? 'Đã mở lại SmartQueue.' : 'Đã tạm dừng SmartQueue.')
      await loadOverview()
    } catch (error) {
      toast.error(error.message || 'Không thể cập nhật policy SmartQueue.')
    } finally {
      setWorkingId('')
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#00858a]">Live operations</p>
            <h1 className="mt-1 text-2xl font-black text-[#00474d]">SmartQueue Control Tower</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">FIFO có kiểm soát, gọi khách tại cổng, no-show có thời hạn và nút dừng khẩn cấp. Mọi thao tác đều ghi audit.</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Chỉ điều phối khách có booking VietTicket; chỉ số nhu cầu không đại diện toàn bộ khách đang có mặt tại điểm đến.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Điểm tham quan"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100"
              disabled={attractionsLoading || Boolean(workingId)}
              value={attractionId}
              onChange={(event) => {
                const nextAttractionId = event.target.value
                invalidateOverview(nextAttractionId)
                setAttractionId(nextAttractionId)
              }}
            >
              {attractions.length === 0 && <option value="">Chưa có điểm tham quan</option>}
              {attractions.map((attraction) => <option key={attraction.id} value={attraction.id}>{attraction.title}</option>)}
            </select>
            <input
              aria-label="Ngày vận hành"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
              disabled={attractionsLoading || Boolean(workingId)}
              type="date"
              value={date}
              onChange={(event) => {
                invalidateOverview(attractionId)
                setDate(event.target.value)
              }}
            />
            {!paused && <input aria-label="Lý do tạm dừng" className="min-w-56 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100" disabled={!policyEnabled || actionsLocked} maxLength={300} placeholder={policyEnabled ? 'Lý do sự cố/vận hành...' : 'Partner chưa kích hoạt SmartQueue'} value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} />}
            <button className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${paused ? 'bg-emerald-700' : 'bg-amber-600'}`} disabled={!policyEnabled || actionsLocked || (!paused && pauseReason.trim().length < 5)} onClick={togglePause} type="button">
              {paused ? 'Mở lại hàng chờ' : 'Tạm dừng khẩn cấp'}
            </button>
            <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={syncing || !attractionId} onClick={() => void loadOverview()} type="button">Làm mới</button>
          </div>
        </header>

        {attractionsError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
            <span><strong>Không tải được danh sách điểm tham quan:</strong> {attractionsError}</span>
            <button className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-black hover:bg-rose-100" onClick={() => void loadAttractions()} type="button">
              Thử lại
            </button>
          </div>
        )}
        {!attractionsLoading && !attractionsError && attractions.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
            Chưa có điểm tham quan được phân công để điều phối SmartQueue.
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          <Metric label="Đang chờ" value={overview?.summary?.waitingParties ?? '—'} hint={`${overview?.summary?.waitingGuests || 0} khách`} />
          <Metric label="Đã gọi" value={overview?.summary?.readyParties ?? '—'} hint={`${overview?.summary?.readyGuests || 0}/${overview?.policy?.maxReadyGuests || 20} khách · tối đa ${overview?.policy?.maxReadyParties || 3} nhóm`} />
          <Metric label="Nhu cầu VietTicket/ngày" value={overview ? `${overview.pressure?.summary?.score || 0}/100` : '—'} hint={overview?.pressure?.summary?.label || 'Đang tải'} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-[#00474d]">Hàng chờ theo FIFO</h2>
              <p className="text-xs text-slate-500">
                Tự làm mới mỗi 15 giây · cập nhật {formatTime(overview?.generatedAt || lastSyncedAt)}
                {syncing ? ' · đang kiểm tra…' : lastSyncedAt ? ` · đồng bộ ${formatTime(lastSyncedAt)}` : ''}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${policyEnabled ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
              {!policyEnabled ? 'Chưa kích hoạt' : overview?.policy?.mode === 'STAFF_CONTROLLED' ? 'Staff-controlled' : 'Auto + override'}
            </span>
          </div>
          {overviewError && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert">
              <span><strong>Dữ liệu đang cũ hoặc chưa tải được:</strong> {overviewError}</span>
              <button className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-black hover:bg-rose-100" disabled={syncing || !attractionId} onClick={() => void loadOverview()} type="button">
                Thử tải lại
              </button>
            </div>
          )}
          {!policyEnabled && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Không điều phối:</strong> partner chưa xác nhận có nhân sự và luồng check-in VietTicket tại cổng. Staff không thể gọi lượt hoặc ghi no-show cho tới khi policy được kích hoạt hợp lệ.</div>}
          {paused && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Đang tạm dừng:</strong> {overview?.policy?.pauseReason || 'Lý do vận hành chưa được cung cấp.'} Thứ tự và cửa sổ quay lại được bảo lưu trong giới hạn giờ vé.</div>}
          {loading && !overview ? <p className="py-10 text-center text-sm text-slate-500" role="status">Đang tải dữ liệu vận hành...</p> : !attractionId ? <EmptyState message="Chọn một điểm tham quan được phân công để xem hàng chờ." /> : waiting.length === 0 && ready.length === 0 ? <EmptyState /> : (
            <div className="mt-4 space-y-3">
              {[...ready, ...waiting].map((entry) => (
                <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4" key={entry.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-700">{entry.status === 'WAITING' ? `#${entry.position}` : 'ĐÃ GỌI'}</span>
                      <p className="font-bold text-slate-800">{entry.user?.fullName || entry.booking?.fullName || 'Khách hàng'}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {entry.partySize} khách · giờ tham quan {formatTime(entry.liveTripItem?.scheduledStart)} · tham gia {formatTime(entry.joinedAt)}
                      {entry.status === 'READY' && ` · hết hạn gọi ${formatTime(entry.readyExpiresAt)}`}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-cyan-700">
                      {entry.pressure?.timeSlot
                        ? `Nhu cầu VietTicket khung ${entry.pressure.timeSlot.startTime} - ${entry.pressure.timeSlot.endTime}`
                        : 'Nhu cầu VietTicket toàn ngày'}: {entry.pressure?.label || 'Chưa xác định'} · {entry.pressure?.score ?? 0}/100
                    </p>
                    {entry.status === 'WAITING' && !entry.callWindowOpen && entry.callAvailableAt && (
                      <p className="mt-1 text-xs font-semibold text-amber-700">Có thể gọi từ {formatTime(entry.callAvailableAt)}.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {entry.status === 'WAITING' && (
                      <button
                        className="rounded-lg bg-[#006b72] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        aria-label={`Gọi lượt cho ${entry.user?.fullName || entry.booking?.fullName || 'khách hàng'}`}
                        disabled={!canCall(entry)}
                        onClick={() => requestAction(entry, 'CALL')}
                        title={!entry.callWindowOpen && entry.callAvailableAt ? `Chỉ có thể gọi từ ${formatTime(entry.callAvailableAt)}` : undefined}
                        type="button"
                      >
                        {!entry.callWindowOpen ? 'Chưa đến giờ gọi' : entry.position === 1 ? 'Gọi lượt' : 'Chờ FIFO'}
                      </button>
                    )}
                    {entry.status === 'READY' && <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50" aria-label={`Ghi no-show cho ${entry.user?.fullName || entry.booking?.fullName || 'khách hàng'}`} disabled={!canNoShow(entry)} onClick={() => requestAction(entry, 'NO_SHOW')} title={!policyEnabled ? 'Partner chưa kích hoạt SmartQueue hợp lệ' : paused ? 'Không thể ghi no-show khi hàng chờ đang tạm dừng' : 'Chỉ khả dụng khi hết cửa sổ quay lại'} type="button">No-show</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {confirmationTarget && (
        <QueueActionDialog
          target={confirmationTarget}
          overview={overview}
          working={Boolean(workingId)}
          onCancel={() => {
            if (!workingId) setConfirmationTarget(null)
          }}
          onConfirm={() => void act()}
        />
      )}
    </AdminLayout>
  )
}

function Metric({ label, value, hint }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-[#00474d]">{value}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></div> }
function EmptyState({ message = 'Chưa có lượt SmartQueue hợp lệ trong ngày này.' }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">{message}</div>
}

function QueueActionDialog({ target, overview, working, onCancel, onConfirm }) {
  const isCall = target.action === 'CALL'
  const entry = target.entry
  const guestName = entry.user?.fullName || entry.booking?.fullName || 'Khách hàng'
  const graceMinutes = Number(overview?.policy?.readyGraceMinutes || 10)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
      onClick={working ? undefined : onCancel}
    >
      <div
        aria-describedby="smart-queue-action-description"
        aria-labelledby="smart-queue-action-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isCall ? 'bg-cyan-100 text-cyan-800' : 'bg-rose-100 text-rose-800'}`}>
          <span className="material-symbols-outlined text-2xl" aria-hidden="true">
            {isCall ? 'campaign' : 'person_off'}
          </span>
        </div>
        <h2 id="smart-queue-action-title" className="mt-4 text-xl font-black text-slate-950">
          {isCall ? 'Xác nhận gọi lượt' : 'Xác nhận no-show'}
        </h2>
        <p id="smart-queue-action-description" className="mt-2 text-sm leading-6 text-slate-600">
          {isCall
            ? `Gọi ${guestName} (${entry.partySize || 1} khách) đến cổng. Sau khi xác nhận, cửa sổ quay lại sẽ bắt đầu trong khoảng ${graceMinutes} phút và khách sẽ nhận thông báo.`
            : `Đóng vĩnh viễn lượt của ${guestName} (${entry.partySize || 1} khách) vì đã hết cửa sổ quay lại. Hành động này không tự khôi phục lượt.`}
        </p>
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <p><strong>Điểm tham quan:</strong> {entry.liveTripItem?.attraction?.title || entry.attraction?.title || 'Theo bộ lọc đang chọn'}</p>
          <p className="mt-1"><strong>Giờ tham quan:</strong> {formatTime(entry.liveTripItem?.scheduledStart)}</p>
          <p className="mt-1"><strong>Mã lượt:</strong> <span className="font-mono">{entry.id}</span></p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
            disabled={working}
            onClick={onCancel}
            type="button"
          >
            Hủy
          </button>
          <button
            className={`rounded-xl px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 ${isCall ? 'bg-[#006b72]' : 'bg-rose-700'}`}
            disabled={working}
            onClick={onConfirm}
            type="button"
          >
            {working ? 'Đang xử lý…' : isCall ? 'Xác nhận gọi lượt' : 'Xác nhận no-show'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SmartQueueOperationsPage
