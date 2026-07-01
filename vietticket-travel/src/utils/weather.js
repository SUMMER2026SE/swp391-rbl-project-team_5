// Tiện ích hiển thị thời tiết dùng chung cho WeatherWidget.

// Điểm thuần trong nhà (mọi danh mục đều là bảo tàng) -> thời tiết ít liên quan,
// nên ẩn widget. Điểm có bất kỳ danh mục ngoài trời nào vẫn hiển thị bình thường.
const INDOOR_ONLY_CATEGORIES = new Set(['museum', 'bảo tàng'])

export function isIndoorOnly(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return false
  return categories.every((category) =>
    INDOOR_ONLY_CATEGORIES.has(String(category?.name || '').trim().toLowerCase()),
  )
}
