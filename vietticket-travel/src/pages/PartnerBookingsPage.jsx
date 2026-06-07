import { useEffect, useState } from 'react'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'

const MOCK_BOOKINGS = [
  { id: 'B001', attraction: 'Sun World Ba Na Hills', ticket: 'Vé người lớn', customer: 'Nguyễn Văn A', phone: '0901234567', date: '2026-06-05', visitDate: '2026-06-10', slot: '08:00 – 10:00', qty: 2, amount: 1700000, status: 'confirmed' },
  { id: 'B002', attraction: 'Sun World Ba Na Hills', ticket: 'Vé trẻ em', customer: 'Trần Thị B', phone: '0912345678', date: '2026-06-05', visitDate: '2026-06-10', slot: '08:00 – 10:00', qty: 1, amount: 550000, status: 'confirmed' },
  { id: 'B003', attraction: 'Vịnh Hạ Long Cruise', ticket: 'Vé du thuyền 1 ngày', customer: 'Lê Văn C', phone: '0923456789', date: '2026-06-04', visitDate: '2026-06-12', slot: '07:30 – 18:00', qty: 2, amount: 2200000, status: 'pending' },
  { id: 'B004', attraction: 'Hội An Lantern Festival', ticket: 'Vé tham quan đêm', customer: 'Phạm Thị D', phone: '0934567890', date: '2026-06-04', visitDate: '2026-06-08', slot: '18:00 – 21:00', qty: 3, amount: 360000, status: 'cancelled' },
  { id: 'B005', attraction: 'Sun World Ba Na Hills', ticket: 'Vé gia đình', customer: 'Hoàng Văn E', phone: '0945678901', date: '2026-06-03', visitDate: '2026-06-15', slot: '10:00 – 12:00', qty: 1, amount: 2500000, status: 'confirmed' },
]

const STATUS = {
  confirmed: { label: 'Đã xác nhận', cls: 'bg-[#E6F4EA] text-[#137333]' },
  pending:   { label: 'Chờ xử lý',   cls: 'bg-[#ffdea8] text-[#725000]' },
  cancelled: { label: 'Đã hủy',      cls: 'bg-[#ffdad6] text-[#ba1a1a]' },
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

function PartnerBookingsPage() {
  const [bookings, setBookings] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    document.title = 'Quản lý Đặt vé | VietTicket B2B'
    setTimeout(() => { setBookings(MOCK_BOOKINGS); setIsLoading(false) }, 400)
  }, [])

  const filtered = bookings.filter((b) => {
    const q = search.toLowerCase()
    const matchSearch = !q || b.id.toLowerCase().includes(q) || b.customer.toLowerCase().includes(q) || b.attraction.toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || b.status === statusFilter
    return matchSearch && matchStatus
  })

  const handleConfirm = (id) => setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status: 'confirmed' } : b))
  const handleCancel  = (id) => setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status: 'cancelled' } : b))

  const stats = {
    total: bookings.length,
    confirmed: bookings.filter((b) => b.status === 'confirmed').length,
    pending:   bookings.filter((b) => b.status === 'pending').length,
    revenue:   bookings.filter((b) => b.status === 'confirmed').reduce((s, b) => s + b.amount, 0),
  }

  return (
    <PartnerLayout pageTitle="Bookings">
      <h2 className="text-2xl font-semibold text-[#191c1d] -mt-2 mb-6">Quản lý Đặt vé</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Tổng đặt vé', value: stats.total, icon: 'receipt_long', color: 'text-[#00474d]', bg: 'bg-[#e0f4f5]' },
          { label: 'Đã xác nhận', value: stats.confirmed, icon: 'check_circle', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]' },
          { label: 'Chờ xử lý', value: stats.pending, icon: 'pending', color: 'text-[#ba1a1a]', bg: 'bg-[#ffdad6]' },
          { label: 'Doanh thu', value: formatVND(stats.revenue), icon: 'payments', color: 'text-[#725000]', bg: 'bg-[#ffdea8]' },
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
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#bec8ca] text-sm outline-none focus:border-[#00474d]"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-lg border border-[#bec8ca] text-sm outline-none focus:border-[#00474d] bg-white">
          <option value="all">Tất cả trạng thái</option>
          <option value="confirmed">Đã xác nhận</option>
          <option value="pending">Chờ xử lý</option>
          <option value="cancelled">Đã hủy</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm overflow-hidden">
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
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-16 text-[#6f797a] text-sm">Không tìm thấy đặt vé nào.</td></tr>
                ) : filtered.map((b) => (
                  <tr key={b.id} className="border-t border-[#f2f4f5] hover:bg-[#f7f8f9] transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-[#00629d] font-semibold">{b.id}</td>
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
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS[b.status].cls}`}>{STATUS[b.status].label}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {b.status === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => handleConfirm(b.id)} className="px-3 py-1.5 bg-[#00474d] text-white text-xs font-medium rounded-lg hover:bg-[#136870] transition-colors">Xác nhận</button>
                          <button onClick={() => handleCancel(b.id)} className="px-3 py-1.5 border border-[#bec8ca] text-[#3f484a] text-xs font-medium rounded-lg hover:bg-[#f2f4f5] transition-colors">Hủy</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

export default PartnerBookingsPage
