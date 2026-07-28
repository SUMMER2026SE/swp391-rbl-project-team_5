import { describe, expect, it } from 'vitest'
import {
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
