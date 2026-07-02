import { useEffect, useState } from 'react'
import { getWeather } from '../services/weatherApi.js'
import { isIndoorOnly } from '../utils/weather.js'

// Định dạng ngày -> "Hôm nay" / "T2", "T3"... theo giờ VN.
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function formatDayLabel(dateStr, index) {
  if (index === 0) return 'Hôm nay'
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateStr
  return WEEKDAYS[date.getDay()] || dateStr
}

export default function WeatherWidget({ latitude, longitude, categories }) {
  const [forecast, setForecast] = useState([])
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [reloadIndex, setReloadIndex] = useState(0) // tăng để thử tải lại khi lỗi

  const hidden = latitude == null || longitude == null || isIndoorOnly(categories)

  useEffect(() => {
    if (hidden) return undefined

    let active = true
    // Reset về loading khi thử lại (reloadIndex đổi) để hiện spinner thay vì lỗi cũ.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading')

    getWeather(latitude, longitude)
      .then((result) => {
        if (!active) return
        const days = result?.data?.forecast || []
        setForecast(days)
        setStatus(days.length > 0 ? 'ready' : 'error')
      })
      .catch(() => {
        if (active) setStatus('error')
      })

    return () => {
      active = false
    }
  }, [hidden, latitude, longitude, reloadIndex])

  // Thiếu toạ độ / điểm trong nhà -> ẩn hẳn, không phá layout.
  if (hidden) return null

  // Khi lỗi: thời tiết là thông tin quan trọng với du khách -> hiển thị thông báo
  // kèm nút thử lại thay vì im lặng return null.
  if (status === 'error') {
    return (
      <section className="rounded-2xl border border-[#bec8ca]/40 bg-white p-5 shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[22px] text-[#00474d]" aria-hidden="true">
            partly_cloudy_day
          </span>
          <h2 className="text-lg font-bold text-[#00474d]">Dự báo thời tiết</h2>
        </div>
        <div className="flex flex-col items-start gap-3 py-2 text-sm font-semibold text-[#3f484a]">
          <span>Không thể tải dự báo thời tiết lúc này.</span>
          <button
            type="button"
            onClick={() => setReloadIndex((prev) => prev + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#00474d] px-3 py-1.5 text-sm font-bold text-[#00474d] transition hover:bg-[#00474d] hover:text-white"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
            Thử lại
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-[#bec8ca]/40 bg-white p-5 shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-[22px] text-[#00474d]" aria-hidden="true">
          partly_cloudy_day
        </span>
        <h2 className="text-lg font-bold text-[#00474d]">Dự báo thời tiết</h2>
        <span className="text-xs font-semibold text-[#3f484a]">7 ngày</span>
      </div>

      {status === 'loading' ? (
        <div className="flex items-center gap-2 py-6 text-sm font-semibold text-[#3f484a]">
          <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">
            progress_activity
          </span>
          Đang tải dự báo...
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {forecast.map((day, index) => (
            <div
              key={day.date}
              className="flex min-w-[84px] flex-col items-center gap-1 rounded-xl border border-[#bec8ca]/40 bg-[#f9f9fc] px-3 py-3 text-center"
            >
              <span className="text-xs font-bold text-[#00474d]">
                {formatDayLabel(day.date, index)}
              </span>
              <span
                className="material-symbols-outlined text-[26px] text-[#00474d]"
                style={{ fontVariationSettings: "'FILL' 1" }}
                aria-hidden="true"
                title={day.label}
              >
                {day.icon}
              </span>
              <span className="text-sm font-bold text-[#1a1c1e]">
                {day.tempMax != null ? `${day.tempMax}°C` : '—'}
                <span className="font-semibold text-[#3f484a]">
                  {day.tempMin != null ? ` / ${day.tempMin}°` : ''}
                </span>
              </span>
              <span className="flex items-center gap-0.5 text-[11px] font-semibold text-[#006068]">
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                  water_drop
                </span>
                {day.rainProb != null ? `${day.rainProb}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
