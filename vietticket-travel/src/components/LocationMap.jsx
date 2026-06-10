import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { defaultIcon, hasValidLatLng } from './leafletIcon.js'
import MapTilerLayer from './MapTilerLayer.jsx'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

// Bản đồ nhỏ hiển thị vị trí 1 điểm tham quan (trang chi tiết).
export default function LocationMap({ latitude, longitude, title, height = 240 }) {
  if (!hasValidLatLng({ latitude, longitude })) return null
  const pos = [Number(latitude), Number(longitude)]

  return (
    <div className="overflow-hidden rounded-xl shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
      <MapContainer center={pos} zoom={15} scrollWheelZoom={false} style={{ height, width: '100%' }}>
        {MAPTILER_KEY ? (
          <MapTilerLayer apiKey={MAPTILER_KEY} />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}
        <Marker position={pos} icon={defaultIcon}>
          <Popup>{title || 'Vị trí điểm tham quan'}</Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
