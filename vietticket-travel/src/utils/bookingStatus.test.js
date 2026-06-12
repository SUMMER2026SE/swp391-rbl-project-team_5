import { describe, expect, it } from 'vitest'
import { getBookingStatusMeta, REFUND_STATUS_META } from './bookingStatus'

describe('booking status metadata', () => {
  it('supports backend enum casing and aliases', () => {
    expect(getBookingStatusMeta('NO_SHOW').label).toBe('Không đến sử dụng')
    expect(getBookingStatusMeta('unpaid').label).toBe('Chờ thanh toán')
  })

  it('exposes the refund processing state', () => {
    expect(REFUND_STATUS_META.PROCESSING.label).toBe('Đang xử lý hoàn tiền')
  })
})
