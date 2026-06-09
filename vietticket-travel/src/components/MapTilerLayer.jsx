import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'

// Lớp nền bản đồ dùng vector tiles của MapTiler, ép nhãn sang tiếng Việt.
// Render bên trong <MapContainer> thay cho <TileLayer>; marker/popup của
// react-leaflet vẫn hoạt động bình thường vì nằm ở lớp overlay phía trên.
export default function MapTilerLayer({ apiKey, mapStyle = 'streets-v2', language = 'vi' }) {
  const map = useMap()

  useEffect(() => {
    if (!apiKey || typeof L.maplibreGL !== 'function') return undefined

    const glLayer = L.maplibreGL({
      style: `https://api.maptiler.com/maps/${mapStyle}/style.json?key=${apiKey}`,
    })
    glLayer.addTo(map)

    const glMap = glLayer.getMaplibreMap()

    // Đổi text-field của mọi lớp nhãn sang "name:vi", fallback "name".
    const applyLanguage = () => {
      const style = glMap.getStyle()
      if (!style || !style.layers) return
      for (const layer of style.layers) {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
          try {
            glMap.setLayoutProperty(layer.id, 'text-field', [
              'coalesce',
              ['get', `name:${language}`],
              ['get', 'name:latin'],
              ['get', 'name'],
            ])
          } catch {
            // bỏ qua lớp không cho đổi
          }
        }
      }
    }

    glMap.on('styledata', applyLanguage)
    if (glMap.isStyleLoaded && glMap.isStyleLoaded()) applyLanguage()

    return () => {
      glMap.off('styledata', applyLanguage)
      glLayer.remove()
    }
  }, [map, apiKey, mapStyle, language])

  return null
}
