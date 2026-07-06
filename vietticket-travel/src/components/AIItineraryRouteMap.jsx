import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getItineraryMapPoints } from '../utils/aiItineraryMap.js'
import { defaultIcon } from './leafletIcon.js'

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

function FitMapToPoints({ positions }) {
  const map = useMap()

  useEffect(() => {
    if (positions.length === 0) return
    if (positions.length === 1) {
      map.setView(positions[0], 13)
      return
    }

    map.fitBounds(positions, { padding: [24, 24] })
  }, [map, positions])

  return null
}

export default function AIItineraryRouteMap({ activities, height = 220 }) {
  const points = useMemo(() => getItineraryMapPoints(activities), [activities])
  if (points.length === 0) return null

  const positions = points.map((point) => point.position)
  const baseLayer = getBaseLayerProps()

  return (
    <div className="overflow-hidden rounded-2xl border border-[#dbe4e8] bg-white shadow-sm">
      <MapContainer
        center={positions[0]}
        scrollWheelZoom={false}
        style={{ height, width: '100%' }}
        zoom={points.length > 1 ? 12 : 13}
      >
        <TileLayer attribution={baseLayer.attribution} url={baseLayer.url} />
        {positions.length > 1 && (
          <Polyline color="#006068" opacity={0.75} positions={positions} weight={4} />
        )}
        {points.map((point, index) => (
          <Marker icon={defaultIcon} key={point.id} position={point.position}>
            <Popup>
              <strong>{index + 1}. {point.title}</strong>
              {point.time ? <div>{point.time}</div> : null}
            </Popup>
          </Marker>
        ))}
        <FitMapToPoints positions={positions} />
      </MapContainer>
    </div>
  )
}
