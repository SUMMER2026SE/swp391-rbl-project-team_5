import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { getSmartQueuePolicy, listAttractions, updateSmartQueuePolicy } from '../services/partnerApi.js'
import {
  getPartnerAttractionLabel,
  getPartnerAttractionRows,
} from '../utils/partnerSmartQueue.js'

function PartnerSmartQueuePage() {
  const [attractions, setAttractions] = useState([])
  const [attractionId, setAttractionId] = useState('')
  const [form, setForm] = useState({ enabled: true, mode: 'AUTO', openBeforeMinutes: 120, readyGraceMinutes: 10, maxReadyParties: 3, maxActiveParties: 100, fallbackThroughput15m: 8 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listAttractions({ limit: 100, status: 'ACTIVE' }).then((response) => {
      const rows = getPartnerAttractionRows(response)
      setAttractions(rows)
      setAttractionId(rows[0]?.id || '')
    }).catch((error) => toast.error(error.message || 'Không thể tải điểm tham quan.')).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!attractionId) return
    getSmartQueuePolicy(attractionId).then((response) => setForm((current) => ({ ...current, ...response.data }))).catch((error) => toast.error(error.message || 'Không thể tải policy SmartQueue.'))
  }, [attractionId])

  const selected = useMemo(() => attractions.find((item) => item.id === attractionId), [attractions, attractionId])

  function setField(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  async function save(event) {
    event.preventDefault()
    if (!attractionId || saving) return
    setSaving(true)
    try {
      await updateSmartQueuePolicy(attractionId, {
        enabled: Boolean(form.enabled),
        mode: form.mode,
        openBeforeMinutes: Number(form.openBeforeMinutes),
        readyGraceMinutes: Number(form.readyGraceMinutes),
        maxReadyParties: Number(form.maxReadyParties),
        maxActiveParties: Number(form.maxActiveParties),
        fallbackThroughput15m: Number(form.fallbackThroughput15m),
      })
      toast.success('Đã lưu policy SmartQueue cho điểm tham quan.')
    } catch (error) { toast.error(error.message || 'Không thể lưu policy SmartQueue.') } finally { setSaving(false) }
  }

  return (
    <PartnerLayout pageTitle="SmartQueue & Autopilot">
      <div className="space-y-6">
        <header><p className="text-xs font-black uppercase tracking-[0.16em] text-[#00858a]">Partner operations</p><h1 className="mt-1 text-2xl font-black text-[#00474d]">Cấu hình SmartQueue</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Đối tác kiểm soát quy tắc vận hành; hệ thống không tự thay booking và mọi thay đổi đều ghi audit.</p></header>
        <form className="max-w-3xl space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7" onSubmit={save}>
          <label className="block text-sm font-bold text-slate-700">Điểm tham quan<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" disabled={loading || attractions.length === 0} value={attractionId} onChange={(event) => setAttractionId(event.target.value)}>{attractions.map((attraction) => <option key={attraction.id} value={attraction.id}>{getPartnerAttractionLabel(attraction)}</option>)}</select></label>
          {!loading && attractions.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              Chưa có điểm tham quan đang hoạt động để cấu hình. Hãy hoàn tất quy trình duyệt và kích hoạt điểm tham quan trước khi bật SmartQueue.
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><div><p className="font-bold text-slate-800">Cho phép SmartQueue</p><p className="text-xs text-slate-500">Chỉ mở khi booking đúng ngày và còn trong giờ.</p></div><input aria-label="Cho phép SmartQueue" checked={Boolean(form.enabled)} className="h-5 w-5" type="checkbox" onChange={(event) => setField('enabled', event.target.checked)} /></div>
          <label className="block text-sm font-bold text-slate-700">Chế độ điều phối<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" value={form.mode} onChange={(event) => setField('mode', event.target.value)}><option value="AUTO">Auto: hệ thống gọi theo FIFO và áp lực</option><option value="STAFF_CONTROLLED">Staff-controlled: nhân viên gọi thủ công</option></select></label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><NumberField label="Mở trước (phút)" value={form.openBeforeMinutes} min={0} max={1440} onChange={(value) => setField('openBeforeMinutes', value)} /><NumberField label="Grace sau khi gọi (phút)" value={form.readyGraceMinutes} min={1} max={60} onChange={(value) => setField('readyGraceMinutes', value)} /><NumberField label="Nhóm cùng lúc tại cổng" value={form.maxReadyParties} min={1} max={50} onChange={(value) => setField('maxReadyParties', value)} /><NumberField label="Tổng suất hàng chờ" value={form.maxActiveParties} min={1} max={10000} onChange={(value) => setField('maxActiveParties', value)} /></div>
          <NumberField label="Throughput fallback / 15 phút" value={form.fallbackThroughput15m} min={1} max={10000} onChange={(value) => setField('fallbackThroughput15m', value)} />
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs leading-5 text-sky-900">Suất hàng chờ là hữu hạn; mỗi booking chỉ được đăng ký một lần cho hoạt động trong ngày. Fallback throughput là ước tính bảo thủ khi chưa đủ dữ liệu QR. Từ 24 snapshot hợp lệ, ML dùng time-split và quantile p50/p90; nếu service lỗi, UI luôn ghi rõ fallback.</div>
          <button className="rounded-xl bg-[#006b72] px-5 py-3 text-sm font-black text-white disabled:opacity-60" disabled={saving || !selected} type="submit">{saving ? 'Đang lưu...' : 'Lưu policy vận hành'}</button>
        </form>
      </div>
    </PartnerLayout>
  )
}

function NumberField({ label, value, min, max, onChange }) { return <label className="block text-sm font-bold text-slate-700">{label}<input className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" max={max} min={min} type="number" value={value ?? ''} onChange={(event) => onChange(event.target.value)} /></label> }

export default PartnerSmartQueuePage
