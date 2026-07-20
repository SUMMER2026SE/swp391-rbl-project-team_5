import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { useAuth } from '../context/useAuth.js'
import * as partnerApi from '../services/partnerApi.js'
import { getBookingStatusMeta } from '../utils/bookingStatus.js'
import { formatBookingReference } from '../utils/bookingReference.js'
import { getTicketTypeLabel } from '../utils/ticketType.js'

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

function PartnerDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [bookings, setBookings] = useState([])
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState(null)

  const loadDashboard = useCallback(async () => {
    try {
      const data = await partnerApi.getDashboard()
      setStats(data.stats)
      const list = data.recentBookings || []
      setBookings(list)

      // Cập nhật selectedBooking từ dữ liệu mới nhất nếu đang mở
      setSelectedBooking((prev) => {
        if (!prev) return null
        const fresh = list.find((item) => item.id === prev.id)
        return fresh || prev
      })
    } catch (err) {
      const code = err.data?.code || err.data?.error?.code
      if (err.status === 403) {
        if (code === 'PARTNER_PROFILE_REQUIRED') {
          navigate('/partner/kyc', { replace: true })
          return
        }
        if (code === 'PARTNER_APPROVAL_REQUIRED') {
          navigate('/partner/pending', { replace: true })
          return
        }
      }
      toast.error(err.message || 'Có lỗi xảy ra khi tải thông tin dashboard.')
      setStats(null)
      setBookings([])
    } finally {
      setIsLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    document.title = 'Dashboard | VietTicket B2B'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard()
  }, [loadDashboard])

  const handleConfirm = async (id) => {
    setActionLoading(id)
    try {
      await partnerApi.approveBooking(id)
      toast.success('Đã xác nhận đơn đặt vé.')
      setSelectedBooking((prev) =>
        prev && prev.id === id ? { ...prev, status: 'confirmed' } : prev,
      )
      loadDashboard()
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
      loadDashboard()
    } catch (err) {
      toast.error(err.message || 'Không thể từ chối đơn.')
    } finally {
      setActionLoading(null)
    }
  }

  const displayName = user?.fullName || user?.username || 'Đối tác'

  return (
    <PartnerLayout pageTitle="Dashboard">
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-[#00474d] to-[#136870] rounded-2xl p-6 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[#a0d4d7] text-sm font-medium">Xin chào,</p>
          <h2 className="text-2xl font-bold text-white mt-0.5">{displayName} 👋</h2>
          <p className="text-[#a0d4d7] text-sm mt-1">Đây là tổng quan hoạt động của bạn trong tháng này.</p>
        </div>
        <Link
          to="/partner/attractions/new"
          className="flex items-center gap-2 px-5 py-2.5 bg-white text-[#00474d] text-sm font-semibold rounded-xl hover:bg-[#f2f4f5] transition-colors shadow-sm self-start sm:self-auto flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">add_location_alt</span>
          Thêm điểm mới
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
        </div>
      ) : !stats ? (
        <div className="bg-white rounded-xl border border-[#e1e3e4] p-10 text-center text-[#6f797a]">
          Không thể tải dữ liệu dashboard. Vui lòng thử lại sau.
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Điểm tham quan', value: stats?.totalAttractions ?? 0, icon: 'local_activity', color: 'text-[#00474d]', bg: 'bg-[#e0f4f5]', link: '/partner/attractions' },
              { label: 'Đang hoạt động', value: stats?.activeAttractions ?? 0, icon: 'check_circle', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]', link: '/partner/attractions' },
              { label: 'Gói vé', value: stats?.totalTickets ?? 0, icon: 'confirmation_number', color: 'text-[#00629d]', bg: 'bg-[#cfe5ff]', link: null },
              { label: 'Đặt vé tháng này', value: stats?.totalBookingsThisMonth ?? 0, icon: 'event_available', color: 'text-[#725000]', bg: 'bg-[#ffdea8]', link: '/partner/bookings' },
              { label: 'Vé bán ra (tháng)', value: stats?.ticketsSoldThisMonth ?? 0, icon: 'local_mall', color: 'text-[#8b5cf6]', bg: 'bg-[#f5f3ff]', link: '/partner/bookings' },
              { label: 'Tỷ lệ lấp đầy', value: stats?.occupancyRate !== undefined ? `${(stats.occupancyRate * 100).toFixed(1)}%` : '0.0%', icon: 'percent', color: 'text-[#ec4899]', bg: 'bg-[#fdf2f8]', link: null },
              { label: 'Chờ xử lý', value: stats?.pendingBookings ?? 0, icon: 'pending', color: 'text-[#ba1a1a]', bg: 'bg-[#ffdad6]', link: '/partner/bookings' },
                { label: 'Doanh số thuần (tháng)', value: formatVND(stats?.revenueThisMonth ?? 0), icon: 'payments', color: 'text-[#4a3800]', bg: 'bg-[#ffefc6]', link: '/partner/reports' },
              { label: 'Thực nhận (tháng)', value: formatVND(stats?.netRevenueThisMonth ?? 0), icon: 'account_balance_wallet', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]', link: '/partner/reports' },
            ].map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { to: '/partner/attractions', icon: 'local_activity', label: 'Quản lý điểm tham quan', desc: 'Thêm mới, chỉnh sửa thông tin điểm' },
              { to: '/partner/bookings', icon: 'confirmation_number', label: 'Quản lý đặt vé', desc: 'Xem và xác nhận các đơn đặt vé' },
              { to: '/partner/reports', icon: 'bar_chart', label: 'Báo cáo doanh thu', desc: 'Thống kê theo ngày, tháng, điểm tham quan' },
            ].map((q) => (
              <Link
                key={q.to} to={q.to}
                className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5 hover:border-[#00474d] hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-[#e0f4f5] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[#00474d] text-[20px]">{q.icon}</span>
                  </div>
                  <span className="material-symbols-outlined text-[#bec8ca] group-hover:text-[#00474d] transition-colors ml-auto text-[20px]">arrow_forward</span>
                </div>
                <p className="text-sm font-semibold text-[#191c1d]">{q.label}</p>
                <p className="text-xs text-[#6f797a] mt-0.5">{q.desc}</p>
              </Link>
            ))}
          </div>

          {/* Recent bookings */}
          <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm">
            <div className="flex items-center justify-between p-5 pb-4 border-b border-[#f2f4f5]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#00474d]">history</span>
                <h3 className="text-base font-semibold text-[#191c1d]">Đặt vé gần đây</h3>
              </div>
              <Link to="/partner/bookings" className="text-sm text-[#00474d] font-medium hover:underline flex items-center gap-1">
                Xem tất cả <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f7f8f9]">
                    {['Mã đặt', 'Địa điểm', 'Khách hàng', 'Ngày', 'Số tiền', 'Trạng thái'].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-[#6f797a] px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-[#6f797a]">
                        Chưa có đơn đặt vé nào.
                      </td>
                    </tr>
                  )}
                  {bookings.map((b, i) => {
                    const statusMeta = getBookingStatusMeta(b.status)
                    return (
                      <tr
                        key={b.id}
                        onClick={() => setSelectedBooking(b)}
                        className={`border-t border-[#f2f4f5] hover:bg-[#f7f8f9] transition-colors cursor-pointer ${i % 2 === 0 ? '' : ''}`}
                      >
                        <td className="px-5 py-3.5 font-mono text-xs text-[#00629d] font-semibold">{formatBookingReference(b.id)}</td>
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-[#191c1d] truncate max-w-[160px]">{b.attraction}</p>
                          <p className="text-xs text-[#6f797a]">{b.ticket}</p>
                        </td>
                        <td className="px-5 py-3.5 text-[#191c1d]">{b.customer}</td>
                        <td className="px-5 py-3.5 text-[#3f484a] whitespace-nowrap">{b.date}</td>
                        <td className="px-5 py-3.5 font-semibold text-[#00474d] whitespace-nowrap">{formatVND(b.amount)}</td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusMeta.className}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
              Đơn <span className="font-mono font-semibold text-[#00629d]">{formatBookingReference(rejectTarget.id)}</span> của khách{' '}
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
                Đóng
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
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.animate-fadeIn{animation:fadeIn 0.2s ease-out forwards}`}</style>
    </PartnerLayout>
  )
}

function StatCard({ label, value, icon, color, bg, link }) {
  const content = (
    <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
        <span className={`material-symbols-outlined text-[20px] ${color}`}>{icon}</span>
      </div>
      <div>
        <p className="text-xs text-[#6f797a]">{label}</p>
        <p className="text-lg font-bold text-[#191c1d] mt-0.5 leading-tight">{value}</p>
      </div>
    </div>
  )
  return link ? <Link to={link}>{content}</Link> : <div>{content}</div>
}

export default PartnerDashboardPage
