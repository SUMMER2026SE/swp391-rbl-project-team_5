import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { API_BASE_URL } from '../services/api.js'
import { useAuth } from '../context/useAuth.js'
import useSocket from '../context/useSocket.js'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api\/?$/, '')

const PARTY_EVENTS = [
  'PARTY_MEMBER_JOINED',
  'PARTY_MEMBER_UPDATED',
  'PARTY_VOTE_UPDATED',
  'PARTY_ROOM_UPDATED',
  'PARTY_PLAN_FINALIZED',
  'PARTY_ACCESS_REVOKED',
]

export default function usePartyRoomSocket({
  roomId,
  partyToken,
  onUpdate,
  onRevoked,
}) {
  const { isAuthenticated } = useAuth()
  const authenticatedSocket = useSocket()
  const callbackRef = useRef(onUpdate)
  const revokedRef = useRef(onRevoked)
  const [connectionState, setConnectionState] = useState(
    isAuthenticated || partyToken ? 'connecting' : 'idle',
  )

  useEffect(() => {
    callbackRef.current = onUpdate
    revokedRef.current = onRevoked
  }, [onRevoked, onUpdate])

  useEffect(() => {
    if (!roomId) return undefined
    let socket = authenticatedSocket
    let ownsSocket = false

    if (partyToken) {
      socket = io(SOCKET_URL, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 5,
        auth: { partyToken },
      })
      ownsSocket = true
    }
    if (!isAuthenticated && !partyToken) {
      return undefined
    }

    const handleConnect = () => {
      setConnectionState('connected')
      if (isAuthenticated && !partyToken) socket.emit('JOIN_PARTY_ROOM', roomId)
    }
    const handleDisconnect = () => setConnectionState('disconnected')
    const handleConnectError = () => setConnectionState('error')
    const partyHandlers = Object.fromEntries(
      PARTY_EVENTS.map((eventName) => [
        eventName,
        (payload) => {
          if (payload?.roomId !== roomId) return
          if (eventName === 'PARTY_ACCESS_REVOKED') revokedRef.current?.(payload)
          callbackRef.current?.({ ...payload, eventName })
        },
      ]),
    )
    const handleRevoked = (payload) => {
      revokedRef.current?.(payload)
      setConnectionState('revoked')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('AUTHORIZATION_REVOKED', handleRevoked)
    PARTY_EVENTS.forEach((eventName) => socket.on(eventName, partyHandlers[eventName]))

    if (socket.connected) handleConnect()
    else socket.connect()

    return () => {
      if (isAuthenticated && !partyToken) socket.emit('LEAVE_PARTY_ROOM', roomId)
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      socket.off('AUTHORIZATION_REVOKED', handleRevoked)
      PARTY_EVENTS.forEach((eventName) => socket.off(eventName, partyHandlers[eventName]))
      if (ownsSocket) socket.disconnect()
    }
  }, [authenticatedSocket, isAuthenticated, partyToken, roomId])

  return connectionState
}
