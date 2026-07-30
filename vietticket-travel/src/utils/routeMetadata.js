const PUBLIC_EXACT_ROUTES = new Set([
  '/',
  '/about',
  '/attractions',
  '/faq',
  '/privacy',
  '/terms',
])

const PUBLIC_ROUTE_PATTERNS = [
  /^\/attractions\/[^/]+$/,
]

const FALLBACK_TITLES = new Map([
  ['/favorites', 'Địa điểm yêu thích | VietTicket Travel'],
  ['/my-tickets', 'Vé của tôi | VietTicket Travel'],
  ['/support', 'Trung tâm hỗ trợ | VietTicket Travel'],
  ['/my-support', 'Yêu cầu hỗ trợ của tôi | VietTicket Travel'],
  ['/booking-success', 'Kết quả đặt vé | VietTicket Travel'],
  ['/admin', 'Tổng quan hệ thống | VietTicket Admin'],
  ['/admin/users', 'Quản lý người dùng | VietTicket Admin'],
  ['/admin/reports', 'Báo cáo tài chính | VietTicket Admin'],
  ['/admin/kyc-approval', 'Hồ sơ và trạng thái đối tác | VietTicket Admin'],
  ['/admin/attraction-approval', 'Phê duyệt địa điểm | VietTicket Admin'],
  ['/admin/violations', 'Quản lý vi phạm | VietTicket Admin'],
  ['/admin/categories', 'Danh mục du lịch | VietTicket Admin'],
  ['/admin/vouchers', 'Quản lý voucher | VietTicket Admin'],
  ['/admin/audit-logs', 'Nhật ký kiểm toán | VietTicket Admin'],
  ['/admin/settlements', 'Đối soát đối tác | VietTicket Admin'],
  ['/partner/settlements', 'Đối soát và chi trả | VietTicket B2B'],
  ['/partner/smart-queue', 'SmartQueue & Autopilot | VietTicket B2B'],
  ['/partner/dynamic-pricing', 'Giá vé linh hoạt | VietTicket B2B'],
  ['/partner/questions', 'Hỏi đáp du khách | VietTicket B2B'],
  ['/staff/smart-queue', 'SmartQueue Control Tower | VietTicket Staff'],
  ['/staff/refunds', 'Quản lý hoàn tiền | VietTicket Staff'],
  ['/staff/tickets', 'Hỗ trợ khách hàng | VietTicket Staff'],
  ['/staff/reports', 'Báo cáo tài chính | VietTicket Staff'],
])

const FALLBACK_TITLE_PATTERNS = [
  [/^\/checkout\/[^/]+$/, 'Thanh toán đặt vé | VietTicket Travel'],
  [/^\/itinerary-checkout\/[^/]+$/, 'Thanh toán lịch trình AI | VietTicket Travel'],
  [/^\/tickets\/[^/]+$/, 'Vé điện tử | VietTicket Travel'],
  [/^\/trip-mode\/[^/]+$/, 'Chế độ đồng hành trực tiếp | VietTicket Travel'],
]

function normalizePathname(pathname) {
  const value = String(pathname || '/').split(/[?#]/, 1)[0] || '/'
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

export function isPublicIndexableRoute(pathname) {
  const normalizedPathname = normalizePathname(pathname)
  return (
    PUBLIC_EXACT_ROUTES.has(normalizedPathname) ||
    PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(normalizedPathname))
  )
}

export function getRouteRobots(pathname) {
  return isPublicIndexableRoute(pathname) ? 'index,follow' : 'noindex,nofollow'
}

export function getFallbackRouteTitle(pathname) {
  const normalizedPathname = normalizePathname(pathname)
  const exactTitle = FALLBACK_TITLES.get(normalizedPathname)
  if (exactTitle) return exactTitle

  return FALLBACK_TITLE_PATTERNS.find(([pattern]) => pattern.test(normalizedPathname))?.[1] || ''
}
