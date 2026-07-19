import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout'
import RevenueForecastPanel from '../components/forecast/RevenueForecastPanel'
import { getReports } from '../services/partnerApi'

const PERIODS = [
  { value: 'week', label: '7 ngày' },
  { value: 'month', label: 'Tháng này' },
  { value: 'year', label: 'Năm nay' },
]

const formatVND = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

function PartnerReportsPage() {
  const [period, setPeriod] = useState('month')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Báo cáo doanh thu | VietTicket B2B'
    let active = true
    getReports(period)
      .then((response) => {
        if (active) setReport(response.data)
      })
      .catch((error) => {
        if (active) {
          setReport(null)
          toast.error(error.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [period])

  const maxRevenue = useMemo(
    () => Math.max(1, ...(report?.timeline || []).map((item) => item.revenue)),
    [report],
  )

  return (
    <PartnerLayout pageTitle="Reports">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-2 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-[#191c1d]">Báo cáo doanh thu</h2>
          <p className="text-sm text-[#6f797a] mt-1">
            Chỉ tính giao dịch thành công của các đơn đã xác nhận.
          </p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setLoading(true)
                setPeriod(item.value)
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                period === item.value
                  ? 'bg-[#00474d] text-white border-[#00474d]'
                  : 'border-[#bec8ca] text-[#3f484a] hover:bg-[#f2f4f5]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">
            progress_activity
          </span>
        </div>
      ) : !report ? (
        <div className="bg-white rounded-xl border border-[#e1e3e4] p-10 text-center">
          Không thể tải báo cáo. Vui lòng thử lại sau.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              ['Đơn hợp lệ', report.summary.bookings, 'confirmation_number'],
              ['Vé đã bán', report.summary.ticketsSold, 'sell'],
              ['Doanh thu gộp', formatVND(report.summary.grossRevenue), 'payments'],
              ['Thực nhận dự kiến', formatVND(report.summary.netRevenue), 'account_balance_wallet'],
            ].map(([label, value, icon]) => (
              <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5" key={label}>
                <span className="material-symbols-outlined text-[#00474d]">{icon}</span>
                <p className="text-xs text-[#6f797a] mt-3">{label}</p>
                <p className="text-lg font-bold text-[#191c1d] mt-1">{value}</p>
              </div>
            ))}
          </div>

          <section className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold text-[#191c1d] mb-5">Doanh thu theo thời gian</h3>
            <div className="flex items-end gap-2 h-56 min-w-[560px]">
              {report.timeline.map((item) => (
                <div className="flex-1 flex flex-col items-center gap-2 h-full justify-end" key={item.label}>
                  <span className="text-[10px] text-[#6f797a]">{formatVND(item.revenue)}</span>
                  <div className="w-full bg-[#f2f4f5] rounded-t-lg h-36 flex items-end overflow-hidden">
                    <div
                      className="w-full bg-[#006068] rounded-t-lg"
                      style={{ height: `${Math.max(2, (item.revenue / maxRevenue) * 100)}%` }}
                      title={`${item.bookings} đơn`}
                    />
                  </div>
                  <span className="text-xs text-[#6f797a]">{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
            <h3 className="text-sm font-semibold text-[#191c1d] mb-4">Theo điểm tham quan</h3>
            {report.attractions.length === 0 ? (
              <p className="text-sm text-[#6f797a] py-8 text-center">Chưa có giao dịch trong kỳ này.</p>
            ) : report.attractions.map((item) => (
              <div className="mb-5 last:mb-0" key={item.id}>
                <div className="flex flex-wrap justify-between gap-2 mb-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-sm font-bold text-[#00474d]">{formatVND(item.revenue)}</span>
                </div>
                <div className="h-2 bg-[#f2f4f5] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#006068]"
                    style={{ width: `${item.share * 100}%` }}
                  />
                </div>
                <p className="text-xs text-[#6f797a] mt-1">
                  {item.bookings} đơn · {item.ticketsSold} vé · {(item.share * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </section>
        </div>
      )}

      <div className="mt-6">
        <RevenueForecastPanel mode="partner" />
      </div>
    </PartnerLayout>
  )
}

export default PartnerReportsPage
