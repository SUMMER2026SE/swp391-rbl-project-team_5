import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { getPartnerSettlements } from '../services/partnerApi.js'

const STATUS_META = {
  DRAFT: { label: 'Đang đối soát', className: 'bg-slate-100 text-slate-700' },
  APPROVED: { label: 'Chờ chuyển khoản', className: 'bg-amber-100 text-amber-800' },
  PAID: { label: 'Đã chuyển khoản', className: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { label: 'Đã hủy', className: 'bg-red-100 text-red-700' },
}

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
}).format(Number(value || 0))

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC' }).format(new Date(value))
  : '—'

export default function PartnerSettlementsPage() {
  const [settlements, setSettlements] = useState([])
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getPartnerSettlements({ status, page, limit: 20 })
      .then((response) => {
        if (!active) return
        setSettlements(response.data || [])
        setPagination(response.pagination || { page: 1, total: 0, totalPages: 1 })
      })
      .catch((error) => {
        if (!active) return
        setSettlements([])
        toast.error(error.message || 'Không thể tải lịch sử chi trả.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, status])

  return (
    <PartnerLayout pageTitle="Đối soát & chi trả">
      <section className="rounded-2xl border border-[#d8e2e4] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#191c1d]">Lịch sử đối soát</h2>
            <p className="mt-1 text-sm text-[#5f696b]">
              Số tiền được chốt từ booking đã hoàn tất sau khi trừ hoàn tiền và hoa hồng nền tảng.
            </p>
          </div>
          <select
            className="rounded-xl border border-[#bec8ca] bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(event) => {
              setLoading(true)
              setStatus(event.target.value)
              setPage(1)
            }}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="DRAFT">Đang đối soát</option>
            <option value="APPROVED">Chờ chuyển khoản</option>
            <option value="PAID">Đã chuyển khoản</option>
            <option value="CANCELLED">Đã hủy</option>
          </select>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-[#d8e2e4] text-xs uppercase text-[#5f696b]">
              <tr>
                <th className="px-3 py-3">Kỳ đối soát</th>
                <th className="px-3 py-3">Trạng thái</th>
                <th className="px-3 py-3 text-right">Booking</th>
                <th className="px-3 py-3 text-right">Doanh số thuần</th>
                <th className="px-3 py-3 text-right">Hoa hồng</th>
                <th className="px-3 py-3 text-right">Thực nhận</th>
                <th className="px-3 py-3">Chuyển khoản</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="px-3 py-10 text-center text-[#5f696b]">Đang tải dữ liệu...</td></tr>
              ) : settlements.length === 0 ? (
                <tr><td colSpan="7" className="px-3 py-10 text-center text-[#5f696b]">Chưa có kỳ đối soát phù hợp.</td></tr>
              ) : settlements.map((settlement) => {
                const meta = STATUS_META[settlement.status] || STATUS_META.DRAFT
                return (
                  <tr key={settlement.id} className="border-b border-[#edf1f2]">
                    <td className="px-3 py-4 font-semibold">
                      {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)}
                    </td>
                    <td className="px-3 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right">{settlement.bookingCount}</td>
                    <td className="px-3 py-4 text-right">{formatCurrency(settlement.netAmount)}</td>
                    <td className="px-3 py-4 text-right">{formatCurrency(settlement.commissionAmount)}</td>
                    <td className="px-3 py-4 text-right font-bold text-[#006068]">
                      {formatCurrency(settlement.payableAmount)}
                    </td>
                    <td className="px-3 py-4">
                      <div>{settlement.bankNameSnapshot} · ****{settlement.bankAccountLast4Snapshot}</div>
                      <div className="mt-1 text-xs text-[#5f696b]">
                        {settlement.bankReference
                          ? `Mã tham chiếu: ${settlement.bankReference}`
                          : 'Chưa có mã chuyển khoản'}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="mt-5 flex items-center justify-between">
            <span className="text-sm text-[#5f696b]">Trang {pagination.page}/{pagination.totalPages}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true)
                  setPage((current) => current - 1)
                }}
                className="rounded-lg border border-[#bec8ca] px-3 py-2 text-sm font-semibold disabled:opacity-40"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true)
                  setPage((current) => current + 1)
                }}
                className="rounded-lg border border-[#bec8ca] px-3 py-2 text-sm font-semibold disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </section>
    </PartnerLayout>
  )
}
