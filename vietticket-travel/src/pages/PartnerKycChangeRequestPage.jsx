import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import {
  cancelKycChangeRequest,
  createKycChangeRequest,
  getMyPartner,
  listKycChangeRequests,
  uploadKycDocument,
} from '../services/partnerApi.js'

const TEXT_FIELDS = [
  { name: 'businessName', label: 'Tên pháp lý doanh nghiệp', maxLength: 150 },
  { name: 'taxCode', label: 'Mã số thuế', inputMode: 'numeric', maxLength: 13 },
  { name: 'registrationDate', label: 'Ngày đăng ký kinh doanh', type: 'date' },
  { name: 'representativeName', label: 'Người đại diện pháp luật', maxLength: 150 },
  { name: 'representativePhone', label: 'Số điện thoại người đại diện', inputMode: 'tel', maxLength: 10 },
  { name: 'businessAddress', label: 'Địa chỉ trụ sở', maxLength: 500, wide: true },
  { name: 'bankName', label: 'Ngân hàng thụ hưởng', maxLength: 150 },
  { name: 'branchName', label: 'Chi nhánh ngân hàng', maxLength: 150 },
  { name: 'bankAccountNumber', label: 'Số tài khoản', inputMode: 'numeric', maxLength: 20 },
  { name: 'bankAccountName', label: 'Tên chủ tài khoản', maxLength: 150 },
  { name: 'swiftCode', label: 'SWIFT/BIC (nếu có)', maxLength: 11 },
]

const FIELD_LABELS = Object.fromEntries([
  ...TEXT_FIELDS.map(({ name, label }) => [name, label]),
  ['payoutCurrency', 'Tiền tệ chi trả'],
  ['businessLicenseUrl', 'Tài liệu pháp lý'],
])

const STATUS_META = {
  PENDING: { label: 'Đang chờ duyệt', className: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Đã duyệt', className: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Đã từ chối', className: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Đã hủy', className: 'bg-slate-100 text-slate-700' },
}

const EMPTY_FORM = {
  businessName: '',
  businessLicenseUrl: '',
  taxCode: '',
  registrationDate: '',
  representativeName: '',
  representativePhone: '',
  businessAddress: '',
  bankName: '',
  branchName: '',
  bankAccountNumber: '',
  bankAccountName: '',
  swiftCode: '',
  payoutCurrency: 'VND',
}

function normalizeProfile(profile = {}) {
  return Object.fromEntries(
    Object.keys(EMPTY_FORM).map((key) => [
      key,
      key === 'registrationDate'
        ? String(profile[key] || '').slice(0, 10)
        : String(profile[key] || ''),
    ]),
  )
}

function maskValue(field, value) {
  if (!value) return '—'
  if (field === 'bankAccountNumber') {
    const text = String(value)
    return `${'•'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`
  }
  if (field === 'businessLicenseUrl') return 'Tài liệu pháp lý đã tải lên'
  return String(value)
}

export default function PartnerKycChangeRequestPage() {
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [requests, setRequests] = useState([])
  const [reason, setReason] = useState('')
  const [confirmedAccurate, setConfirmedAccurate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)

  const pendingRequest = requests.find((request) => request.status === 'PENDING')
  const changedFields = useMemo(() => {
    if (!profile) return []
    const current = normalizeProfile(profile)
    return Object.keys(EMPTY_FORM).filter((field) => current[field] !== String(form[field] || ''))
  }, [form, profile])

  async function loadPage() {
    try {
      const [profileResponse, requestResponse] = await Promise.all([
        getMyPartner(),
        listKycChangeRequests(),
      ])
      const currentProfile = profileResponse.partner || profileResponse.data
      setProfile(currentProfile)
      setForm(normalizeProfile(currentProfile))
      setRequests(requestResponse.data || [])
    } catch (error) {
      toast.error(error.message || 'Không thể tải hồ sơ KYC.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    document.title = 'Yêu cầu thay đổi KYC | VietTicket Partner'
    const timeoutId = window.setTimeout(() => {
      loadPage()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  async function handleDocumentUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast.error('Chỉ nhận PDF/JPG/PNG, tối đa 10 MB.')
      return
    }
    setUploading(true)
    try {
      const url = await uploadKycDocument(file)
      setForm((current) => ({ ...current, businessLicenseUrl: url }))
      toast.success('Đã tải tài liệu mới. Tài liệu chỉ được áp dụng sau khi Admin duyệt.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting || pendingRequest) return
    if (changedFields.length === 0) {
      toast.info('Bạn chưa thay đổi thông tin nào.')
      return
    }
    if (reason.trim().length < 10) {
      toast.error('Lý do thay đổi phải có ít nhất 10 ký tự.')
      return
    }
    if (!confirmedAccurate) {
      toast.error('Bạn cần xác nhận tính chính xác của thông tin.')
      return
    }
    setSubmitting(true)
    try {
      const response = await createKycChangeRequest({
        ...form,
        reason: reason.trim(),
        confirmedAccurate: true,
      })
      toast.success(response.message)
      setReason('')
      setConfirmedAccurate(false)
      await loadPage()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(request) {
    if (!window.confirm('Hủy yêu cầu đang chờ duyệt? Hồ sơ hiện tại vẫn giữ nguyên.')) return
    setSubmitting(true)
    try {
      const response = await cancelKycChangeRequest(request.id)
      toast.success(response.message)
      await loadPage()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PartnerLayout pageTitle="Thay đổi hồ sơ KYC">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-2xl border border-[#d8e2e4] bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-[#191c1d]">Yêu cầu thay đổi hồ sơ KYC</h1>
          <p className="mt-2 text-sm leading-6 text-[#5f696b]">
            Hồ sơ đang hoạt động không bị sửa trực tiếp. Một quản trị viên độc lập sẽ đối chiếu,
            duyệt và lưu vết trước khi thông tin pháp lý hoặc tài khoản nhận tiền mới có hiệu lực.
          </p>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Trong lúc chờ duyệt, VietTicket tiếp tục dùng hồ sơ và tài khoản ngân hàng hiện tại để vận hành và đối soát.
          </div>
        </section>

        {loading ? (
          <section className="rounded-2xl border border-[#d8e2e4] bg-white p-10 text-center text-[#5f696b]">
            Đang tải hồ sơ…
          </section>
        ) : pendingRequest ? (
          <section className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Đang chờ duyệt</span>
                <h2 className="mt-3 text-xl font-bold">Yêu cầu gửi ngày {new Date(pendingRequest.createdAt).toLocaleDateString('vi-VN')}</h2>
                <p className="mt-1 text-sm text-[#5f696b]">Lý do: {pendingRequest.reason}</p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleCancel(pendingRequest)}
                className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                Hủy yêu cầu
              </button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {Object.entries(pendingRequest.proposedData || {})
                .filter(([field, value]) => normalizeProfile(profile)[field] !== String(value || ''))
                .map(([field, value]) => (
                  <div key={field} className="rounded-xl bg-[#f6f8f9] p-4">
                    <p className="text-xs font-semibold uppercase text-[#687274]">{FIELD_LABELS[field] || field}</p>
                    <p className="mt-1 text-sm line-through opacity-60">{maskValue(field, profile?.[field])}</p>
                    <p className="mt-1 text-sm font-bold text-[#006068]">{maskValue(field, value)}</p>
                  </div>
                ))}
            </div>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-[#d8e2e4] bg-white p-6 shadow-sm">
            <div className="grid gap-5 md:grid-cols-2">
              {TEXT_FIELDS.map((field) => (
                <label key={field.name} className={field.wide ? 'md:col-span-2' : ''}>
                  <span className="mb-1.5 block text-sm font-semibold text-[#283234]">{field.label}</span>
                  <input
                    type={field.type || 'text'}
                    inputMode={field.inputMode}
                    maxLength={field.maxLength}
                    value={form[field.name]}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))}
                    required={field.name !== 'swiftCode'}
                    className="w-full rounded-xl border border-[#bec8ca] bg-white px-3.5 py-3 text-sm outline-none focus:border-[#006068] focus:ring-2 focus:ring-[#b8e9eb]"
                  />
                </label>
              ))}
              <label>
                <span className="mb-1.5 block text-sm font-semibold text-[#283234]">Tiền tệ chi trả</span>
                <select
                  value={form.payoutCurrency}
                  onChange={(event) => setForm((current) => ({ ...current, payoutCurrency: event.target.value }))}
                  className="w-full rounded-xl border border-[#bec8ca] bg-white px-3.5 py-3 text-sm"
                >
                  {['VND', 'USD', 'EUR', 'SGD', 'THB'].map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-[#283234]">Tài liệu pháp lý</span>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#7b898b] px-4 py-3 text-sm font-semibold text-[#00474d]">
                  <span className="material-symbols-outlined text-[19px]">upload_file</span>
                  {uploading ? 'Đang tải…' : 'Tải tài liệu thay thế'}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    disabled={uploading}
                    onChange={handleDocumentUpload}
                    className="sr-only"
                  />
                </label>
                <p className="mt-1 text-xs text-[#687274]">
                  {form.businessLicenseUrl === profile?.businessLicenseUrl
                    ? 'Đang giữ tài liệu đã được duyệt.'
                    : 'Đã chọn tài liệu mới; chỉ áp dụng sau khi được duyệt.'}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-[#f6f8f9] p-4">
              <p className="text-sm font-bold">Các trường sẽ gửi duyệt ({changedFields.length})</p>
              <p className="mt-1 text-sm text-[#5f696b]">
                {changedFields.length > 0
                  ? changedFields.map((field) => FIELD_LABELS[field] || field).join(' · ')
                  : 'Chưa có thay đổi.'}
              </p>
            </div>

            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-semibold">Lý do thay đổi</span>
              <textarea
                rows="4"
                maxLength="1000"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ví dụ: Doanh nghiệp đã thay đổi tài khoản nhận thanh toán theo biên bản ngày…"
                className="w-full rounded-xl border border-[#bec8ca] px-3.5 py-3 text-sm outline-none focus:border-[#006068] focus:ring-2 focus:ring-[#b8e9eb]"
              />
              <span className="text-xs text-[#687274]">{reason.length}/1000</span>
            </label>

            <label className="mt-5 flex items-start gap-3 rounded-xl border border-[#d8e2e4] p-4 text-sm">
              <input
                type="checkbox"
                checked={confirmedAccurate}
                onChange={(event) => setConfirmedAccurate(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                Tôi xác nhận thông tin và tài liệu cung cấp là chính xác, có thẩm quyền yêu cầu thay đổi
                và hiểu rằng dữ liệu hiện tại vẫn có hiệu lực cho đến khi Admin duyệt.
              </span>
            </label>

            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={submitting || uploading || changedFields.length === 0}
                className="rounded-xl bg-[#006068] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Đang gửi…' : 'Gửi yêu cầu xác minh'}
              </button>
            </div>
          </form>
        )}

        {requests.length > 0 && (
          <section className="rounded-2xl border border-[#d8e2e4] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">Lịch sử yêu cầu</h2>
            <div className="mt-4 space-y-3">
              {requests.map((request) => {
                const meta = STATUS_META[request.status] || STATUS_META.CANCELLED
                return (
                  <article key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e1e7e8] p-4">
                    <div>
                      <p className="font-semibold">{request.reason}</p>
                      <p className="mt-1 text-xs text-[#687274]">
                        {new Date(request.createdAt).toLocaleString('vi-VN')}
                        {request.reviewNote ? ` · Phản hồi: ${request.reviewNote}` : ''}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.className}`}>{meta.label}</span>
                  </article>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </PartnerLayout>
  )
}
