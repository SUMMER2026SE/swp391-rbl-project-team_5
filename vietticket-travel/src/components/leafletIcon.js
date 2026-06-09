// Cấu hình icon marker mặc định cho Leaflet.
// Leaflet không tự tìm được ảnh marker khi bundle bằng Vite, nên ta
// import trực tiếp để Vite đóng gói (không phụ thuộc CDN ngoài).
import L from 'leaflet'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

export const defaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

// Lọc ra các điểm có toạ độ hợp lệ.
export const hasValidLatLng = (item) =>
  Number.isFinite(Number(item?.latitude)) && Number.isFinite(Number(item?.longitude))
