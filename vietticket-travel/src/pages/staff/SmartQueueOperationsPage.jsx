import { useCallback, useEffect, useMemo, useState } from 'react'
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
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
}

function SmartQueueOperationsPage() {
  const [attractions, setAttractions] = useState([])
  const [attractionId, setAttractionId] = useState('')
  const [date, setDate] = useState(todayKey)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [paused, setPaused] = useState(false)
  const [pauseReason, setPauseReason] = useState('')

  const loadAttractions = useCallback(async () => {
    try {
      const response = await listSmartQueueAttractions()
      const rows = response.data || []
      setAttractions(rows)
      setAttractionId((current) => current || rows[0]?.id || '')
    } catch (error) {
      toast.error(error.message || 'Không thể tải danh sách điểm tham quan.')
    }
  }, [])

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    if (!attractionId) return
    if (!silent) setLoading(true)
    try {
      const response = await getSmartQueueOverview(attractionId, date)
      setOverview(response.data)
      setPaused(Boolean(response.data?.policy?.pausedAt))
    } catch (error) {
      toast.error(error.message || 'Không thể tải trạng thái SmartQueue.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [attractionId, date])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAttractions() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAttractions])
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOverview() }, 0)
    const poller = window.setInterval(() => { void loadOverview({ silent: true }) }, 15000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poller)
    }
  }, [loadOverview])

  const waiting = useMemo(() => (overview?.entries || []).filter((entry) => entry.status === 'WAITING'), [overview])
  const ready = useMemo(() => (overview?.entries || []).filter((entry) => entry.status === 'READY'), [overview])

  async function act(entry, action) {
    if (workingId) return
    setWorkingId(entry.id)
    try {
      if (action === 'CALL') await callSmartQueueEntry(entry.id)
      else await noShowSmartQueueEntry(entry.id)
      toast.success(action === 'CALL' ? 'Đã gọi khách đến cổng.' : 'Đã ghi nhận no-show.')
      await loadOverview()
    } catch (error) {
      toast.error(error.message || 'Trạng thái hàng chờ vừa thay đổi, vui lòng tải lại.')
    } finally {
      setWorkingId('')
    }
  }

  async function togglePause() {
    if (!attractionId || workingId) return
    if (!paused && pauseReason.trim().length < 5) {
      toast.error('Hãy nhập lý do tạm dừng cụ thể (ít nhất 5 ký tự).')
      return
    }
    setWorkingId('policy')
    try {
      if (paused) await resumeSmartQueue(attractionId)
      else await pauseSmartQueue(attractionId, pauseReason.trim())
      setPaused(!paused)
      if (!paused) setPauseReason('')
      toast.success(paused ? 'Đã mở lại SmartQueue.' : 'Đã tạm dừng SmartQueue.')
      await loadOverview()
    } catch (error) {
      toast.error(error.message || 'Không thể cập nhật policy SmartQueue.')
    } finally {
      setWorkingId('')
    }
  }

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm lượt SmartQueue...">
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#00858a]">Live operations</p>
            <h1 className="mt-1 text-2xl font-black text-[#00474d]">SmartQueue Control Tower</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">FIFO có kiểm soát, gọi khách tại cổng, no-show có thời hạn và nút dừng khẩn cấp. Mọi thao tác đều ghi audit.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Điểm tham quan" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" value={attractionId} onChange={(event) => setAttractionId(event.target.value)}>
              {attractions.map((attraction) => <option key={attraction.id} value={attraction.id}>{attraction.title}</option>)}
            </select>
            <input aria-label="Ngày vận hành" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            {!paused && <input aria-label="Lý do tạm dừng" className="min-w-56 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" maxLength={300} placeholder="Lý do sự cố/vận hành..." value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} />}
            <button className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${paused ? 'bg-emerald-700' : 'bg-amber-600'}`} disabled={workingId === 'policy' || (!paused && pauseReason.trim().length < 5)} onClick={togglePause} type="button">
              {paused ? 'Mở lại hàng chờ' : 'Tạm dừng khẩn cấp'}
            </button>
            <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={loading} onClick={() => loadOverview()} type="button">Làm mới</button>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <Metric label="Đang chờ" value={overview?.summary?.waitingParties ?? '—'} hint={`${overview?.summary?.waitingGuests || 0} khách`} />
          <Metric label="Đã gọi" value={overview?.summary?.readyParties ?? '—'} hint={`${overview?.summary?.readyGuests || 0} khách · tối đa ${overview?.policy?.maxReadyParties || 3} nhóm`} />
          <Metric label="Áp lực toàn điểm/ngày" value={overview ? `${overview.pressure?.summary?.score || 0}/100` : '—'} hint={overview?.pressure?.summary?.label || 'Đang tải'} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-lg font-black text-[#00474d]">Hàng chờ theo FIFO</h2><p className="text-xs text-slate-500">Tự làm mới mỗi 15 giây · cập nhật {formatTime(overview?.generatedAt)}</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{overview?.policy?.mode === 'STAFF_CONTROLLED' ? 'Staff-controlled' : 'Auto + override'}</span>
          </div>
          {paused && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Đang tạm dừng:</strong> {overview?.policy?.pauseReason || 'Lý do vận hành chưa được cung cấp.'} Thứ tự của khách được bảo lưu.</div>}
          {loading ? <p className="py-10 text-center text-sm text-slate-500" role="status">Đang tải dữ liệu vận hành...</p> : waiting.length === 0 && ready.length === 0 ? <EmptyState /> : (
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
                        ? `Áp lực khung ${entry.pressure.timeSlot.startTime} - ${entry.pressure.timeSlot.endTime}`
                        : 'Áp lực toàn ngày'}: {entry.pressure?.label || 'Chưa xác định'} · {entry.pressure?.score ?? 0}/100
                    </p>
                    {entry.status === 'WAITING' && !entry.callWindowOpen && entry.callAvailableAt && (
                      <p className="mt-1 text-xs font-semibold text-amber-700">Có thể gọi từ {formatTime(entry.callAvailableAt)}.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {entry.status === 'WAITING' && (
                      <button
                        className="rounded-lg bg-[#006b72] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        disabled={workingId === entry.id || paused || !entry.callWindowOpen || entry.position !== 1 || Number(entry.readyPartiesInScope || 0) >= Number(overview?.policy?.maxReadyParties || 3)}
                        onClick={() => act(entry, 'CALL')}
                        title={!entry.callWindowOpen && entry.callAvailableAt ? `Chỉ có thể gọi từ ${formatTime(entry.callAvailableAt)}` : undefined}
                        type="button"
                      >
                        {!entry.callWindowOpen ? 'Chưa đến giờ gọi' : entry.position === 1 ? 'Gọi lượt' : 'Chờ FIFO'}
                      </button>
                    )}
                    {entry.status === 'READY' && <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50" disabled={workingId === entry.id || !entry.readyExpiresAt || new Date(entry.readyExpiresAt) > new Date()} onClick={() => act(entry, 'NO_SHOW')} title="Chỉ khả dụng khi hết cửa sổ quay lại" type="button">No-show</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}

function Metric({ label, value, hint }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-[#00474d]">{value}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></div> }
function EmptyState() { return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">Chưa có lượt SmartQueue hợp lệ trong ngày này.</div> }

export default SmartQueueOperationsPage
