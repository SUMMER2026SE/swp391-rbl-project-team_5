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

  const hidden = latitude == null || longitude == null || isIndoorOnly(categories)

  useEffect(() => {
    if (hidden) return undefined

    let active = true

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
  }, [hidden, latitude, longitude])

  // Thiếu toạ độ / điểm trong nhà / không lấy được dữ liệu -> ẩn hẳn, không phá layout.
  if (hidden) return null
  if (status === 'error') return null

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
                {day.tempMax != null ? `${day.tempMax}°` : '—'}
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
