import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import {
  getKycChangeRequests,
  reviewKycChangeRequest,
} from '../../services/adminApi.js'

const FIELDS = [
  ['businessName', 'Tên pháp lý doanh nghiệp'],
  ['taxCode', 'Mã số thuế'],
  ['registrationDate', 'Ngày đăng ký kinh doanh'],
  ['representativeName', 'Người đại diện'],
  ['representativePhone', 'Số điện thoại đại diện'],
  ['businessAddress', 'Địa chỉ trụ sở'],
  ['bankName', 'Ngân hàng'],
  ['branchName', 'Chi nhánh'],
  ['bankAccountNumber', 'Số tài khoản'],
  ['bankAccountName', 'Chủ tài khoản'],
  ['swiftCode', 'SWIFT/BIC'],
  ['payoutCurrency', 'Tiền tệ chi trả'],
  ['businessLicenseUrl', 'Tài liệu pháp lý'],
]

const STATUS_META = {
  PENDING: { label: 'Chờ kiểm tra', className: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Đã duyệt', className: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Đã từ chối', className: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Partner đã hủy', className: 'bg-slate-100 text-slate-700' },
}

function normalizeValue(field, value) {
  if (value == null || value === '') return ''
  if (field === 'registrationDate') return new Date(value).toISOString().slice(0, 10)
  return String(value)
}

function maskAccount(value) {
  const text = String(value || '')
  return text ? `${'•'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}` : '—'
}

function Value({ field, value, revealSensitive }) {
  if (field === 'businessLicenseUrl') {
    return value ? (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-[#006068] underline"
      >
        Mở tài liệu trong tab mới
      </a>
    ) : '—'
  }
  if (field === 'bankAccountNumber' && !revealSensitive) return maskAccount(value)
  return normalizeValue(field, value) || '—'
}

export default function KycChangeRequestsPage() {
  const [requests, setRequests] = useState([])
  const [status, setStatus] = useState('PENDING')
  const [loading, setLoading] = useState(true)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const [revealSensitive, setRevealSensitive] = useState(false)
  const [rejecting, setRejecting] = useState(null)
  const [reviewNote, setReviewNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Duyệt thay đổi KYC | VietTicket Admin'
    let active = true
    getKycChangeRequests(status)
      .then((response) => {
        if (active) setRequests(response.data || [])
      })
      .catch((error) => {
        if (active) {
          setRequests([])
          toast.error(error.message || 'Không thể tải yêu cầu thay đổi KYC.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshIndex, status])

  const pendingCount = useMemo(
    () => requests.filter((request) => request.status === 'PENDING').length,
    [requests],
  )

  function reload() {
    setLoading(true)
    setRefreshIndex((current) => current + 1)
  }

  async function approve(request) {
    const changedCount = FIELDS.filter(([field]) => (
      normalizeValue(field, request.partner?.[field])
      !== normalizeValue(field, request.proposedData?.[field])
    )).length
    const confirmed = window.confirm(
      `Xác nhận đã đối chiếu tài liệu và duyệt ${changedCount} trường thay đổi cho ${request.partner?.businessName || request.requestedBy?.email}?`,
    )
    if (!confirmed) return
    setSubmitting(true)
    try {
      const response = await reviewKycChangeRequest(request.id, 'APPROVED')
      toast.success(response.message)
      setExpandedId(null)
      reload()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function reject(event) {
    event.preventDefault()
    if (!rejecting || submitting) return
    if (reviewNote.trim().length < 10) {
      toast.error('Lý do từ chối phải có ít nhất 10 ký tự và nêu rõ cách khắc phục.')
      return
    }
    setSubmitting(true)
    try {
      const response = await reviewKycChangeRequest(
        rejecting.id,
        'REJECTED',
        reviewNote.trim(),
      )
      toast.success(response.message)
      setRejecting(null)
      setReviewNote('')
      setExpandedId(null)
      reload()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <div>
          <h2>Duyệt thay đổi hồ sơ KYC</h2>
          <p>
            Maker–checker: Partner chỉ đề xuất; Admin đối chiếu tài liệu trước khi dữ liệu mới có hiệu lực.
            Mọi quyết định đều được ghi audit log.
          </p>
        </div>
        <select
          value={status}
          onChange={(event) => {
            setLoading(true)
            setStatus(event.target.value)
            setExpandedId(null)
            setRevealSensitive(false)
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          aria-label="Lọc trạng thái yêu cầu"
        >
          <option value="PENDING">Đang chờ duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Đã từ chối</option>
          <option value="CANCELLED">Partner đã hủy</option>
          <option value="ALL">Tất cả</option>
        </select>
      </div>

      <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Có <strong>{pendingCount}</strong> yêu cầu trong danh sách hiện tại. Không duyệt nếu chưa xác minh
        giấy phép, mã số thuế, chủ tài khoản và thẩm quyền của người yêu cầu.
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">
          Đang tải yêu cầu…
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">
          Không có yêu cầu phù hợp.
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => {
            const expanded = expandedId === request.id
            const meta = STATUS_META[request.status] || STATUS_META.CANCELLED
            const changedFields = FIELDS.filter(([field]) => (
              normalizeValue(field, request.partner?.[field])
              !== normalizeValue(field, request.proposedData?.[field])
            ))
            return (
              <article key={request.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">
                        {request.partner?.businessName || 'Đối tác'}
                      </h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Người gửi: {request.requestedBy?.fullName || '—'} · {request.requestedBy?.email || '—'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {new Date(request.createdAt).toLocaleString('vi-VN')} · {changedFields.length} trường thay đổi
                    </p>
                    <p className="mt-2 text-sm"><strong>Lý do:</strong> {request.reason}</p>
                    {request.reviewNote && (
                      <p className="mt-1 text-sm"><strong>Ghi chú duyệt:</strong> {request.reviewNote}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(expanded ? null : request.id)
                      setRevealSensitive(false)
                    }}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
                  >
                    {expanded ? 'Thu gọn' : 'Đối chiếu chi tiết'}
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-slate-200 p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-slate-600">
                        Chỉ các hàng có thay đổi được hiển thị. Giá trị hiện tại vẫn là dữ liệu đang vận hành.
                      </p>
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={revealSensitive}
                          onChange={(event) => setRevealSensitive(event.target.checked)}
                        />
                        Hiện đầy đủ số tài khoản
                      </label>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                          <tr>
                            <th className="px-4 py-3">Trường</th>
                            <th className="px-4 py-3">Đang có hiệu lực</th>
                            <th className="px-4 py-3">Partner đề xuất</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changedFields.map(([field, label]) => (
                            <tr key={field} className="border-t border-slate-200 align-top">
                              <th className="px-4 py-3 font-semibold text-slate-700">{label}</th>
                              <td className="max-w-sm break-words px-4 py-3 text-slate-500">
                                <Value field={field} value={request.partner?.[field]} revealSensitive={revealSensitive} />
                              </td>
                              <td className="max-w-sm break-words bg-emerald-50 px-4 py-3 font-semibold text-emerald-900">
                                <Value field={field} value={request.proposedData?.[field]} revealSensitive={revealSensitive} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {request.status === 'PENDING' && (
                      <div className="mt-5 flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            setRejecting(request)
                            setReviewNote('')
                          }}
                          className="rounded-xl border border-red-300 px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50"
                        >
                          Từ chối và yêu cầu sửa
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => approve(request)}
                          className="rounded-xl bg-[#006068] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Đã đối chiếu — Duyệt áp dụng
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={reject} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold">Từ chối yêu cầu thay đổi KYC</h3>
            <p className="mt-2 text-sm text-slate-600">
              Nêu rõ giấy tờ hoặc trường dữ liệu cần sửa để Partner có thể gửi yêu cầu mới.
            </p>
            <textarea
              autoFocus
              rows="5"
              maxLength="1000"
              required
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              placeholder="Ví dụ: Tên chủ tài khoản chưa khớp với giấy xác nhận của ngân hàng…"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setRejecting(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? 'Đang xử lý…' : 'Xác nhận từ chối'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  )
}
