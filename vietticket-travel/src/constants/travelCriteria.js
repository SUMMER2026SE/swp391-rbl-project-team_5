// ============================================================
// travelCriteria.js
// ------------------------------------------------------------
// Tùy chọn tiêu chí dùng chung cho 2 tính năng AI:
//   - Gợi ý địa điểm (AIRecommendSection)
//   - Tạo kế hoạch tham quan (AIItineraryPlanner)
//
// `value` của loại hình khớp đúng tên Category thật trong DB để
// backend lọc chính xác. `interests` gửi lên API là chuỗi các
// value nối bằng dấu phẩy.
// ============================================================

export const CATEGORY_OPTIONS = [
  { value: 'Nature & Sightseeing', label: 'Thiên nhiên & Ngắm cảnh' },
  { value: 'Cultural Experience', label: 'Văn hóa' },
  { value: 'Museum', label: 'Bảo tàng' },
  { value: 'Adventure', label: 'Mạo hiểm' },
  { value: 'Theme Park & Resort', label: 'Công viên & Nghỉ dưỡng' },
  { value: 'Amusement Park', label: 'Khu vui chơi' },
]

export const PACE_OPTIONS = [
  { value: 'relaxed', label: 'Thư giãn', hint: '1-2 điểm/ngày' },
  { value: 'normal', label: 'Vừa phải', hint: '2-3 điểm/ngày' },
  { value: 'packed', label: 'Dày đặc', hint: '3-4 điểm/ngày' },
]

export const PRIORITY_OPTIONS = [
  { value: 'balanced', label: 'Cân bằng' },
  { value: 'rating', label: 'Đánh giá cao' },
  { value: 'budget', label: 'Tiết kiệm' },
]

export const COMPANION_OPTIONS = [
  { value: 'solo', label: 'Một mình' },
  { value: 'couple', label: 'Cặp đôi' },
  { value: 'family', label: 'Gia đình có trẻ' },
  { value: 'friends', label: 'Nhóm bạn' },
]

// Nối danh sách value loại hình đã chọn thành chuỗi gửi lên API.
export function interestsToParam(selected) {
  return Array.isArray(selected) && selected.length > 0 ? selected.join(', ') : undefined
}
