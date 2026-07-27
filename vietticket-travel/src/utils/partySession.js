const PARTY_SESSION_PREFIX = 'vietticket_party_session_'
const PARTY_INVITE_PREFIX = 'vietticket_party_invite_'

function getStorage() {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function keyForRoom(roomId) {
  return `${PARTY_SESSION_PREFIX}${String(roomId || '')}`
}

export function savePartySession(roomId, session, storage = getStorage()) {
  if (!storage || !roomId || !session?.partyToken) return null
  const value = {
    partyToken: session.partyToken,
    memberId: session.memberId || session.room?.me?.id || null,
    expiresAt: session.expiresAt || null,
  }
  storage.setItem(keyForRoom(roomId), JSON.stringify(value))
  return value
}

export function loadPartySession(roomId, storage = getStorage()) {
  if (!storage || !roomId) return null
  try {
    const value = JSON.parse(storage.getItem(keyForRoom(roomId)) || 'null')
    if (!value?.partyToken) return null
    if (value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now()) {
      storage.removeItem(keyForRoom(roomId))
      return null
    }
    return value
  } catch {
    return null
  }
}

export function clearPartySession(roomId, storage = getStorage()) {
  if (storage && roomId) storage.removeItem(keyForRoom(roomId))
}

export function savePartyInvite(roomId, inviteToken, storage = getStorage()) {
  if (!storage || !roomId || !inviteToken) return ''
  storage.setItem(`${PARTY_INVITE_PREFIX}${roomId}`, String(inviteToken))
  return String(inviteToken)
}

export function loadPartyInvite(roomId, storage = getStorage()) {
  if (!storage || !roomId) return ''
  return storage.getItem(`${PARTY_INVITE_PREFIX}${roomId}`) || ''
}

export function clearPartyInvite(roomId, storage = getStorage()) {
  if (storage && roomId) storage.removeItem(`${PARTY_INVITE_PREFIX}${roomId}`)
}
