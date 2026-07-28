import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { getSmartQueuePolicy, listAttractions, updateSmartQueuePolicy } from '../services/partnerApi.js'
import {
  getPartnerAttractionLabel,
  getPartnerAttractionRows,
} from '../utils/partnerSmartQueue.js'

const DEFAULT_POLICY = {
  enabled: false,
  mode: 'AUTO',
  openBeforeMinutes: 120,
  readyGraceMinutes: 10,
  maxReadyParties: 3,
  maxReadyGuests: 20,
  maxActiveParties: 100,
  fallbackThroughput15m: 8,
}

const POLICY_FIELDS = Object.keys(DEFAULT_POLICY)

function normalizePolicy(source = {}) {
  const numberOr = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  return {
    enabled: Boolean(source.enabled),
    mode: source.mode === 'STAFF_CONTROLLED' ? 'STAFF_CONTROLLED' : 'AUTO',
    openBeforeMinutes: numberOr(source.openBeforeMinutes, DEFAULT_POLICY.openBeforeMinutes),
    readyGraceMinutes: numberOr(source.readyGraceMinutes, DEFAULT_POLICY.readyGraceMinutes),
    maxReadyParties: numberOr(source.maxReadyParties, DEFAULT_POLICY.maxReadyParties),
    maxReadyGuests: numberOr(source.maxReadyGuests, DEFAULT_POLICY.maxReadyGuests),
    maxActiveParties: numberOr(source.maxActiveParties, DEFAULT_POLICY.maxActiveParties),
    fallbackThroughput15m: numberOr(source.fallbackThroughput15m, DEFAULT_POLICY.fallbackThroughput15m),
  }
}

function hasPolicyChanges(form, baseline) {
  if (!baseline) return false
  return POLICY_FIELDS.some((field) => String(form[field]) !== String(baseline[field]))
}

function PartnerSmartQueuePage() {
  const [attractions, setAttractions] = useState([])
  const [attractionId, setAttractionId] = useState('')
  const [form, setForm] = useState({ ...DEFAULT_POLICY })
  const [baseline, setBaseline] = useState(null)
  const [readinessConfirmed, setReadinessConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attractionsError, setAttractionsError] = useState('')
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policyError, setPolicyError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [policyReadyFor, setPolicyReadyFor] = useState('')
  const [saving, setSaving] = useState(false)
  const policyRequestRef = useRef(0)
  const saveRequestRef = useRef(0)

  const loadPolicy = useCallback(async (requestedAttractionId) => {
    if (!requestedAttractionId) return
    const requestId = ++policyRequestRef.current
    setPolicyLoading(true)
    setPolicyError('')
    try {
      const response = await getSmartQueuePolicy(requestedAttractionId)
      if (requestId !== policyRequestRef.current) return
      const persisted = normalizePolicy(response.data)
      setForm(persisted)
      setBaseline(persisted)
      setReadinessConfirmed(false)
      setPolicyReadyFor(requestedAttractionId)
      setSaveError('')
    } catch (error) {
      if (requestId !== policyRequestRef.current) return
      setPolicyReadyFor('')
      setPolicyError(error.message || 'Không thể tải policy SmartQueue.')
    } finally {
      if (requestId === policyRequestRef.current) setPolicyLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      listAttractions({ limit: 100, status: 'ACTIVE' })
        .then((response) => {
          if (!active) return
          const rows = getPartnerAttractionRows(response)
          setAttractions(rows)
          setAttractionId(rows[0]?.id || '')
          setAttractionsError('')
        })
        .catch((error) => {
          if (!active) return
          setAttractions([])
          setAttractionId('')
          setAttractionsError(error.message || 'Không thể tải điểm tham quan.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!attractionId) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      void loadPolicy(attractionId)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      policyRequestRef.current += 1
    }
  }, [attractionId, loadPolicy])

  const selected = useMemo(() => attractions.find((item) => item.id === attractionId), [attractions, attractionId])
  const initialEnabled = baseline?.enabled === true
  const dirty = hasPolicyChanges(form, baseline)

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setSaveError('')
  }

  function handleAttractionChange(nextAttractionId) {
    if (nextAttractionId === attractionId || saving) return
    if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Đổi điểm tham quan sẽ bỏ các thay đổi này. Tiếp tục?')) return
    policyRequestRef.current += 1
    setAttractionId(nextAttractionId)
    setForm({ ...DEFAULT_POLICY })
    setBaseline(null)
    setReadinessConfirmed(false)
    setPolicyLoading(false)
    setPolicyReadyFor('')
    setPolicyError('')
    setSaveError('')
  }

  async function save(event) {
    event.preventDefault()
    if (!attractionId || saving) return
    const savedAttractionId = attractionId
    const requestId = ++saveRequestRef.current
    const payload = {
      enabled: Boolean(form.enabled),
      mode: form.mode,
      openBeforeMinutes: Number(form.openBeforeMinutes),
      readyGraceMinutes: Number(form.readyGraceMinutes),
      maxReadyParties: Number(form.maxReadyParties),
      maxReadyGuests: Number(form.maxReadyGuests),
      maxActiveParties: Number(form.maxActiveParties),
      fallbackThroughput15m: Number(form.fallbackThroughput15m),
      // Only send a new acknowledgement when the partner actively checked it.
      // Existing enabled policies retain their original confirmation timestamp.
      operationalReadinessConfirmed: Boolean(readinessConfirmed),
    }
    setSaving(true)
    setSaveError('')
    try {
      const response = await updateSmartQueuePolicy(savedAttractionId, payload)
      if (requestId !== saveRequestRef.current || savedAttractionId !== attractionId) return
      if (!response?.data) throw new Error('Máy chủ chưa trả lại policy sau khi lưu.')
      const persisted = normalizePolicy(response.data)
      setForm(persisted)
      setBaseline(persisted)
      setReadinessConfirmed(false)
      setPolicyReadyFor(savedAttractionId)
      toast.success('Đã lưu policy SmartQueue cho điểm tham quan.')
    } catch (error) {
      if (requestId !== saveRequestRef.current || savedAttractionId !== attractionId) return
      const message = error.message || 'Không thể lưu policy SmartQueue.'
      setSaveError(message)
      toast.error(message)
    } finally {
      if (requestId === saveRequestRef.current) setSaving(false)
    }
  }

  return (
    <PartnerLayout pageTitle="SmartQueue & Autopilot">
      <div className="space-y-6">
        <header><p className="text-xs font-black uppercase tracking-[0.16em] text-[#00858a]">Partner operations</p><h1 className="mt-1 text-2xl font-black text-[#00474d]">Cấu hình SmartQueue</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Đối tác kiểm soát quy tắc và chịu trách nhiệm vận hành luồng check-in VietTicket tại cổng; mọi thay đổi đều ghi audit.</p></header>
        <form className="max-w-3xl space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7" onSubmit={save}>
          <label className="block text-sm font-bold text-slate-700">Điểm tham quan<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-100" disabled={loading || saving || attractions.length === 0} value={attractionId} onChange={(event) => handleAttractionChange(event.target.value)}>{attractions.map((attraction) => <option key={attraction.id} value={attraction.id}>{getPartnerAttractionLabel(attraction)}</option>)}</select></label>
          {!loading && attractions.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              {attractionsError || 'Chưa có điểm tham quan đang hoạt động để cấu hình. Hãy hoàn tất quy trình duyệt và kích hoạt điểm tham quan trước khi bật SmartQueue.'}
            </div>
          )}
          {policyLoading && <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" role="status">Đang tải policy của điểm tham quan đã chọn…</p>}
          {policyError && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert">
              <span><strong>Không tải được policy:</strong> {policyError}</span>
              <button className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-black hover:bg-rose-100" disabled={policyLoading || !attractionId} onClick={() => void loadPolicy(attractionId)} type="button">
                Thử lại
              </button>
            </div>
          )}
          {saveError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert"><strong>Chưa lưu được:</strong> {saveError} Các thay đổi vẫn còn trên màn hình để bạn kiểm tra.</div>}
          {dirty && !saving && !policyError && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">Bạn đang có thay đổi chưa lưu cho điểm tham quan này.</p>}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><div><p className="font-bold text-slate-800">Cho phép SmartQueue</p><p className="text-xs text-slate-500">Mặc định tắt; chỉ bật khi có nhân sự và quy trình xử lý khách VietTicket tại cổng.</p></div><input aria-label="Cho phép SmartQueue" checked={Boolean(form.enabled)} className="h-5 w-5" disabled={loading || policyLoading || saving || !baseline} type="checkbox" onChange={(event) => { setField('enabled', event.target.checked); if (!event.target.checked) setReadinessConfirmed(false) }} /></div>
          {form.enabled && !initialEnabled && (
            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <input aria-label="Xác nhận sẵn sàng vận hành" checked={readinessConfirmed} className="mt-1 h-5 w-5 shrink-0" disabled={loading || policyLoading || saving} type="checkbox" onChange={(event) => setReadinessConfirmed(event.target.checked)} />
              <span><strong>Xác nhận sẵn sàng vận hành:</strong> điểm đến có nhân sự nhận cảnh báo, gọi lượt FIFO và check-in QR cho khách VietTicket. SmartQueue không đại diện hàng chờ của toàn bộ khách tại địa điểm.</span>
            </label>
          )}
          <label className="block text-sm font-bold text-slate-700">Chế độ điều phối<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-100" disabled={loading || policyLoading || saving || !baseline} value={form.mode} onChange={(event) => setField('mode', event.target.value)}><option value="AUTO">Auto: gọi FIFO theo nhu cầu VietTicket và nhịp cổng</option><option value="STAFF_CONTROLLED">Staff-controlled: nhân viên gọi thủ công</option></select></label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><NumberField disabled={loading || policyLoading || saving || !baseline} label="Mở trước (phút)" value={form.openBeforeMinutes} min={0} max={1440} onChange={(value) => setField('openBeforeMinutes', value)} /><NumberField disabled={loading || policyLoading || saving || !baseline} label="Grace sau khi gọi (phút)" value={form.readyGraceMinutes} min={1} max={60} onChange={(value) => setField('readyGraceMinutes', value)} /><NumberField disabled={loading || policyLoading || saving || !baseline} label="Nhóm cùng lúc tại cổng" value={form.maxReadyParties} min={1} max={50} onChange={(value) => setField('maxReadyParties', value)} /><NumberField disabled={loading || policyLoading || saving || !baseline} label="Khách cùng lúc tại cổng" value={form.maxReadyGuests} min={1} max={1000} onChange={(value) => setField('maxReadyGuests', value)} /><NumberField disabled={loading || policyLoading || saving || !baseline} label="Tổng suất hàng chờ" value={form.maxActiveParties} min={1} max={10000} onChange={(value) => setField('maxActiveParties', value)} /></div>
          <NumberField disabled={loading || policyLoading || saving || !baseline} label="Throughput fallback / 15 phút" value={form.fallbackThroughput15m} min={1} max={10000} onChange={(value) => setField('fallbackThroughput15m', value)} />
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs leading-5 text-sky-900">ETA hàng chờ dùng throughput QR thực đo; khi chưa đủ dữ liệu, hệ thống dùng throughput bảo thủ do đối tác cấu hình. ML arrival chỉ dự báo nhu cầu VietTicket, không bị dùng nhầm làm tốc độ phục vụ và không tuyên bố mật độ toàn địa điểm.</div>
          <button className="rounded-xl bg-[#006b72] px-5 py-3 text-sm font-black text-white disabled:opacity-60" disabled={saving || loading || policyLoading || policyReadyFor !== attractionId || !selected || !baseline || (form.enabled && !initialEnabled && !readinessConfirmed)} type="submit">{saving ? 'Đang lưu...' : 'Lưu policy vận hành'}</button>
        </form>
      </div>
    </PartnerLayout>
  )
}

function NumberField({
  disabled,
  label,
  value,
  min,
  max,
  onChange,
}) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <input
        className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-100"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        required
        step="1"
        type="number"
        value={value ?? ''}
      />
    </label>
  )
}

export default PartnerSmartQueuePage
