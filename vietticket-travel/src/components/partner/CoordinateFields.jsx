import { useState } from 'react'

function isValidCoordinate(lat, lng) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  )
}

function CoordinateFields({ lat, lng, onLatChange, onLngChange }) {
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const hasValidCoordinates = isValidCoordinate(lat, lng)

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Trình duyệt này không hỗ trợ định vị.')
      return
    }

    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        onLatChange(coords.latitude.toFixed(6))
        onLngChange(coords.longitude.toFixed(6))
        setLocating(false)
      },
      () => {
        setLocationError('Không thể lấy vị trí. Hãy cấp quyền định vị hoặc nhập tọa độ.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const mapUrl = hasValidCoordinates
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`
    : ''

  return (
    <div className="rounded-xl border border-[#bec8ca] bg-[#f8fafb] p-5 shadow-sm">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-[#191c1d]">
          Vĩ độ
          <input
            type="number"
            min="-90"
            max="90"
            step="0.000001"
            value={lat}
            onChange={(event) => onLatChange(event.target.value)}
            placeholder="Ví dụ: 16.047079"
            className="mt-2 w-full rounded-lg border border-[#bec8ca] bg-white px-4 py-3 text-sm outline-none focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d]"
          />
        </label>
        <label className="text-sm font-medium text-[#191c1d]">
          Kinh độ
          <input
            type="number"
            min="-180"
            max="180"
            step="0.000001"
            value={lng}
            onChange={(event) => onLngChange(event.target.value)}
            placeholder="Ví dụ: 108.206230"
            className="mt-2 w-full rounded-lg border border-[#bec8ca] bg-white px-4 py-3 text-sm outline-none focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d]"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="inline-flex items-center gap-2 rounded-lg border border-[#006068] px-4 py-2 text-sm font-semibold text-[#006068] transition-colors hover:bg-[#e8f5f6] disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">my_location</span>
          {locating ? 'Đang định vị...' : 'Dùng vị trí hiện tại'}
        </button>
        {hasValidCoordinates && (
          <a
            href={mapUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#00474d] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#136870]"
          >
            <span className="material-symbols-outlined text-[18px]">map</span>
            Kiểm tra trên OpenStreetMap
          </a>
        )}
      </div>

      {locationError && <p className="mt-3 text-sm text-[#ba1a1a]">{locationError}</p>}
      <p className="mt-3 text-xs leading-5 text-[#3f484a]">
        Tọa độ chính xác giúp khách xem đúng vị trí và tìm đường tới điểm tham quan.
      </p>
    </div>
  )
}

export default CoordinateFields
