import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import {
  getPricingImpact,
  getPricingPolicy,
  getPricingPreview,
  listAttractions,
  updatePricingPolicy,
} from '../services/partnerApi.js'
import {
  getPartnerAttractionLabel,
  getPartnerAttractionRows,
} from '../utils/partnerSmartQueue.js'

const DEMAND_META = {
  PEAK: { label: 'Cao điểm', chip: 'bg-[#ffedea] text-[#ba1a1a] border-[#ba1a1a]/20' },
  QUIET: { label: 'Giờ vắng', chip: 'bg-[#e0f4f5] text-[#00474d] border-[#006068]/20' },
  NORMAL: { label: 'Trung bình', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
}

const CONFIDENCE_LABEL = { HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp' }

const SIGNAL_LABEL = {
  AI_FORECAST: 'Dự báo AI',
  BLENDED: 'AI + vé đã bán',
  REALTIME_OCCUPANCY: 'Vé đã bán',
  // Không có tín hiệu hợp lệ luôn đi kèm một lý do cụ thể (ngoài tầm dự báo,
  // dự báo kém tin cậy...) — lý do đầy đủ nằm ở tooltip của dòng.
  NONE: 'Chưa đủ điều kiện',
}

const formatVnd = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value) || 0))} đ`

const formatSignedVnd = (value) => {
  const amount = Math.round(Number(value) || 0)
  return `${amount > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN').format(amount)} đ`
}

const formatPercent = (value) => {
  const percent = Number(value) || 0
  return `${percent > 0 ? '+' : ''}${percent}%`
}

const formatDayLabel = (dateKey) => {
  const [year, month, day] = String(dateKey).split('-')
  return `${day}/${month}/${String(year).slice(2)}`
}

function PartnerDynamicPricingPage() {
  const [attractions, setAttractions] = useState([])
  const [attractionId, setAttractionId] = useState('')
  const [form, setForm] = useState(null)
  const [preview, setPreview] = useState(null)
  const [impact, setImpact] = useState(null)
  const [loading, setLoading] = useState(true)
  // Điểm tham quan mà dữ liệu bên phải đang thuộc về. Lệch với lựa chọn hiện
  // tại nghĩa là đang tải — không cần cờ loading riêng.
  const [loadedFor, setLoadedFor] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const loadingDetail = Boolean(attractionId) && loadedFor !== attractionId

  useEffect(() => {
    listAttractions({ limit: 100, status: 'ACTIVE' })
      .then((response) => {
        const rows = getPartnerAttractionRows(response)
        setAttractions(rows)
        setAttractionId(rows[0]?.id || '')
      })
      .catch((error) => toast.error(error.message || 'Không thể tải điểm tham quan.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!attractionId) return undefined
    // Đối tác đổi điểm tham quan liên tục có thể khiến response cũ về sau
    // response mới và ghi đè bảng giá của điểm đang xem.
    let cancelled = false

    Promise.all([
      getPricingPolicy(attractionId),
      getPricingPreview(attractionId, 14),
      getPricingImpact(attractionId, 30),
    ])
      .then(([policyRes, previewRes, impactRes]) => {
        if (cancelled) return
        setForm(policyRes.data)
        setPreview(previewRes.data)
        setImpact(impactRes.data)
      })
      .catch((error) => {
        if (cancelled) return
        setForm(null)
        setPreview(null)
        setImpact(null)
        toast.error(error.message || 'Không thể tải cấu hình giá động.')
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(attractionId)
      })

    return () => {
      cancelled = true
    }
  }, [attractionId, reloadToken])

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  async function save(event) {
    event.preventDefault()
    if (!attractionId || saving || !form) return
    if (Number(form.lowDemandThreshold) >= Number(form.highDemandThreshold)) {
      toast.error('Ngưỡng vắng khách phải nhỏ hơn ngưỡng đông khách.')
      return
    }
    setSaving(true)
    try {
      await updatePricingPolicy(attractionId, {
        enabled: Boolean(form.enabled),
        mode: form.mode,
        highDemandThreshold: Number(form.highDemandThreshold),
        lowDemandThreshold: Number(form.lowDemandThreshold),
        maxSurchargePercent: Number(form.maxSurchargePercent),
        maxDiscountPercent: Number(form.maxDiscountPercent),
        priceFloorPercent: Number(form.priceFloorPercent),
        priceCeilingPercent: Number(form.priceCeilingPercent),
        roundingStep: Number(form.roundingStep),
        lookaheadDays: Number(form.lookaheadDays),
        minConfidence: form.minConfidence,
      })
      toast.success('Đã lưu chính sách giá động.')
      // Tải lại bảng giá xem trước để đối tác thấy ngay hiệu lực của ngưỡng mới.
      setReloadToken((current) => current + 1)
    } catch (error) {
      toast.error(error.message || 'Không thể lưu chính sách giá động.')
    } finally {
      setSaving(false)
    }
  }

  const isSuggestOnly = form?.mode !== 'AUTO_APPLY'
  const autoApplyAllowed = Boolean(form?.autoApplyAllowed)

  return (
    <PartnerLayout pageTitle="Giá động theo dự báo">
      <div className="space-y-6">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#00858a]">
            Partner revenue
          </p>
          <h1 className="mt-1 text-2xl font-black text-[#00474d]">Giá động theo dự báo AI</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            AI ước tính mức lấp đầy của từng ngày và khung giờ, rồi đề xuất phụ thu khi dự báo
            đông và giảm giá khi dự báo vắng. Giá chỉ thực sự thay đổi khi bạn chuyển sang chế độ
            áp dụng tự động, và luôn nằm trong hàng rào sàn/trần do bạn đặt ra.
          </p>
        </header>

        <label className="block max-w-xl text-sm font-bold text-slate-700">
          Điểm tham quan
          <select
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
            disabled={loading || attractions.length === 0}
            value={attractionId}
            onChange={(event) => setAttractionId(event.target.value)}
          >
            {attractions.map((attraction) => (
              <option key={attraction.id} value={attraction.id}>
                {getPartnerAttractionLabel(attraction)}
              </option>
            ))}
          </select>
        </label>

        {!loading && attractions.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            Chưa có điểm tham quan đang hoạt động để cấu hình giá động.
          </div>
        )}

        {form && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <form className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6" onSubmit={save}>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
                <div>
                  <p className="font-bold text-slate-800">Bật giá động</p>
                  <p className="text-xs text-slate-500">Tắt thì mọi vé bán đúng giá niêm yết.</p>
                </div>
                <input
                  aria-label="Bật giá động"
                  checked={Boolean(form.enabled)}
                  className="h-5 w-5"
                  type="checkbox"
                  onChange={(event) => setField('enabled', event.target.checked)}
                />
              </div>

              <label className="block text-sm font-bold text-slate-700">
                Chế độ
                <select
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
                  value={form.mode}
                  onChange={(event) => setField('mode', event.target.value)}
                >
                  <option value="SUGGEST_ONLY">Chỉ đề xuất — xem trước, khách vẫn trả giá niêm yết</option>
                  <option disabled={!autoApplyAllowed} value="AUTO_APPLY">
                    Áp dụng tự động — giá đề xuất là giá khách trả
                  </option>
                </select>
              </label>

              {!autoApplyAllowed && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900" role="status">
                  Chế độ tự áp giá đang bị khóa bởi quản trị vận hành. AI vẫn phân tích và đề xuất,
                  nhưng giá khách thanh toán luôn là giá niêm yết.
                </div>
              )}

              {form.enabled && isSuggestOnly && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs leading-5 text-sky-900">
                  Đang chạy thử: bảng bên phải là mức giá AI sẽ áp nếu bạn bật &ldquo;Áp dụng tự động&rdquo;.
                  Hãy đối chiếu vài ngày trước khi giao quyền quyết định giá cho mô hình.
                </div>
              )}

              <fieldset className="space-y-4">
                <legend className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Ngưỡng nhận diện nhu cầu
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <PercentField
                    label="Đông khách khi lấp đầy ≥"
                    value={Math.round(Number(form.highDemandThreshold) * 100)}
                    min={5}
                    max={100}
                    onChange={(value) => setField('highDemandThreshold', Number(value) / 100)}
                  />
                  <PercentField
                    label="Vắng khách khi lấp đầy ≤"
                    value={Math.round(Number(form.lowDemandThreshold) * 100)}
                    min={0}
                    max={95}
                    onChange={(value) => setField('lowDemandThreshold', Number(value) / 100)}
                  />
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Biên điều chỉnh &amp; hàng rào an toàn
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <PercentField
                    label="Phụ thu tối đa"
                    value={form.maxSurchargePercent}
                    min={0}
                    max={100}
                    onChange={(value) => setField('maxSurchargePercent', value)}
                  />
                  <PercentField
                    label="Giảm giá tối đa"
                    value={form.maxDiscountPercent}
                    min={0}
                    max={100}
                    onChange={(value) => setField('maxDiscountPercent', value)}
                  />
                  <PercentField
                    label="Giá sàn (% giá niêm yết)"
                    value={form.priceFloorPercent}
                    min={1}
                    max={100}
                    onChange={(value) => setField('priceFloorPercent', value)}
                  />
                  <PercentField
                    label="Giá trần (% giá niêm yết)"
                    value={form.priceCeilingPercent}
                    min={100}
                    max={300}
                    onChange={(value) => setField('priceCeilingPercent', value)}
                  />
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Làm tròn giá về bội số (đ)"
                  value={form.roundingStep}
                  min={1}
                  max={1000000}
                  onChange={(value) => setField('roundingStep', value)}
                />
                <NumberField
                  label="Chỉ áp cho ngày trong vòng (ngày)"
                  value={form.lookaheadDays}
                  min={1}
                  max={60}
                  onChange={(value) => setField('lookaheadDays', value)}
                />
              </div>

              <label className="block text-sm font-bold text-slate-700">
                Độ tin cậy tối thiểu của dự báo
                <select
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
                  value={form.minConfidence}
                  onChange={(event) => setField('minConfidence', event.target.value)}
                >
                  <option value="LOW">Thấp — chấp nhận cả baseline thống kê</option>
                  <option value="MEDIUM">Trung bình — chỉ dùng model AI</option>
                  <option value="HIGH">Cao — chỉ dùng model AI có nền dữ liệu dày</option>
                </select>
                <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">
                  Dưới ngưỡng này AI đứng yên và vé bán đúng giá niêm yết.
                </span>
              </label>

              <button
                className="w-full rounded-xl bg-[#006b72] px-5 py-3 text-sm font-black text-white disabled:opacity-60"
                disabled={saving || loadingDetail}
                type="submit"
              >
                {saving ? 'Đang lưu...' : 'Lưu chính sách giá'}
              </button>
            </form>

            <div className="space-y-6">
              <ImpactPanel impact={impact} />
              <PreviewPanel preview={preview} loading={loadingDetail} />
            </div>
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}

function ImpactPanel({ impact }) {
  const summary = impact?.summary
  if (!summary) return null

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
        Tác động thực tế ({summary.days} ngày gần nhất)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Kỳ tính theo lúc hệ thống ghi nhận quyết định đổi giá (lượt giữ chỗ);
        chỉ cộng doanh thu của lượt đã thanh toán thành công và chưa bị hủy hoặc hoàn tiền.
        Đây không phải báo cáo dòng tiền theo ngày ngân hàng ghi nhận thanh toán.
      </p>
      {summary.totalAdjustments === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Chưa có lượt đặt vé nào đã thanh toán bị điều chỉnh giá. Số liệu sẽ xuất hiện sau khi bật
          chế độ áp dụng tự động và có khách đặt vé thành công.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Lượt đổi giá" value={summary.totalAdjustments} />
            <StatTile label="Vé bị ảnh hưởng" value={summary.adjustedTickets} />
            <StatTile
              label="Thu thêm giờ cao điểm"
              value={formatVnd(summary.surchargeRevenue)}
              tone="up"
            />
            <StatTile
              label="Giảm giá kích cầu"
              value={formatVnd(summary.discountGiven)}
              tone="down"
            />
          </div>
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-700">
            Chênh lệch doanh thu ròng:{' '}
            <span className={summary.netRevenueDelta >= 0 ? 'text-[#006068]' : 'text-[#ba1a1a]'}>
              {formatSignedVnd(summary.netRevenueDelta)}
            </span>
            <span className="ml-2 font-normal text-slate-500">
              ({summary.peakCount} lượt cao điểm / {summary.quietCount} lượt giờ vắng)
            </span>
          </p>
          {summary.pendingAdjustments > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Ngoài ra có {summary.pendingAdjustments} lượt đã đổi giá nhưng chưa thành tiền (đang
              giữ chỗ, hết hạn, hủy hoặc đã hoàn) — không được cộng vào các con số trên.
            </p>
          )}
          {impact.detailTruncated && (
            <p className="mt-2 text-xs text-slate-500">
              Bảng chi tiết bên dưới chỉ hiển thị {impact.detailLimit} lượt gần nhất. Các con số
              tổng ở trên đã tính trọn kỳ.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function StatTile({ label, value, tone }) {
  const toneClass =
    tone === 'up' ? 'text-[#006068]' : tone === 'down' ? 'text-[#ba1a1a]' : 'text-slate-800'
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-black ${toneClass}`}>{value}</p>
    </div>
  )
}

function PreviewPanel({ preview, loading }) {
  if (loading) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      </section>
    )
  }
  if (!preview) return null

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          {preview.live ? 'Giá đang áp dụng — 14 ngày tới' : 'Giá AI đề xuất — 14 ngày tới'}
        </h2>
        <span className="text-xs font-semibold text-slate-500">
          {preview.forecastDays > 0
            ? `Có dự báo AI cho ${preview.forecastDays} ngày`
            : 'Chưa có dự báo AI cho khoảng này'}
        </span>
      </div>

      {!preview.live && (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          Bảng dưới là mức giá AI sẽ áp nếu bạn bật giá động ở chế độ áp dụng tự động. Hiện khách
          vẫn đang trả đúng giá niêm yết.
        </p>
      )}

      {preview.products.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">Điểm tham quan chưa có gói vé đang mở bán.</p>
      )}

      {preview.products.map((product) => (
        <div className="mt-5" key={product.ticketProductId}>
          <p className="text-sm font-bold text-slate-800">
            {product.name}
            <span className="ml-2 font-normal text-slate-500">
              niêm yết {formatVnd(product.listedPrice)}
            </span>
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-bold">Ngày</th>
                  <th className="py-2 pr-3 font-bold">Nhu cầu</th>
                  <th className="py-2 pr-3 font-bold">Lấp đầy dự kiến</th>
                  <th className="py-2 pr-3 font-bold">Tín hiệu</th>
                  <th className="py-2 pr-3 font-bold">Điều chỉnh</th>
                  <th className="py-2 font-bold">Giá</th>
                </tr>
              </thead>
              <tbody>
                {product.days.map((day) => {
                  if (day.closed) {
                    return (
                      <tr className="border-b border-slate-100 text-slate-400" key={day.date}>
                        <td className="py-2 pr-3 font-semibold">{formatDayLabel(day.date)}</td>
                        <td className="py-2" colSpan={5}>
                          Đóng cửa
                        </td>
                      </tr>
                    )
                  }
                  const meta = DEMAND_META[day.demandLevel] || DEMAND_META.NORMAL
                  return (
                    <tr className="border-b border-slate-100" key={day.date} title={day.reason}>
                      <td className="py-2 pr-3 font-semibold text-slate-700">
                        {formatDayLabel(day.date)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${meta.chip}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {Math.round(Number(day.demandIndex) * 100)}%
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {SIGNAL_LABEL[day.signalSource] || '—'}
                        <span className="ml-1 text-slate-400">
                          (tin cậy {CONFIDENCE_LABEL[day.confidence] || '—'})
                        </span>
                      </td>
                      <td
                        className={`py-2 pr-3 font-bold ${
                          day.adjustmentPercent > 0
                            ? 'text-[#ba1a1a]'
                            : day.adjustmentPercent < 0
                              ? 'text-[#006068]'
                              : 'text-slate-400'
                        }`}
                      >
                        {formatPercent(day.adjustmentPercent)}
                      </td>
                      <td className="py-2 font-semibold text-slate-800">
                        {day.minPrice === day.maxPrice
                          ? formatVnd(day.minPrice)
                          : `${formatVnd(day.minPrice)} – ${formatVnd(day.maxPrice)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  )
}

function NumberField({ label, value, min, max, onChange }) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <input
        className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
        max={max}
        min={min}
        type="number"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function PercentField({ label, value, min, max, onChange }) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <div className="mt-2 flex items-center gap-2">
        <input
          className="w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
          max={max}
          min={min}
          type="number"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-sm font-bold text-slate-500">%</span>
      </div>
    </label>
  )
}

export default PartnerDynamicPricingPage
