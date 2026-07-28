const LIVE_OPERATION_ALERTS = {
  QUEUE_READY: {
    title: 'SmartQueue: đã đến lượt vào cổng',
    message: 'Hãy mở Live Trip và di chuyển đến cổng VietTicket trong thời gian hiển thị.',
    toastType: 'success',
    urgent: true,
  },
  QUEUE_ADMITTED: {
    title: 'SmartQueue đã check-in',
    message: 'Mã QR đã được xác nhận và lượt vào cổng đã hoàn tất.',
    toastType: 'success',
    urgent: false,
  },
  QUEUE_PAUSED: {
    title: 'SmartQueue tạm dừng',
    message: 'Thứ tự và cửa sổ quay lại của bạn đang được bảo lưu trong giới hạn giờ vé.',
    toastType: 'warning',
    urgent: true,
  },
  QUEUE_RESUMED: {
    title: 'SmartQueue hoạt động trở lại',
    message: 'Hãy kiểm tra Live Trip để xem thời gian quay lại đã được cập nhật.',
    toastType: 'info',
    urgent: true,
  },
  QUEUE_NO_SHOW: {
    title: 'SmartQueue đã đóng lượt',
    message: 'Cửa sổ quay lại đã kết thúc và lượt của bạn được ghi nhận là no-show.',
    toastType: 'warning',
    urgent: true,
  },
  QUEUE_EXPIRED: {
    title: 'SmartQueue đã hết hiệu lực',
    message: 'Khung giờ tham quan đã kết thúc nên lượt xếp hàng được đóng tự động.',
    toastType: 'warning',
    urgent: true,
  },
  QUEUE_BOOKING_INVALIDATED: {
    title: 'Lượt SmartQueue đã bị đóng',
    message: 'Booking không còn ở trạng thái xác nhận nên quyền lợi hàng chờ không còn hiệu lực.',
    toastType: 'error',
    urgent: true,
  },
  QUEUE_CANCELLED: {
    title: 'Đã rời SmartQueue',
    message: 'Lượt xếp hàng đã được hủy và sẽ không còn giữ vị trí tại cổng.',
    toastType: 'info',
    urgent: false,
  },
  QUEUE_JOINED: {
    title: 'Đã vào SmartQueue',
    message: 'Vị trí của bạn đã được ghi nhận. Live Trip sẽ cập nhật khi hàng chờ thay đổi.',
    toastType: 'info',
    urgent: false,
  },
  AUTOPILOT_PROPOSED: {
    title: 'Autopilot có đề xuất mới',
    message: 'Đề xuất chỉ thay đổi kế hoạch sau khi bạn xác nhận; booking không bị tự động sửa.',
    toastType: 'info',
    urgent: false,
  },
  AUTOPILOT_EXPIRED: {
    title: 'Đề xuất Autopilot đã hết hạn',
    message: 'Thời gian quyết định đã kết thúc; hãy mở Live Trip để xem phương án hiện tại.',
    toastType: 'warning',
    urgent: true,
  },
  AUTOPILOT_ACCEPTED: {
    title: 'Đã áp dụng đề xuất Autopilot',
    message: 'Lịch trình đã được cập nhật theo lựa chọn của bạn.',
    toastType: 'success',
    urgent: false,
  },
  AUTOPILOT_REJECTED: {
    title: 'Đã giữ lịch trình hiện tại',
    message: 'Đề xuất Autopilot đã bị từ chối; booking của bạn không bị tự động thay đổi.',
    toastType: 'info',
    urgent: false,
  },
  ITEM_AT_RISK: {
    title: 'Một hoạt động đang có rủi ro',
    message: 'Điều kiện vận hành đã thay đổi. Mở Live Trip để xem phân tích và phương án cần xác nhận.',
    toastType: 'error',
    urgent: true,
  },
  ITEM_RECOVERED: {
    title: 'Điều kiện tham quan đã ổn định',
    message: 'Hoạt động có thể tiếp tục theo lịch hiện tại; hãy kiểm tra Live Trip để xác nhận.',
    toastType: 'success',
    urgent: false,
  },
  ITEM_COMPLETED: {
    title: 'Hoạt động đã hoàn thành',
    message: 'Check-in đã được đồng bộ vào hành trình trực tiếp.',
    toastType: 'success',
    urgent: false,
  },
  ITEM_SKIPPED: {
    title: 'Hoạt động đã được bỏ qua',
    message: 'Khung giờ đã kết thúc và trạng thái đã được lưu trong lịch sử hành trình.',
    toastType: 'info',
    urgent: false,
  },
}

export function getLiveOperationAlert(payload) {
  const reason = String(payload?.reason || '').toUpperCase()
  const definition = LIVE_OPERATION_ALERTS[reason]
  if (!definition || !payload?.tripId) return null
  return {
    ...definition,
    reason,
    tripId: String(payload.tripId),
    itemId: payload.itemId ? String(payload.itemId) : null,
    href: `/trip-mode/${encodeURIComponent(payload.tripId)}`,
    tag: `vietticket-live:${payload.tripId}:${payload.itemId || 'trip'}:${reason}`,
  }
}
