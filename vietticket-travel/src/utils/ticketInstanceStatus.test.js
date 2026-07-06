import { describe, expect, it } from 'vitest'
import {
  getTicketInstanceStatus,
  getTicketInstanceStatusMeta,
  hasUsableTicketInstances,
  isTicketInstanceUsable,
} from './ticketInstanceStatus.js'

describe('ticket instance status helpers', () => {
  it('normalizes ticket instance status safely', () => {
    expect(getTicketInstanceStatus({ status: 'VALID' })).toBe('valid')
    expect(getTicketInstanceStatus({ status: ' used ' })).toBe('used')
    expect(getTicketInstanceStatus(null)).toBe('')
  })

  it('treats only valid ticket instances as usable QR tickets', () => {
    expect(isTicketInstanceUsable({ status: 'valid' })).toBe(true)
    expect(isTicketInstanceUsable({ status: 'used' })).toBe(false)
    expect(hasUsableTicketInstances([{ status: 'used' }, { status: 'VALID' }])).toBe(true)
    expect(hasUsableTicketInstances([{ status: 'used' }, { status: 'refunded' }])).toBe(false)
  })

  it('returns customer-facing metadata for invalid tickets', () => {
    expect(getTicketInstanceStatusMeta({ status: 'USED' })).toMatchObject({
      icon: 'check_circle',
      label: 'Đã sử dụng',
    })
    expect(getTicketInstanceStatusMeta({ status: 'REFUNDED' })).toMatchObject({
      icon: 'price_check',
      label: 'Đã hoàn tiền',
    })
  })
})
