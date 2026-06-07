import { useEffect, useState } from 'react'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'

const MOCK_MONTHLY = [
  { month: 'T1', bookings: 45,  revenue: 18200000 },
  { month: 'T2', bookings: 52,  revenue: 21500000 },
  { month: 'T3', bookings: 61,  revenue: 25000000 },
  { month: 'T4', bookings: 78,  revenue: 31200000 },
  { month: 'T5', bookings: 94,  revenue: 38600000 },
  { month: 'T6', bookings: 128, revenue: 42500000 },
]

const MOCK_BY_ATTRACTION = [
  { name: 'Sun World Ba Na Hills', bookings: 74, revenue: 26400000, pct: 62 },
  { name: 'Vịnh Hạ Long Cruise',   bookings: 29, revenue: 11200000, pct: 26 },
  { name: 'Hội An Lantern Festival', bookings: 18, revenue: 3600000, pct: 8.5 },
  { name: 'VinWonders Nha Trang',  bookings: 7,  revenue: 1300000, pct: 3.5 },
]

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

function PartnerReportsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [period, setPeriod] = useState('month')

  useEffect(() => {
    document.title = 'Báo cáo doanh thu | VietTicket B2B'
    setTimeout(() => setIsLoading(false), 400)
  }, [])

  const maxRevenue = Math.max(...MOCK_MONTHLY.map((m) => m.revenue))
  const totalRevenue = MOCK_MONTHLY.reduce((s, m) => s + m.revenue, 0)
  const totalBookings = MOCK_MONTHLY.reduce((s, m) => s + m.bookings, 0)

  return (
    <PartnerLayout pageTitle="Reports">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-2 mb-6">
        <h2 className="text-2xl font-semibold text-[#191c1d]">Báo cáo doanh thu</h2>
        <div className="flex gap-2">
          {[{ k: 'week', l: '7 ngày' }, { k: 'month', l: 'Tháng này' }, { k: 'year', l: 'Năm nay' }].map((p) => (
            <button key={p.k} onClick={() => setPeriod(p.k)} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${period === p.k ? 'bg-[#00474d] text-white border-[#00474d]' : 'border-[#bec8ca] text-[#3f484a] hover:bg-[#f2f4f5]'}`}>{p.l}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Tổng đặt vé', value: totalBookings, icon: 'confirmation_number', color: 'text-[#00474d]', bg: 'bg-[#e0f4f5]', sub: `${MOCK_MONTHLY.length} tháng` },
              { label: 'Tổng doanh thu', value: formatVND(totalRevenue), icon: 'payments', color: 'text-[#725000]', bg: 'bg-[#ffdea8]', sub: 'Tất cả địa điểm' },
              { label: 'Trung bình / tháng', value: formatVND(Math.round(totalRevenue / MOCK_MONTHLY.length)), icon: 'trending_up', color: 'text-[#137333]', bg: 'bg-[#E6F4EA]', sub: 'Doanh thu bình quân' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                  <span className={`material-symbols-outlined text-[24px] ${s.color}`}>{s.icon}</span>
                </div>
                <div>
                  <p className="text-xs text-[#6f797a]">{s.label}</p>
                  <p className="text-lg font-bold text-[#191c1d] mt-0.5">{s.value}</p>
                  <p className="text-xs text-[#6f797a]">{s.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Bar chart — CSS only */}
          <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
            <h3 className="text-sm font-semibold text-[#191c1d] mb-5">Doanh thu theo tháng</h3>
            <div className="flex items-end gap-3 h-48">
              {MOCK_MONTHLY.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-xs text-[#3f484a] font-semibold">{formatVND(m.revenue).replace('₫', '').trim()}</span>
                  <div className="w-full bg-[#f2f4f5] rounded-t-lg overflow-hidden flex items-end" style={{ height: '120px' }}>
                    <div
                      className="w-full bg-[#00474d] rounded-t-lg transition-all"
                      style={{ height: `${(m.revenue / maxRevenue) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-[#6f797a]">{m.month}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By attraction */}
          <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
            <h3 className="text-sm font-semibold text-[#191c1d] mb-4">Doanh thu theo địa điểm</h3>
            <div className="flex flex-col gap-4">
              {MOCK_BY_ATTRACTION.map((a) => (
                <div key={a.name}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-sm text-[#191c1d] font-medium">{a.name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#6f797a]">{a.bookings} lượt</span>
                      <span className="text-sm font-bold text-[#00474d]">{formatVND(a.revenue)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-[#f2f4f5] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00474d] rounded-full" style={{ width: `${a.pct}%` }} />
                  </div>
                  <p className="text-xs text-[#6f797a] mt-1">{a.pct}% tổng doanh thu</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

export default PartnerReportsPage
