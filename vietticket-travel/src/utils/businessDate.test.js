import { describe, expect, it } from 'vitest'
import { getVietnamDateInput } from './businessDate'

describe('getVietnamDateInput', () => {
  it('uses the Vietnam business day even when the browser timezone differs', () => {
    const now = new Date('2026-07-19T18:00:00.000Z') // 20/07 in Vietnam

    expect(getVietnamDateInput(0, now)).toBe('2026-07-20')
    expect(getVietnamDateInput(1, now)).toBe('2026-07-21')
  })
})
