import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import useSocket from '../context/useSocket.js'
import * as partnerApi from '../services/partnerApi.js'
import { getBookingStatusMeta } from '../utils/bookingStatus.js'
import { getTicketTypeLabel } from '../utils/ticketType.js'

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
  const [stats, setStats]               = useState({
    total: 0,
    confirmed: 0,
    pendingPartner: 0,
    recognizedRevenue: 0,
  })
  const [rejectTarget, setRejectTarget] = useState(null) // booking đang chờ nhập lý do từ chối
  const [rejectReason, setRejectReason] = useState('')
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [selectedBooking, setSelectedBooking] = useState(null)

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
      const list = res.data || []
      setBookings(list)
      setPagination(res.pagination || { total: 0, totalPages: 1 })
      setStats(res.stats || {
        total: 0,
        confirmed: 0,
        pendingPartner: 0,
        recognizedRevenue: 0,
      })

      // Cập nhật selectedBooking từ dữ liệu mới nhất nếu đang mở
      setSelectedBooking((prev) => {
        if (!prev) return null
        const fresh = list.find((item) => item.id === prev.id)
        return fresh || prev
      })
    } catch (err) {
      toast.error(err.message || 'Không thể tải danh sách đặt vé.')
      setBookings([])
      setStats({
        total: 0,
        confirmed: 0,
        pendingPartner: 0,
        recognizedRevenue: 0,
      })
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
      setSelectedBooking((prev) =>
        prev && prev.id === id ? { ...prev, status: 'confirmed' } : prev,
      )
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
      setSelectedBooking((prev) =>
        prev && prev.id === rejectTarget.id ? { ...prev, status: 'cancelled' } : prev,
      )
      setRejectTarget(null)
      setRejectReason('')
      fetchBookings()
    } catch (err) {
      toast.error(err.message || 'Không thể từ chối đơn.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleConfirmedCancellation = async () => {
    if (!cancelTarget) return
    const reason = cancelReason.trim()
    if (reason.length < 5) {
      toast.warning('Vui lòng nhập lý do hủy (tối thiểu 5 ký tự).')
      return
    }
    setActionLoading(cancelTarget.id)
    try {
      await partnerApi.cancelConfirmedBooking(cancelTarget.id, reason)
      toast.success('Đã hủy đơn. Khoản hoàn 100% đang được xử lý tự động.')
      setSelectedBooking((prev) =>
        prev && prev.id === cancelTarget.id ? { ...prev, status: 'cancelled', refundRequired: true } : prev,
      )
      setCancelTarget(null)
      setCancelReason('')
      void fetchBookings()
    } catch (err) {
      toast.error(err.message || 'Không thể hủy đơn đã xác nhận.')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <PartnerLayout pageTitle="Bookings">
      <h2 className="text-2xl font-semibold text-[#191c1d] -mt-2 mb-6">Quản lý Đặt vé</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Tổng đặt vé',  value: stats.total, icon: 'receipt_long', color: 'text-[#00474d]', bg: 'bg-[#e0f4f5]' },
          { label: 'Đã xác nhận', value: stats.confirmed,   icon: 'check_circle', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]' },
          { label: 'Chờ duyệt',   value: stats.pendingPartner,     icon: 'pending',      color: 'text-[#ba1a1a]', bg: 'bg-[#ffdad6]' },
          { label: 'Doanh thu ròng đã ghi nhận', value: formatVND(stats.recognizedRevenue), icon: 'payments', color: 'text-[#725000]', bg: 'bg-[#ffdea8]' },
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
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setSelectedBooking(b)}
                              className="px-3 py-1.5 border border-[#bec8ca] text-[#3f484a] text-xs font-semibold rounded-lg hover:bg-[#f2f4f5] transition-colors"
                            >
                              Chi tiết
                            </button>
                            {b.status === 'pending_partner' && (
                              <>
                                <button
                                  onClick={() => handleConfirm(b.id)}
                                  disabled={isActing}
                                  className="px-3 py-1.5 bg-[#00474d] text-white text-xs font-semibold rounded-lg hover:bg-[#136870] transition-colors disabled:opacity-50"
                                >
                                  {isActing ? '…' : 'Duyệt'}
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectTarget(b)
                                    setRejectReason('')
                                  }}
                                  disabled={isActing}
                                  className="px-3 py-1.5 border border-[#ba1a1a] text-[#ba1a1a] text-xs font-semibold rounded-lg hover:bg-[#ffdad6] transition-colors disabled:opacity-50"
                                >
                                  {isActing ? '…' : 'Từ chối'}
                                </button>
                              </>
                            )}
                            {b.status === 'confirmed' && (
                              <button
                                onClick={() => {
                                  setCancelTarget(b)
                                  setCancelReason('')
                                }}
                                disabled={isActing}
                                className="px-3 py-1.5 border border-[#ba1a1a] text-[#ba1a1a] text-xs font-semibold rounded-lg hover:bg-[#ffdad6] transition-colors disabled:opacity-50"
                              >
                                Hủy đơn
                              </button>
                            )}
                          </div>
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

      {/* Modal chi tiết đặt vé */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl animate-fadeIn my-8">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#e1e3e4] pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#191c1d] flex items-center gap-2">
                  Chi tiết Đặt vé
                  <span className="font-mono text-sm text-[#00629d] bg-[#cfe5ff] px-2 py-0.5 rounded">
                    #{selectedBooking.id.toUpperCase()}
                  </span>
                </h3>
                <p className="text-xs text-[#6f797a] mt-0.5">Ngày đặt: {selectedBooking.createdAt ? new Date(selectedBooking.createdAt).toLocaleString('vi-VN') : selectedBooking.date}</p>
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                className="w-8 h-8 rounded-full hover:bg-[#f2f4f5] flex items-center justify-center text-[#6f797a] transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
              {/* Trạng thái đơn */}
              <div className="flex items-center justify-between p-3.5 bg-[#f8fafb] rounded-xl border border-[#e1e3e4]">
                <div>
                  <span className="text-xs font-semibold text-[#6f797a] block">Trạng thái hiện tại</span>
                  <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-bold ${getBookingStatusMeta(selectedBooking.status).className}`}>
                    {getBookingStatusMeta(selectedBooking.status).label}
                  </span>
                </div>
                {selectedBooking.refundRequired && (
                  <div className="text-right">
                    <span className="text-xs font-semibold text-[#ba1a1a] block">⚠️ Yêu cầu hoàn tiền</span>
                    <span className="text-xs text-[#6f797a]">Đang chờ Admin xử lý</span>
                  </div>
                )}
              </div>

              {/* Grid 2 cột */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Thông tin khách hàng */}
                <div className="border border-[#e1e3e4] rounded-xl p-4">
                  <h4 className="text-sm font-bold text-[#191c1d] flex items-center gap-1.5 mb-3 border-b border-[#f2f4f5] pb-2">
                    <span className="material-symbols-outlined text-[18px] text-[#00474d]">person</span>
                    Thông tin Khách hàng
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-[#6f797a] text-xs block">Họ và tên</span>
                      <span className="font-semibold text-[#191c1d]">{selectedBooking.customer}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a] text-xs block">Số điện thoại</span>
                      <span className="font-mono text-[#191c1d]">{selectedBooking.phone || 'Chưa cung cấp'}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a] text-xs block">Email</span>
                      <span className="text-[#191c1d]">{selectedBooking.email || 'Chưa cung cấp'}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a] text-xs block">Ghi chú từ khách hàng</span>
                      <span className="text-[#191c1d] italic">{selectedBooking.note || 'Không có ghi chú'}</span>
                    </div>
                  </div>
                </div>

                {/* Thông tin dịch vụ & vé */}
                <div className="border border-[#e1e3e4] rounded-xl p-4">
                  <h4 className="text-sm font-bold text-[#191c1d] flex items-center gap-1.5 mb-3 border-b border-[#f2f4f5] pb-2">
                    <span className="material-symbols-outlined text-[18px] text-[#00474d]">confirmation_number</span>
                    Thông tin dịch vụ & Vé
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-[#6f797a] text-xs block">Địa điểm</span>
                      <span className="font-semibold text-[#191c1d]">{selectedBooking.attraction}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a] text-xs block">Gói vé</span>
                      <span className="font-medium text-[#191c1d]">{selectedBooking.ticket}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a] text-xs block">Chi tiết vé & Đơn giá</span>
                      <span className="text-[#191c1d]">
                        {getTicketTypeLabel(selectedBooking.snapshotTicketType)}
                        {' · '}
                        {formatVND(selectedBooking.snapshotUnitPrice || (selectedBooking.amount / selectedBooking.qty))}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[#6f797a] text-xs block">Số lượng</span>
                        <span className="font-semibold text-[#191c1d]">{selectedBooking.qty} vé</span>
                      </div>
                      <div>
                        <span className="text-[#6f797a] text-xs block">Ngày tham quan</span>
                        <span className="font-semibold text-[#191c1d]">{selectedBooking.visitDate}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-[#6f797a] text-xs block">Khung giờ</span>
                      <span className="text-[#191c1d]">{selectedBooking.slot}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Thông tin thanh toán */}
              <div className="border border-[#e1e3e4] rounded-xl p-4">
                <h4 className="text-sm font-bold text-[#191c1d] flex items-center gap-1.5 mb-3 border-b border-[#f2f4f5] pb-2">
                  <span className="material-symbols-outlined text-[18px] text-[#00474d]">payments</span>
                  Chi tiết thanh toán
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-[#6f797a]">Giá gốc:</span>
                      <span className="font-medium">{formatVND(selectedBooking.subtotalAmount || selectedBooking.amount)}</span>
                    </div>
                    <div className="flex justify-between text-[#ba1a1a]">
                      <span className="text-[#6f797a]">Voucher giảm giá:</span>
                      <span>-{formatVND(selectedBooking.discountAmount || 0)}</span>
                    </div>
                    <div className="flex justify-between border-t border-[#f2f4f5] pt-2 font-bold text-[#00474d] text-base">
                      <span>Tổng thanh toán:</span>
                      <span>{formatVND(selectedBooking.amount)}</span>
                    </div>
                  </div>
                  <div className="space-y-1 bg-[#f8fafb] p-3 rounded-lg border border-[#e1e3e4] text-xs">
                    <div>
                      <span className="text-[#6f797a]">Phương thức:</span>{' '}
                      <span className="font-semibold">{selectedBooking.paymentGateway || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a]">Trạng thái GD:</span>{' '}
                      <span className="font-semibold text-[#137333] uppercase">{selectedBooking.paymentStatus || 'SUCCESS'}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a]">Mã giao dịch:</span>{' '}
                      <span className="font-mono">{selectedBooking.transactionId || 'Chưa cập nhật'}</span>
                    </div>
                    <div>
                      <span className="text-[#6f797a]">Thời gian:</span>{' '}
                      <span>{selectedBooking.paidAt ? new Date(selectedBooking.paidAt).toLocaleString('vi-VN') : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Danh sách mã QR vé */}
              <div className="border border-[#e1e3e4] rounded-xl p-4">
                <h4 className="text-sm font-bold text-[#191c1d] flex items-center gap-1.5 mb-3 border-b border-[#f2f4f5] pb-2">
                  <span className="material-symbols-outlined text-[18px] text-[#00474d]">qr_code</span>
                  Danh sách Vé & Mã QR
                </h4>
                {selectedBooking.ticketInstances && selectedBooking.ticketInstances.length > 0 ? (
                  <div className="space-y-2">
                    {selectedBooking.ticketInstances.map((ticket, index) => {
                      let ticketStatusLabel = 'Chưa sử dụng';
                      let statusCls = 'bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]';
                      if (ticket.status === 'USED') {
                        ticketStatusLabel = 'Đã sử dụng';
                        statusCls = 'bg-[#f2f4f5] text-[#6f797a] border-[#bec8ca]';
                      } else if (ticket.status === 'REFUNDED') {
                        ticketStatusLabel = 'Đã hoàn tiền';
                        statusCls = 'bg-[#ffdad6] text-[#ba1a1a] border-[#ffb4ab]';
                      }

                      return (
                        <div key={ticket.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white rounded-lg border border-[#e1e3e4] text-sm gap-2">
                          <div>
                            <span className="font-semibold text-[#191c1d]">Vé #{index + 1}</span>
                            <span className="font-mono text-xs text-[#6f797a] ml-2">({ticket.id})</span>
                            {ticket.checkedInAt && (
                              <p className="text-xs text-[#6f797a] mt-1">
                                Check-in lúc: {new Date(ticket.checkedInAt).toLocaleString('vi-VN')}
                                {ticket.checkedInBy?.fullName && ` bởi ${ticket.checkedInBy.fullName}`}
                              </p>
                            )}
                          </div>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusCls} self-start sm:self-auto`}>
                            {ticketStatusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[#6f797a] italic text-center py-4 bg-[#f8fafb] rounded-lg">
                    Vé và mã QR sẽ tự động được cấp sau khi đối tác duyệt xác nhận đơn hàng này.
                  </p>
                )}
              </div>
            </div>

            {/* Footer / Actions */}
            <div className="flex justify-end items-center gap-3 border-t border-[#e1e3e4] pt-4 mt-6">
              <button
                onClick={() => setSelectedBooking(null)}
                className="px-4 py-2 border border-[#bec8ca] text-[#3f484a] text-sm font-semibold rounded-lg hover:bg-[#f2f4f5] transition-colors"
              >
                Đóng
              </button>
              {selectedBooking.status === 'pending_partner' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setRejectTarget(selectedBooking)
                      setRejectReason('')
                    }}
                    disabled={actionLoading === selectedBooking.id}
                    className="px-4 py-2 border border-[#ba1a1a] text-[#ba1a1a] text-sm font-semibold rounded-lg hover:bg-[#ffdad6] transition-colors disabled:opacity-50"
                  >
                    Từ chối đơn
                  </button>
                  <button
                    onClick={() => handleConfirm(selectedBooking.id)}
                    disabled={actionLoading === selectedBooking.id}
                    className="px-5 py-2 bg-[#00474d] text-white text-sm font-semibold rounded-lg hover:bg-[#136870] transition-colors disabled:opacity-50"
                  >
                    {actionLoading === selectedBooking.id ? 'Đang duyệt…' : 'Duyệt đơn'}
                  </button>
                </div>
              )}
              {selectedBooking.status === 'confirmed' && (
                <button
                  onClick={() => {
                    setCancelTarget(selectedBooking)
                    setCancelReason('')
                  }}
                  disabled={actionLoading === selectedBooking.id}
                  className="px-4 py-2 border border-[#ba1a1a] text-[#ba1a1a] text-sm font-semibold rounded-lg hover:bg-[#ffdad6] transition-colors disabled:opacity-50"
                >
                  Hủy đơn đã xác nhận
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal nhập lý do từ chối đơn */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-fadeIn">
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
                Hủy bộ
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
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-fadeIn">
            <h3 className="text-lg font-bold text-[#191c1d]">Hủy đơn đã xác nhận</h3>
            <p className="mt-1 text-sm text-[#3f484a]">
              Đơn <span className="font-mono font-semibold text-[#00629d]">{cancelTarget.id.slice(0, 8).toUpperCase()}</span> của khách{' '}
              <span className="font-semibold">{cancelTarget.customer}</span>.
            </p>
            <p className="mt-2 rounded-lg bg-[#ffdad6]/50 px-3 py-2 text-xs text-[#93000a]">
              Chỉ hủy khi điểm tham quan không thể cung cấp dịch vụ. Hệ thống sẽ vô hiệu hóa toàn bộ QR,
              hoàn kho và xử lý hoàn 100% về phương thức thanh toán ban đầu.
            </p>
            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              rows={3}
              placeholder="Ví dụ: Điểm tham quan đóng cửa đột xuất do thời tiết…"
              className="mt-3 w-full rounded-lg border border-[#bec8ca] px-3 py-2 text-sm outline-none focus:border-[#00474d]"
            />
            <p className="mt-1 text-xs text-[#6f797a]">Tối thiểu 5 ký tự.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setCancelTarget(null)
                  setCancelReason('')
                }}
                disabled={actionLoading === cancelTarget.id}
                className="px-4 py-2 rounded-lg border border-[#bec8ca] text-sm text-[#3f484a] hover:bg-[#f2f4f5] transition-colors disabled:opacity-50"
              >
                Đóng
              </button>
              <button
                onClick={handleConfirmedCancellation}
                disabled={actionLoading === cancelTarget.id || cancelReason.trim().length < 5}
                className="px-4 py-2 rounded-lg bg-[#ba1a1a] text-sm font-semibold text-white hover:bg-[#93000a] transition-colors disabled:opacity-50"
              >
                {actionLoading === cancelTarget.id ? 'Đang xử lý…' : 'Xác nhận hủy và hoàn tiền'}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.animate-fadeIn{animation:fadeIn 0.2s ease-out forwards}`}</style>
    </PartnerLayout>
  )
}

export default PartnerBookingsPage
