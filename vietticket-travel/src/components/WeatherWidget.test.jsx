import { describe, expect, it } from 'vitest'
import { isIndoorOnly } from '../utils/weather.js'

describe('isIndoorOnly', () => {
  it('ẩn thời tiết khi mọi danh mục đều là bảo tàng', () => {
    expect(isIndoorOnly([{ name: 'Museum' }])).toBe(true)
    expect(isIndoorOnly([{ name: 'Bảo tàng' }, { name: 'MUSEUM' }])).toBe(true)
  })

  it('vẫn hiện khi có bất kỳ danh mục ngoài trời nào', () => {
    expect(isIndoorOnly([{ name: 'Museum' }, { name: 'Nature & Sightseeing' }])).toBe(false)
    expect(isIndoorOnly([{ name: 'Theme Park & Resort' }])).toBe(false)
    expect(isIndoorOnly([{ name: 'Cultural Experience' }])).toBe(false)
  })

  it('không ẩn khi thiếu/không có danh mục', () => {
    expect(isIndoorOnly([])).toBe(false)
    expect(isIndoorOnly(undefined)).toBe(false)
    expect(isIndoorOnly(null)).toBe(false)
  })
})
