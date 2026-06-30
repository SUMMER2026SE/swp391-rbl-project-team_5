import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { defaultIcon, hasValidLatLng } from './leafletIcon.js'

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

// Bản đồ nhỏ hiển thị vị trí 1 điểm tham quan (trang chi tiết).
export default function LocationMap({ latitude, longitude, title, height = 240 }) {
  if (!hasValidLatLng({ latitude, longitude })) return null
  const pos = [Number(latitude), Number(longitude)]
  const baseLayer = getBaseLayerProps()

  return (
    <div className="overflow-hidden rounded-xl shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
      <MapContainer center={pos} zoom={15} scrollWheelZoom={false} style={{ height, width: '100%' }}>
        <TileLayer attribution={baseLayer.attribution} url={baseLayer.url} />
        <Marker position={pos} icon={defaultIcon}>
          <Popup>{title || 'Vị trí điểm tham quan'}</Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
