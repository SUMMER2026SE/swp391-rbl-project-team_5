import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { useAuth } from '../context/useAuth.js'
import * as partnerApi from '../services/partnerApi.js'

const BOOKING_STATUS = {
  confirmed:       { label: 'Đã xác nhận',   cls: 'bg-[#E6F4EA] text-[#137333]' },
  pending:         { label: 'Chờ thanh toán', cls: 'bg-[#ffdea8] text-[#725000]' },
  pending_partner: { label: 'Chờ duyệt',      cls: 'bg-[#e0f4f5] text-[#00474d]' },
  cancelled:       { label: 'Đã hủy',         cls: 'bg-[#ffdad6] text-[#ba1a1a]' },
  completed:       { label: 'Hoàn thành',     cls: 'bg-[#cfe5ff] text-[#00629d]' },
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

function PartnerDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [bookings, setBookings] = useState([])

  useEffect(() => {
    document.title = 'Dashboard | VietTicket B2B'

    let cancelled = false
    ;(async () => {
      try {
        const data = await partnerApi.getDashboard()
        if (cancelled) return
        setStats(data.stats)
        // Dùng recentBookings thật từ API; nếu rỗng thì để bảng trống
        setBookings(data.recentBookings || [])
      } catch (err) {
        if (cancelled) return
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
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [navigate])

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
              { label: 'Doanh thu tháng', value: formatVND(stats?.revenueThisMonth ?? 0), icon: 'payments', color: 'text-[#4a3800]', bg: 'bg-[#ffefc6]', link: '/partner/reports' },
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
                  {bookings.map((b, i) => (
                    <tr key={b.id} className={`border-t border-[#f2f4f5] hover:bg-[#f7f8f9] transition-colors ${i % 2 === 0 ? '' : ''}`}>
                      <td className="px-5 py-3.5 font-mono text-xs text-[#00629d] font-semibold">{b.id}</td>
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-[#191c1d] truncate max-w-[160px]">{b.attraction}</p>
                        <p className="text-xs text-[#6f797a]">{b.ticket}</p>
                      </td>
                      <td className="px-5 py-3.5 text-[#191c1d]">{b.customer}</td>
                      <td className="px-5 py-3.5 text-[#3f484a] whitespace-nowrap">{b.date}</td>
                      <td className="px-5 py-3.5 font-semibold text-[#00474d] whitespace-nowrap">{formatVND(b.amount)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${(BOOKING_STATUS[b.status] || BOOKING_STATUS.pending).cls}`}>
                          {(BOOKING_STATUS[b.status] || BOOKING_STATUS.pending).label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
