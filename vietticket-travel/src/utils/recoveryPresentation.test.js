import { describe, expect, it } from 'vitest'
import {
  getCountdownState,
  getRecoveryRefundStage,
  getRecoveryResolutionContent,
  sortRecoveryCases,
} from './recoveryPresentation.js'

describe('recovery presentation', () => {
  it('prioritizes the open case with the nearest deadline', () => {
    const sorted = sortRecoveryCases([
      { id: 'history', status: 'REPLACED', createdAt: '2026-07-28T08:00:00Z' },
      { id: 'later', status: 'OPEN', expiresAt: '2026-07-28T09:30:00Z' },
      { id: 'urgent', status: 'OPEN', expiresAt: '2026-07-28T09:10:00Z' },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['urgent', 'later', 'history'])
  })

  it('đẩy case OPEN thiếu hạn chót xuống dưới case sắp hết hạn', () => {
    const sorted = sortRecoveryCases([
      { id: 'no-deadline', status: 'OPEN' },
      { id: 'urgent', status: 'OPEN', expiresAt: '2026-07-28T09:10:00Z' },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['urgent', 'no-deadline'])
  })

  it('không để hạn chót hỏng chiếm mất vị trí khẩn cấp nhất', () => {
    const sorted = sortRecoveryCases([
      { id: 'broken', status: 'OPEN', expiresAt: 'không-phải-ngày' },
      { id: 'urgent', status: 'OPEN', expiresAt: '2026-07-28T09:10:00Z' },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['urgent', 'broken'])
  })

  it('does not describe a completed refund as still processing', () => {
    const content = getRecoveryResolutionContent({
      status: 'REFUNDED',
      refundAmount: 520000,
    })

    expect(content.tone).toBe('completed')
    expect(content.title).toContain('đã được xác nhận')
    expect(content.title).not.toContain('đang được xử lý')
  })

  it('distinguishes safe reconciliation from a confirmed refund', () => {
    expect(getRecoveryRefundStage({
      status: 'REFUND_PENDING',
      refundProgress: {
        status: 'PROCESSING',
        transaction: { status: 'NEEDS_RECONCILIATION' },
      },
    })).toBe('RECONCILING')

    expect(getRecoveryRefundStage({
      status: 'REFUNDED',
      refundProgress: {
        status: 'APPROVED',
        transaction: { status: 'SUCCESS' },
      },
    })).toBe('CONFIRMED')
  })
})

describe('getCountdownState', () => {
  const now = new Date('2026-07-28T09:00:00Z').getTime()

  it('đếm ngược đúng khi còn hạn', () => {
    const state = getCountdownState('2026-07-28T09:05:30Z', now)
    expect(state).toMatchObject({ hasDeadline: true, expired: false, label: '05:30' })
  })

  it('hết hạn thật thì khoá thao tác', () => {
    const state = getCountdownState('2026-07-28T08:59:00Z', now)
    expect(state).toMatchObject({ expired: true, label: '00:00' })
  })

  it('thiếu hạn chót KHÔNG được coi là hết hạn — nếu không khách bị khoá nút', () => {
    for (const value of [null, undefined, '']) {
      const state = getCountdownState(value, now)
      expect(state.hasDeadline).toBe(false)
      expect(state.expired).toBe(false)
      expect(state.label).toBe('--:--')
    }
  })

  it('hạn chót hỏng cũng không được kết luận là hết hạn', () => {
    const state = getCountdownState('không-phải-ngày', now)
    expect(state.hasDeadline).toBe(false)
    expect(state.expired).toBe(false)
  })
})
