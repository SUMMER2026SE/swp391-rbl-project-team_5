import React, { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { defaultIcon, hasValidLatLng } from './leafletIcon.js'

// Tâm mặc định (giữa Việt Nam) khi chưa có điểm nào.
const VN_CENTER = [16.0, 107.9]
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function getBaseLayerProps() {
  if (MAPTILER_KEY) {
    return {
      attribution: MAPTILER_ATTRIBUTION,
      url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
    }
  }

  return {
    attribution: OSM_ATTRIBUTION,
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  }
}

const formatPrice = (value) =>
  value == null ? null : `${Number(value).toLocaleString('vi-VN')}đ`

// Tự động zoom/khung nhìn để thấy hết các marker.
function FitBounds({ points }) {
  const map = useMap()
  React.useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [map, points])
  return null
}

export default function AttractionsMap({ attractions = [], navigate, height = 480 }) {
  const points = useMemo(
    () =>
      attractions.filter(hasValidLatLng).map((a) => ({
        id: a.id,
        title: a.title || a.name || 'Điểm tham quan',
        city: a.city,
        image: a.primaryImage,
        price: a.minPrice ?? a.price ?? null,
        lat: Number(a.latitude),
        lng: Number(a.longitude),
      })),
    [attractions],
  )

  const center = points.length ? [points[0].lat, points[0].lng] : VN_CENTER
  const baseLayer = getBaseLayerProps()

  return (
    <div className="overflow-hidden rounded-xl border border-[#bec8ca]/60 shadow-[0_4px_20px_rgba(0,40,50,0.06)]" role="region" aria-label="Bản đồ các điểm tham quan">
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom
        style={{ height, width: '100%' }}
      >
        <TileLayer attribution={baseLayer.attribution} url={baseLayer.url} />
        <FitBounds points={points} />
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={defaultIcon} alt={`Vị trí ${p.title}`} title={p.title} riseOnHover>
            <Popup>
              <div style={{ width: 200 }}>
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.title}
                    style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8 }}
                  />
                ) : null}
                <div style={{ fontWeight: 700, marginTop: 6, color: '#00474d' }}>{p.title}</div>
                {p.city ? (
                  <div style={{ fontSize: 12, color: '#3f484a' }}>{p.city}</div>
                ) : null}
                {formatPrice(p.price) ? (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#00629d', marginTop: 4 }}>
                    Từ {formatPrice(p.price)}
                  </div>
                ) : null}
                {navigate ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/attractions/${p.id}`)}
                    style={{
                      marginTop: 8,
                      width: '100%',
                      padding: '6px 0',
                      borderRadius: 8,
                      border: 'none',
                      background: '#00629d',
                      color: '#fff',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Xem chi tiết
                  </button>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
