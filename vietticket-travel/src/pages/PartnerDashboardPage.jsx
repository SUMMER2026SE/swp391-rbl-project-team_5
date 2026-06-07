import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { useAuth } from '../context/useAuth.js'
import * as partnerApi from '../services/partnerApi.js'

// Mock stats — replace with API
const MOCK_STATS = {
  totalAttractions: 4,
  activeAttractions: 3,
  totalTickets: 6,
  totalBookingsThisMonth: 128,
  revenueThisMonth: 42500000,
  pendingBookings: 5,
}

const MOCK_RECENT_BOOKINGS = [
  { id: 'B001', attraction: 'Sun World Ba Na Hills', ticket: 'Vé người lớn', customer: 'Nguyễn Văn A', date: '2026-06-05', amount: 850000, status: 'confirmed' },
  { id: 'B002', attraction: 'Sun World Ba Na Hills', ticket: 'Vé trẻ em', customer: 'Trần Thị B', date: '2026-06-05', amount: 550000, status: 'confirmed' },
  { id: 'B003', attraction: 'Vịnh Hạ Long Cruise', ticket: 'Vé du thuyền 1 ngày', customer: 'Lê Văn C', date: '2026-06-04', amount: 1100000, status: 'pending' },
  { id: 'B004', attraction: 'Hội An Lantern Festival', ticket: 'Vé tham quan đêm', customer: 'Phạm Thị D', date: '2026-06-04', amount: 120000, status: 'cancelled' },
  { id: 'B005', attraction: 'Sun World Ba Na Hills', ticket: 'Vé gia đình', customer: 'Hoàng Văn E', date: '2026-06-03', amount: 2500000, status: 'confirmed' },
]

const BOOKING_STATUS = {
  confirmed: { label: 'Đã xác nhận', cls: 'bg-[#E6F4EA] text-[#137333]' },
  pending:   { label: 'Chờ xử lý',   cls: 'bg-[#ffdea8] text-[#725000]' },
  cancelled: { label: 'Đã hủy',      cls: 'bg-[#ffdad6] text-[#ba1a1a]' },
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

function PartnerDashboardPage() {
  const { user } = useAuth()
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
        // Module đặt vé chưa hoàn thiện — nếu chưa có dữ liệu thật, giữ bảng demo.
        setBookings(
          data.recentBookings && data.recentBookings.length > 0
            ? data.recentBookings
            : MOCK_RECENT_BOOKINGS
        )
      } catch (err) {
        if (partnerApi.isNetworkError(err)) {
          if (cancelled) return
          setStats(MOCK_STATS)
          setBookings(MOCK_RECENT_BOOKINGS)
        } else {
          toast.error(err.message)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [])

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
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            {[
              { label: 'Điểm tham quan', value: stats.totalAttractions, icon: 'local_activity', color: 'text-[#00474d]', bg: 'bg-[#e0f4f5]', link: '/partner/attractions' },
              { label: 'Đang hoạt động', value: stats.activeAttractions, icon: 'check_circle', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]', link: '/partner/attractions' },
              { label: 'Gói vé', value: stats.totalTickets, icon: 'confirmation_number', color: 'text-[#00629d]', bg: 'bg-[#cfe5ff]', link: null },
              { label: 'Đặt vé tháng này', value: stats.totalBookingsThisMonth, icon: 'event_available', color: 'text-[#725000]', bg: 'bg-[#ffdea8]', link: '/partner/bookings' },
              { label: 'Chờ xử lý', value: stats.pendingBookings, icon: 'pending', color: 'text-[#ba1a1a]', bg: 'bg-[#ffdad6]', link: '/partner/bookings' },
              { label: 'Doanh thu tháng', value: formatVND(stats.revenueThisMonth), icon: 'payments', color: 'text-[#4a3800]', bg: 'bg-[#ffefc6]', link: '/partner/reports' },
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
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${BOOKING_STATUS[b.status].cls}`}>
                          {BOOKING_STATUS[b.status].label}
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
