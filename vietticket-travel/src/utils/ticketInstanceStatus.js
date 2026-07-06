export function getTicketInstanceStatus(ticket) {
  return String(ticket?.status || '').trim().toLowerCase()
}

export function isTicketInstanceUsable(ticket) {
  return getTicketInstanceStatus(ticket) === 'valid'
}

export function hasUsableTicketInstances(tickets = []) {
  return Array.isArray(tickets) && tickets.some(isTicketInstanceUsable)
}

export function getTicketInstanceStatusMeta(ticket) {
  const status = getTicketInstanceStatus(ticket)

  if (status === 'valid') {
    return {
      icon: 'qr_code_2',
      label: 'Chưa sử dụng',
      className: 'text-primary bg-primary/10',
    }
  }

  if (status === 'used') {
    return {
      icon: 'check_circle',
      label: 'Đã sử dụng',
      className: 'text-on-surface-variant bg-surface-container',
    }
  }

  if (status === 'refunded') {
    return {
      icon: 'price_check',
      label: 'Đã hoàn tiền',
      className: 'text-on-surface-variant bg-surface-container',
    }
  }

  if (status === 'expired') {
    return {
      icon: 'event_busy',
      label: 'Đã hết hạn',
      className: 'text-error bg-error/10',
    }
  }

  if (status === 'cancelled' || status === 'canceled') {
    return {
      icon: 'block',
      label: 'Đã hủy',
      className: 'text-error bg-error/10',
    }
  }

  return {
    icon: 'help',
    label: 'Không khả dụng',
    className: 'text-on-surface-variant bg-surface-container',
  }
}
