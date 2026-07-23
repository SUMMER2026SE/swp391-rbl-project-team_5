import { apiRequest } from './api.js'

function guestOptions(partyToken) {
  return partyToken
    ? { headers: { 'X-Party-Token': partyToken } }
    : {}
}

export function createPartyRoom(payload) {
  return apiRequest('/party/rooms', {
    method: 'POST',
    body: payload,
  })
}

export function listPartyRooms() {
  return apiRequest('/party/rooms', { method: 'GET' })
}

export function joinPartyRoom(roomId, payload) {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    body: payload,
  })
}

export function getPartyRoomSession(roomId, partyToken = '') {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/session`, {
    method: 'GET',
    ...guestOptions(partyToken),
  })
}

export function updatePartyMember(roomId, payload, partyToken = '') {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/me`, {
    method: 'PATCH',
    body: payload,
    ...guestOptions(partyToken),
  })
}

export function votePartyCandidate(roomId, candidateId, value, partyToken = '') {
  return apiRequest(
    `/party/rooms/${encodeURIComponent(roomId)}/candidates/${encodeURIComponent(candidateId)}/vote`,
    {
      method: 'PUT',
      body: { value },
      ...guestOptions(partyToken),
    },
  )
}

export function clearPartyCandidateVote(roomId, candidateId, partyToken = '') {
  return apiRequest(
    `/party/rooms/${encodeURIComponent(roomId)}/candidates/${encodeURIComponent(candidateId)}/vote`,
    {
      method: 'DELETE',
      ...guestOptions(partyToken),
    },
  )
}

export function finalizePartyRoom(roomId) {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/finalize`, {
    method: 'POST',
  })
}

export function reopenPartyRoom(roomId) {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/reopen`, {
    method: 'POST',
  })
}

export function rotatePartyInvite(roomId) {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/invite/rotate`, {
    method: 'POST',
  })
}

export function removePartyMember(roomId, memberId) {
  return apiRequest(
    `/party/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'DELETE' },
  )
}

export function closePartyRoom(roomId) {
  return apiRequest(`/party/rooms/${encodeURIComponent(roomId)}/close`, {
    method: 'POST',
  })
}
