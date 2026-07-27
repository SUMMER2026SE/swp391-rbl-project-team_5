import { describe, expect, it } from 'vitest'
import {
  clearPartyInvite,
  clearPartySession,
  loadPartyInvite,
  loadPartySession,
  savePartyInvite,
  savePartySession,
} from './partySession.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

describe('party scoped session', () => {
  it('stores only the scoped guest token and member metadata per room', () => {
    const storage = memoryStorage()
    const session = savePartySession('room-1', {
      partyToken: 'opaque-token',
      memberId: 'member-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }, storage)

    expect(session.memberId).toBe('member-1')
    expect(loadPartySession('room-1', storage)).toEqual(session)
    expect(loadPartySession('another-room', storage)).toBeNull()

    clearPartySession('room-1', storage)
    expect(loadPartySession('room-1', storage)).toBeNull()
  })

  it('expires a guest session locally instead of reusing stale access', () => {
    const storage = memoryStorage()
    savePartySession('room-1', {
      partyToken: 'expired-token',
      expiresAt: '2000-01-01T00:00:00.000Z',
    }, storage)

    expect(loadPartySession('room-1', storage)).toBeNull()
  })

  it('keeps the host invite separate from guest authorization', () => {
    const storage = memoryStorage()
    savePartyInvite('room-1', 'invite-token', storage)

    expect(loadPartyInvite('room-1', storage)).toBe('invite-token')
    expect(loadPartySession('room-1', storage)).toBeNull()

    clearPartyInvite('room-1', storage)
    expect(loadPartyInvite('room-1', storage)).toBe('')
  })
})
