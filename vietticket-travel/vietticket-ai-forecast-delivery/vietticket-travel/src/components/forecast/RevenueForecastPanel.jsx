import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import {
  getPartnerForecastOverview,
  getAdminForecastOverview,
  triggerForecastRetrain,
} from '../../services/forecastApi'

const formatVND = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const DAY_OPTIONS = [
  { value: 7, label: '7 ngày tới' },
  { value: 14, label: '14 ngày tới' },
  { value: 30, label: '30 ngày tới' },
]

// mode: 'partner' | 'admin'
// - partner: hiển thị dự báo cho các attraction của chính đối tác đăng nhập
// - admin: hiển thị tổng quan toàn nền tảng + nút train lại model
export default function RevenueForecastPanel({ mode = 'partner' }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [retraining, setRetraining] = useState(false)

  const fetchOverview = mode === 'admin' ? getAdminForecastOverview : getPartnerForecastOverview

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchOverview({ days })
      .then((response) => {
        if (active) setData(response.data)
      })
      .catch((error) => {
        if (active) {
          setData(null)
          toast.error(error.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, mode])

  async function handleRetrain() {
    if (!window.confirm('Train lại model dự báo doanh thu? Quá trình này có thể mất vài phút.')) return
    setRetraining(true)
    try {
      const result = await triggerForecastRetrain({})
      toast.success(`Đã train lại model — MAPE: ${result.data.mape.toFixed(1)}%`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setRetraining(false)
    }
  }

  const items = mode === 'admin' ? data?.topAttractions : data?.attractions

  return (
    <section className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#191c1d] flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[#00474d]">insights</span>
            Dự báo doanh thu (AI)
          </h3>
          <p className="text-xs text-[#6f797a] mt-1">
            Ước tính dựa trên ensemble RandomForest + XGBoost, học từ lịch sử booking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm border border-[#bec8ca] rounded-lg px-3 py-1.5 text-[#3f484a]"
          >
            {DAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {mode === 'admin' && (
            <button
              onClick={handleRetrain}
              disabled={retraining}
              className="text-sm px-3 py-1.5 rounded-lg border border-[#00474d] text-[#00474d] hover:bg-[#f2f4f5] disabled:opacity-50"
            >
              {retraining ? 'Đang train...' : 'Train lại model'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <span className="material-symbols-outlined animate-spin text-[32px] text-[#00474d]">
            progress_activity
          </span>
        </div>
      ) : !data ? (
        <p className="text-sm text-[#6f797a] py-8 text-center">Không thể tải dự báo doanh thu.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="bg-[#f2f4f5] rounded-lg p-4">
            <p className="text-xs text-[#6f797a]">
              Tổng doanh thu dự báo ({days} ngày tới{mode === 'admin' ? ', toàn nền tảng' : ''})
            </p>
            <p className="text-xl font-bold text-[#00474d] mt-1">
              {formatVND(data.totalPredictedRevenue)}
            </p>
          </div>

          {!items || items.length === 0 ? (
            <p className="text-sm text-[#6f797a] py-6 text-center">
              Chưa có đủ dữ liệu để dự báo. Hãy đảm bảo điểm tham quan đã publish và có lịch sử booking.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <div
                  key={item.attractionId}
                  className="flex items-center justify-between gap-3 border border-[#e1e3e4] rounded-lg px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#191c1d] truncate">{item.attractionTitle}</p>
                    {item.error ? (
                      <p className="text-xs text-[#b3261e]">{item.error}</p>
                    ) : (
                      <p className="text-xs text-[#6f797a]">{item.city || ''}</p>
                    )}
                  </div>
                  {!item.error && (
                    <span className="text-sm font-semibold text-[#006068] whitespace-nowrap">
                      {formatVND(item.totalPredictedRevenue)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
