import { describe, expect, it } from 'vitest'
import {
  RECENTLY_VIEWED_ATTRACTIONS_KEY,
  getRecentlyViewedAttractions,
  saveRecentlyViewedAttraction,
} from './recentlyViewedAttractions.js'

function makeStorage(initialValue = null) {
  const data = new Map()
  if (initialValue !== null) data.set(RECENTLY_VIEWED_ATTRACTIONS_KEY, initialValue)

  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
  }
}

describe('recently viewed attractions', () => {
  it('stores newest attraction first without duplicating ids', () => {
    const storage = makeStorage()

    saveRecentlyViewedAttraction({ id: 'a1', title: 'Bà Nà Hills' }, storage, 100)
    saveRecentlyViewedAttraction({ id: 'a2', title: 'Vịnh Hạ Long' }, storage, 200)
    saveRecentlyViewedAttraction({ id: 'a1', title: 'Bà Nà Hills mới' }, storage, 300)

    expect(getRecentlyViewedAttractions(storage).map((item) => item.id)).toEqual(['a1', 'a2'])
    expect(getRecentlyViewedAttractions(storage)[0]).toMatchObject({
      title: 'Bà Nà Hills mới',
      viewedAt: 300,
    })
  })

  it('keeps at most six valid items', () => {
    const storage = makeStorage()

    Array.from({ length: 8 }).forEach((_, index) => {
      saveRecentlyViewedAttraction(
        { id: `a${index}`, title: `Attraction ${index}` },
        storage,
        index,
      )
    })

    const items = getRecentlyViewedAttractions(storage)
    expect(items).toHaveLength(6)
    expect(items[0].id).toBe('a7')
    expect(items[5].id).toBe('a2')
  })

  it('ignores corrupted storage and invalid attractions', () => {
    const storage = makeStorage('not-json')

    expect(getRecentlyViewedAttractions(storage)).toEqual([])
    expect(saveRecentlyViewedAttraction({ id: '', title: '' }, storage)).toEqual([])
  })
})
