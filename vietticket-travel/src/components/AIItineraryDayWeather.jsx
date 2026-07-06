import { useEffect, useMemo, useState } from 'react'
import { getWeather } from '../services/weatherApi.js'
import { hasItineraryMapPoint } from '../utils/aiItineraryMap.js'
import { isIndoorOnly } from '../utils/weather.js'

function getForecastForDate(forecast, visitDate) {
  if (!Array.isArray(forecast) || forecast.length === 0) {
    return { day: null, isOutsideForecastRange: false }
  }
  if (!visitDate) {
    return { day: forecast[0], isOutsideForecastRange: false }
  }

  const day = forecast.find((item) => item.date === visitDate)
  return { day: day || null, isOutsideForecastRange: !day }
}

export default function AIItineraryDayWeather({ activity, visitDate }) {
  const hidden = useMemo(
    () =>
      !hasItineraryMapPoint({ latitude: activity?.latitude, longitude: activity?.longitude }) ||
      isIndoorOnly(activity?.categories),
    [activity],
  )
  const requestKey = hidden ? '' : `${activity.latitude},${activity.longitude}`
  const [weatherState, setWeatherState] = useState({
    forecast: [],
    requestKey: '',
    status: 'idle',
  })

  useEffect(() => {
    if (hidden) return undefined

    let active = true

    getWeather(activity.latitude, activity.longitude)
      .then((result) => {
        if (!active) return
        const days = result?.data?.forecast || []
        setWeatherState({
          forecast: days,
          requestKey,
          status: days.length > 0 ? 'ready' : 'error',
        })
      })
      .catch(() => {
        if (active) {
          setWeatherState({
            forecast: [],
            requestKey,
            status: 'error',
          })
        }
      })

    return () => {
      active = false
    }
  }, [activity?.latitude, activity?.longitude, hidden, requestKey])

  const status = weatherState.requestKey === requestKey ? weatherState.status : 'loading'
  if (hidden || status === 'error') return null

  const { day, isOutsideForecastRange } = getForecastForDate(weatherState.forecast, visitDate)
  const activityTitle = activity?.title || activity?.name || activity?.destination || ''

  return (
    <div className="rounded-2xl border border-[#dbe4e8] bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px] text-[#006068]" aria-hidden="true">
          partly_cloudy_day
        </span>
        <p className="text-sm font-bold text-[#00474d]">Thời tiết điểm đại diện</p>
      </div>

      {status === 'loading' ? (
        <p className="text-xs font-semibold text-[#64748b]">Đang tải dự báo...</p>
      ) : isOutsideForecastRange ? (
        <p className="text-xs font-semibold text-[#64748b]">
          Chưa có dự báo thời tiết cho đúng ngày tham quan này.
        </p>
      ) : day ? (
        <div className="space-y-1 text-xs font-semibold text-[#475569]">
          {activityTitle && (
            <p className="text-[#64748b]">Theo điểm: {activityTitle}</p>
          )}
          <p>{day.date}</p>
          <p className="flex items-center gap-1 text-[#0f172a]">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              {day.icon}
            </span>
            {day.label}
          </p>
          <p>
            {day.tempMin != null && day.tempMax != null
              ? `${day.tempMin}° - ${day.tempMax}°`
              : 'Chưa có nhiệt độ'}
            {day.rainProb != null ? `, mưa ${day.rainProb}%` : ''}
          </p>
        </div>
      ) : (
        <p className="text-xs font-semibold text-[#64748b]">Chưa có dự báo cho điểm này.</p>
      )}
    </div>
  )
}
