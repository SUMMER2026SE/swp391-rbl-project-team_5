/**
 * PartnerTicketFormPage — dùng cho cả Add và Edit gói vé.
 * Route Add:  /partner/attractions/:id/tickets/new
 * Route Edit: /partner/attractions/:id/tickets/:ticketId/edit
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

const TICKET_TYPES = [
  { value: 'ADULT',  label: 'Người lớn',  icon: 'person',        desc: 'Khách từ 12 tuổi trở lên' },
  { value: 'CHILD',  label: 'Trẻ em',     icon: 'child_care',    desc: 'Trẻ em từ 3 – 11 tuổi' },
  { value: 'FAMILY', label: 'Gia đình',   icon: 'family_restroom', desc: '2 người lớn + 2 trẻ em' },
  { value: 'GROUP',  label: 'Nhóm',       icon: 'groups',        desc: 'Từ 10 người trở lên' },
]

const REFUND_POLICIES = [
  { value: 'NONE',    label: 'Không hoàn tiền',         desc: 'Không hỗ trợ hoàn tiền trong bất kỳ trường hợp nào.', color: 'border-[#ba1a1a] bg-[#ffdad6]/30 text-[#ba1a1a]' },
  { value: 'PARTIAL', label: 'Hoàn tiền một phần',       desc: 'Hoàn 50% giá vé nếu huỷ trước 24 giờ.', color: 'border-[#725000] bg-[#ffdea8]/30 text-[#725000]' },
  { value: 'FULL',    label: 'Hoàn tiền toàn bộ',        desc: 'Hoàn 100% giá vé nếu huỷ trước 48 giờ.', color: 'border-[#137333] bg-[#E6F4EA]/30 text-[#137333]' },
]

// Mock existing ticket data for edit mode
const MOCK_TICKET = {
  name: 'Vé người lớn', type: 'ADULT', originalPrice: 900000, sellingPrice: 850000,
  description: 'Bao gồm toàn bộ trải nghiệm tại khu vui chơi.', refundPolicy: 'PARTIAL', status: 'active',
}

const MOCK_ATTRACTION_NAMES = { 1: 'Sun World Ba Na Hills', 2: 'Vịnh Hạ Long Cruise', 3: 'VinWonders Nha Trang', 4: 'Hội An Lantern Festival Tour' }

function PartnerTicketFormPage() {
  const { id, ticketId } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(ticketId)

  const [attractionName, setAttractionName] = useState('')
  const [isLoading, setIsLoading] = useState(isEdit)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [touched, setTouched] = useState({})

  const [form, setForm] = useState({
    name: '', type: 'ADULT', originalPrice: '', sellingPrice: '',
    description: '', refundPolicy: 'PARTIAL', status: 'active',
  })

  useEffect(() => {
    document.title = `${isEdit ? 'Chỉnh sửa' : 'Thêm'} gói vé | VietTicket B2B`
    setAttractionName(MOCK_ATTRACTION_NAMES[Number(id)] || 'Điểm tham quan')
    if (!isEdit) return
    let active = true
    setIsLoading(true)
    ;(async () => {
      try {
        const data = await partnerApi.getTicket(ticketId)
        if (!active) return
        const t = data.ticket
        setForm({
          name: t.name ?? '',
          type: t.type ?? 'ADULT',
          originalPrice: t.originalPrice ?? '',
          sellingPrice: t.sellingPrice ?? '',
          description: t.description ?? '',
          refundPolicy: t.refundPolicy ?? 'PARTIAL',
          status: t.status ?? 'active',
        })
      } catch (err) {
        if (!active) return
        if (partnerApi.isNetworkError(err)) {
          // Fallback demo khi không có server
          setForm({ ...MOCK_TICKET })
        } else {
          toast.error(err.message)
        }
      } finally {
        if (active) setIsLoading(false)
      }
    })()
    return () => { active = false }
  }, [id, ticketId])

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))
  const touch = (field) => setTouched((prev) => ({ ...prev, [field]: true }))

  // Validation
  const errors = {
    name: !form.name.trim() ? 'Tên gói vé không được để trống.' : '',
    originalPrice: !form.originalPrice || Number(form.originalPrice) <= 0 ? 'Giá gốc phải lớn hơn 0.' : '',
    sellingPrice: !form.sellingPrice || Number(form.sellingPrice) <= 0
      ? 'Giá bán phải lớn hơn 0.'
      : Number(form.sellingPrice) > Number(form.originalPrice)
        ? 'Giá bán không được vượt quá giá gốc.'
        : '',
  }
  const isValid = Object.values(errors).every((e) => !e)

  const discount = form.originalPrice && form.sellingPrice && Number(form.originalPrice) > 0
    ? Math.round((1 - Number(form.sellingPrice) / Number(form.originalPrice)) * 100)
    : 0

  const handleSubmit = async () => {
    setTouched({ name: true, originalPrice: true, sellingPrice: true })
    if (!isValid) { toast.error('Vui lòng kiểm tra lại thông tin.'); return }
    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      originalPrice: Number(form.originalPrice),
      sellingPrice: Number(form.sellingPrice),
      refundPolicy: form.refundPolicy,
      status: form.status,
    }
    setIsSubmitting(true)
    try {
      if (isEdit) await partnerApi.updateTicket(ticketId, payload)
      else await partnerApi.createTicket(id, payload)
      toast.success(isEdit ? 'Đã cập nhật gói vé thành công!' : 'Đã tạo gói vé thành công!')
      navigate(`/partner/attractions/${id}/tickets`)
    } catch (err) {
      if (partnerApi.isNetworkError(err)) {
        toast.info('Chế độ demo (không có server) — thao tác được mô phỏng.')
        navigate(`/partner/attractions/${id}/tickets`)
      } else {
        toast.error(err.message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) return (
    <PartnerLayout pageTitle="Ticket Form">
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
      </div>
    </PartnerLayout>
  )

  return (
    <PartnerLayout pageTitle={isEdit ? 'Edit Ticket' : 'Add Ticket'}>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 -mt-2 mb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/partner/attractions/${id}/tickets`)} className="p-2 rounded-full hover:bg-[#eceeef] transition-colors text-[#3f484a]">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h2 className="text-2xl font-semibold text-[#191c1d]">{isEdit ? 'Chỉnh sửa gói vé' : 'Thêm gói vé mới'}</h2>
            <p className="text-sm text-[#3f484a] mt-0.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">local_activity</span>{attractionName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/partner/attractions/${id}/tickets`)} className="px-5 py-2.5 rounded-lg border border-[#6f797a] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors">Hủy</button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2">
            {isSubmitting && <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>}
            {isEdit ? 'Lưu thay đổi' : 'Tạo gói vé'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Basic Info */}
          <FormCard title="Thông tin cơ bản" icon="info">
            <div className="space-y-5">
              <FormField label="Tên gói vé" required error={touched.name && errors.name}>
                <input
                  type="text" value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  onBlur={() => touch('name')}
                  placeholder="VD: Vé người lớn cuối tuần"
                  className={inputCls(touched.name && errors.name)}
                />
              </FormField>
              <FormField label="Mô tả gói vé">
                <textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={3}
                  placeholder="Mô tả những gì bao gồm trong gói vé..."
                  className={`${inputCls(false)} resize-none`}
                />
              </FormField>
            </div>
          </FormCard>

          {/* Ticket Type */}
          <FormCard title="Loại vé" icon="sell">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TICKET_TYPES.map((t) => (
                <button
                  key={t.value} type="button"
                  onClick={() => update('type', t.value)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center ${
                    form.type === t.value
                      ? 'border-[#00474d] bg-[#00474d]/5'
                      : 'border-[#e1e3e4] hover:border-[#bec8ca] bg-white'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[28px] ${form.type === t.value ? 'text-[#00474d]' : 'text-[#6f797a]'}`}>{t.icon}</span>
                  <span className={`text-xs font-semibold ${form.type === t.value ? 'text-[#00474d]' : 'text-[#191c1d]'}`}>{t.label}</span>
                  <span className="text-[10px] text-[#6f797a] leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </FormCard>

          {/* Pricing */}
          <FormCard title="Cấu hình giá" icon="payments">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FormField label="Giá gốc (VND)" required error={touched.originalPrice && errors.originalPrice}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#6f797a]">₫</span>
                  <input
                    type="number" min="0" value={form.originalPrice}
                    onChange={(e) => update('originalPrice', e.target.value)}
                    onBlur={() => touch('originalPrice')}
                    placeholder="900000"
                    className={`${inputCls(touched.originalPrice && errors.originalPrice)} pl-7`}
                  />
                </div>
                {form.originalPrice > 0 && (
                  <p className="text-xs text-[#3f484a] mt-1">{formatVND(Number(form.originalPrice))}</p>
                )}
              </FormField>

              <FormField label="Giá bán (VND)" required error={touched.sellingPrice && errors.sellingPrice}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#6f797a]">₫</span>
                  <input
                    type="number" min="0" value={form.sellingPrice}
                    onChange={(e) => update('sellingPrice', e.target.value)}
                    onBlur={() => touch('sellingPrice')}
                    placeholder="850000"
                    className={`${inputCls(touched.sellingPrice && errors.sellingPrice)} pl-7`}
                  />
                </div>
                {form.sellingPrice > 0 && (
                  <p className="text-xs text-[#3f484a] mt-1">{formatVND(Number(form.sellingPrice))}</p>
                )}
              </FormField>
            </div>

            {/* Discount preview */}
            {discount > 0 && (
              <div className="mt-4 p-3 bg-[#E6F4EA] rounded-lg flex items-center gap-3">
                <span className="material-symbols-outlined text-[#137333] text-[20px]">local_offer</span>
                <div>
                  <p className="text-sm font-semibold text-[#137333]">Khách hàng tiết kiệm {discount}%</p>
                  <p className="text-xs text-[#137333]">Giảm {formatVND(Number(form.originalPrice) - Number(form.sellingPrice))} so với giá gốc</p>
                </div>
              </div>
            )}
          </FormCard>

          {/* Refund Policy */}
          <FormCard title="Chính sách hoàn/hủy" icon="policy">
            <div className="flex flex-col gap-3">
              {REFUND_POLICIES.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    form.refundPolicy === p.value ? p.color : 'border-[#e1e3e4] bg-white hover:border-[#bec8ca]'
                  }`}
                >
                  <input type="radio" name="refund" value={p.value} checked={form.refundPolicy === p.value} onChange={() => update('refundPolicy', p.value)} className="mt-0.5 accent-[#00474d]" />
                  <div>
                    <p className="text-sm font-semibold text-[#191c1d]">{p.label}</p>
                    <p className="text-xs text-[#3f484a] mt-0.5">{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </FormCard>
        </div>

        {/* Sidebar Preview */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 flex flex-col gap-4">
            {/* Preview Card */}
            <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
              <p className="text-xs font-semibold text-[#3f484a] uppercase tracking-wider mb-4">Xem trước</p>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#f2f4f5] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#00474d] text-[20px]">confirmation_number</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#191c1d]">{form.name || 'Tên gói vé'}</p>
                  <p className="text-xs text-[#3f484a]">{TICKET_TYPES.find((t) => t.value === form.type)?.label}</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#6f797a]">Giá gốc</span>
                  <span className="line-through text-[#6f797a]">{form.originalPrice ? formatVND(Number(form.originalPrice)) : '—'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#6f797a]">Giá bán</span>
                  <span className="font-bold text-[#00474d]">{form.sellingPrice ? formatVND(Number(form.sellingPrice)) : '—'}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#6f797a]">Giảm giá</span>
                    <span className="font-semibold text-[#ba1a1a]">-{discount}%</span>
                  </div>
                )}
                <div className="pt-2 border-t border-[#f2f4f5] flex justify-between">
                  <span className="text-[#6f797a]">Hoàn/hủy</span>
                  <span className="font-medium text-[#191c1d]">{REFUND_POLICIES.find((p) => p.value === form.refundPolicy)?.label}</span>
                </div>
              </div>
            </div>

            {/* Status Toggle */}
            <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
              <p className="text-xs font-semibold text-[#3f484a] uppercase tracking-wider mb-3">Trạng thái</p>
              <button
                onClick={() => update('status', form.status === 'active' ? 'inactive' : 'active')}
                className={`w-full py-2.5 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${
                  form.status === 'active' ? 'bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]' : 'bg-[#e6e8e9] text-[#3f484a] border-[#bec8ca]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{form.status === 'active' ? 'toggle_on' : 'toggle_off'}</span>
                {form.status === 'active' ? 'Đang hoạt động' : 'Tạm dừng'}
              </button>
              <p className="text-xs text-[#6f797a] mt-2 text-center">
                {form.status === 'active' ? 'Gói vé hiển thị và cho phép đặt chỗ.' : 'Gói vé bị ẩn, không thể đặt chỗ.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </PartnerLayout>
  )
}

/* ── Helpers ── */
function inputCls(hasError) {
  return `w-full rounded-lg border ${hasError ? 'border-[#ba1a1a] focus:ring-[#ba1a1a]' : 'border-[#bec8ca] focus:border-[#00474d] focus:ring-[#00474d]'} bg-white focus:ring-1 px-4 py-3 text-sm text-[#191c1d] placeholder-[#6f797a] outline-none shadow-sm transition-all`
}

function FormCard({ title, icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5 md:p-6">
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#f2f4f5]">
        <span className="material-symbols-outlined text-[20px] text-[#00474d]">{icon}</span>
        <h3 className="text-base font-semibold text-[#191c1d]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function FormField({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#191c1d] mb-1.5">
        {label}{required && <span className="text-[#ba1a1a] ml-1">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-[#ba1a1a]">{error}</p>}
    </div>
  )
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

export default PartnerTicketFormPage
