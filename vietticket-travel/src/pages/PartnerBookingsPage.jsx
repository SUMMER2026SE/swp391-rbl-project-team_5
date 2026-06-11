import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import useSocket from '../context/useSocket.js'
import * as partnerApi from '../services/partnerApi.js'
import { getBookingStatusMeta } from '../utils/bookingStatus.js'

// Nhãn + màu trạng thái lấy từ nguồn dùng chung (utils/bookingStatus.js)
// để khớp với màn hình của khách hàng và admin.
function getStatusInfo(status) {
  const meta = getBookingStatusMeta(status)
  return { label: meta.label, cls: meta.className }
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

const PAGE_SIZE = 10

function PartnerBookingsPage() {
  const socket = useSocket()
  const [bookings, setBookings]         = useState([])
  const [isLoading, setIsLoading]       = useState(true)
  const [actionLoading, setActionLoading] = useState(null) // id of booking being acted on
  const [search, setSearch]             = useState('')
  const [searchInput, setSearchInput]   = useState('') // debounced input
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage]                 = useState(1)
  const [pagination, setPagination]     = useState({ total: 0, totalPages: 1 })
  const [rejectTarget, setRejectTarget] = useState(null) // booking đang chờ nhập lý do từ chối
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    document.title = 'Quản lý Đặt vé | VietTicket B2B'
  }, [])

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchBookings = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await partnerApi.getPartnerBookings({
        page,
        limit: PAGE_SIZE,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search || undefined,
      })
      setBookings(res.data || [])
      setPagination(res.pagination || { total: 0, totalPages: 1 })
    } catch (err) {
      toast.error(err.message || 'Không thể tải danh sách đặt vé.')
      setBookings([])
    } finally {
      setIsLoading(false)
    }
  }, [page, statusFilter, search])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBookings()
  }, [fetchBookings])

  useEffect(() => {
    function handleNewBooking(payload) {
      toast.info(
        `Bạn có một đơn đặt vé mới từ khách hàng ${payload.customerName || 'mới'}!`,
      )
      void fetchBookings()
    }

    socket.on('NEW_BOOKING', handleNewBooking)
    return () => {
      socket.off('NEW_BOOKING', handleNewBooking)
    }
  }, [fetchBookings, socket])

  const handleConfirm = async (id) => {
    setActionLoading(id)
    try {
      await partnerApi.approveBooking(id)
      toast.success('Đã xác nhận đơn đặt vé.')
      fetchBookings()
    } catch (err) {
      toast.error(err.message || 'Không thể xác nhận đơn.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancel = async () => {
    if (!rejectTarget) return
    const reason = rejectReason.trim()
    if (reason.length < 5) {
      toast.warning('Vui lòng nhập lý do từ chối (tối thiểu 5 ký tự).')
      return
    }
    setActionLoading(rejectTarget.id)
    try {
      await partnerApi.rejectBooking(rejectTarget.id, reason)
      toast.success('Đã từ chối đơn. Khách đã thanh toán sẽ được hoàn tiền đầy đủ.')
      setRejectTarget(null)
      setRejectReason('')
      fetchBookings()
    } catch (err) {
      toast.error(err.message || 'Không thể từ chối đơn.')
    } finally {
      setActionLoading(null)
    }
  }

  // Local stats derived from current page data (full stats would need a separate API)
  const stats = {
    total:     pagination.total,
    confirmed: bookings.filter((b) => b.status === 'confirmed').length,
    pending:   bookings.filter((b) => b.status === 'pending_partner' || b.status === 'pending').length,
    revenue:   bookings.filter((b) => b.status === 'confirmed').reduce((s, b) => s + b.amount, 0),
  }

  return (
    <PartnerLayout pageTitle="Bookings">
      <h2 className="text-2xl font-semibold text-[#191c1d] -mt-2 mb-6">Quản lý Đặt vé</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Tổng đặt vé',  value: pagination.total, icon: 'receipt_long', color: 'text-[#00474d]', bg: 'bg-[#e0f4f5]' },
          { label: 'Đã xác nhận', value: stats.confirmed,   icon: 'check_circle', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]' },
          { label: 'Chờ duyệt',   value: stats.pending,     icon: 'pending',      color: 'text-[#ba1a1a]', bg: 'bg-[#ffdad6]' },
          { label: 'Doanh thu',   value: formatVND(stats.revenue), icon: 'payments', color: 'text-[#725000]', bg: 'bg-[#ffdea8]' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center flex-shrink-0`}>
              <span className={`material-symbols-outlined text-[20px] ${s.color}`}>{s.icon}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#6f797a]">{s.label}</p>
              <p className="text-sm font-bold text-[#191c1d] truncate">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-[#6f797a]">search</span>
          <input
            type="text" placeholder="Tìm theo mã, khách hàng, địa điểm…"
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#bec8ca] text-sm outline-none focus:border-[#00474d]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="px-3 py-2.5 rounded-lg border border-[#bec8ca] text-sm outline-none focus:border-[#00474d] bg-white"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="confirmed">Đã xác nhận</option>
          <option value="pending_partner">Chờ đối tác duyệt</option>
          <option value="cancelled">Đã hủy</option>
          <option value="completed">Đã hoàn thành</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f7f8f9] border-b border-[#e1e3e4]">
                    {['Mã đặt', 'Địa điểm / Vé', 'Khách hàng', 'Ngày tham quan', 'Số tiền', 'Trạng thái', 'Thao tác'].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-[#6f797a] px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16 text-[#6f797a] text-sm">Không tìm thấy đặt vé nào.</td></tr>
                  ) : bookings.map((b) => {
                    const si = getStatusInfo(b.status)
                    const isActing = actionLoading === b.id
                    return (
                      <tr key={b.id} className="border-t border-[#f2f4f5] hover:bg-[#f7f8f9] transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-[#00629d] font-semibold">{b.id.slice(0, 8).toUpperCase()}</td>
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-[#191c1d]">{b.attraction}</p>
                          <p className="text-xs text-[#6f797a]">{b.ticket} · SL: {b.qty}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-[#191c1d]">{b.customer}</p>
                          <p className="text-xs text-[#6f797a]">{b.phone}</p>
                        </td>
                        <td className="px-5 py-3.5 text-[#3f484a] whitespace-nowrap">
                          <p>{b.visitDate}</p>
                          <p className="text-xs text-[#6f797a]">{b.slot}</p>
                        </td>
                        <td className="px-5 py-3.5 font-semibold text-[#00474d] whitespace-nowrap">{formatVND(b.amount)}</td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${si.cls}`}>{si.label}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          {b.status === 'pending_partner' && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleConfirm(b.id)}
                                disabled={isActing}
                                className="px-3 py-1.5 bg-[#00474d] text-white text-xs font-medium rounded-lg hover:bg-[#136870] transition-colors disabled:opacity-50"
                              >
                                {isActing ? '…' : 'Duyệt đơn'}
                              </button>
                              <button
                                onClick={() => {
                                  setRejectTarget(b)
                                  setRejectReason('')
                                }}
                                disabled={isActing}
                                className="px-3 py-1.5 border border-[#ba1a1a] text-[#ba1a1a] text-xs font-medium rounded-lg hover:bg-[#ffdad6] transition-colors disabled:opacity-50"
                              >
                                {isActing ? '…' : 'Từ chối'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-[#6f797a]">
                Trang {page}/{pagination.totalPages} · {pagination.total} kết quả
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg border border-[#bec8ca] text-sm text-[#3f484a] hover:bg-[#f2f4f5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Trước
                </button>
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === pagination.totalPages || Math.abs(n - page) <= 1)
                  .reduce((acc, n, idx, arr) => {
                    if (idx > 0 && arr[idx - 1] !== n - 1) acc.push('…')
                    acc.push(n)
                    return acc
                  }, [])
                  .map((n, i) =>
                    n === '…' ? (
                      <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-[#6f797a] text-sm">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n)}
                        className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                          n === page
                            ? 'border-[#00474d] bg-[#00474d] text-white font-semibold'
                            : 'border-[#bec8ca] text-[#3f484a] hover:bg-[#f2f4f5]'
                        }`}
                      >
                        {n}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="px-3 py-1.5 rounded-lg border border-[#bec8ca] text-sm text-[#3f484a] hover:bg-[#f2f4f5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Sau →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal nhập lý do từ chối đơn */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[#191c1d]">Từ chối đơn đặt vé</h3>
            <p className="mt-1 text-sm text-[#3f484a]">
              Đơn <span className="font-mono font-semibold text-[#00629d]">{rejectTarget.id.slice(0, 8).toUpperCase()}</span> của khách{' '}
              <span className="font-semibold">{rejectTarget.customer}</span>.
            </p>
            <p className="mt-2 rounded-lg bg-[#fff3e0] px-3 py-2 text-xs text-[#725000]">
              Khách đã thanh toán đơn này. Khi từ chối, hệ thống sẽ tự tạo yêu cầu hoàn tiền 100% cho khách
              và lý do bên dưới sẽ được gửi tới khách hàng.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Ví dụ: Khung giờ này đã kín chỗ do sự cố vận hành…"
              className="mt-3 w-full rounded-lg border border-[#bec8ca] px-3 py-2 text-sm outline-none focus:border-[#00474d]"
            />
            <p className="mt-1 text-xs text-[#6f797a]">Tối thiểu 5 ký tự.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejectTarget(null)
                  setRejectReason('')
                }}
                disabled={actionLoading === rejectTarget.id}
                className="px-4 py-2 rounded-lg border border-[#bec8ca] text-sm text-[#3f484a] hover:bg-[#f2f4f5] transition-colors disabled:opacity-50"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading === rejectTarget.id || rejectReason.trim().length < 5}
                className="px-4 py-2 rounded-lg bg-[#ba1a1a] text-sm font-semibold text-white hover:bg-[#93000a] transition-colors disabled:opacity-50"
              >
                {actionLoading === rejectTarget.id ? 'Đang xử lý…' : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

export default PartnerBookingsPage
