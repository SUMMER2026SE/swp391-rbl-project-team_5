import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { API_BASE_URL } from '../services/api.js'
import SocketContext from './socketContextObject.js'
import { useAuth } from './useAuth.js'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api\/?$/, '')

function createSocket() {
  return io(SOCKET_URL, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    withCredentials: true,
  })
}

export function SocketProvider({ children }) {
  const { isAuthenticated, user } = useAuth()
  const [socket] = useState(createSocket)

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      socket.connect()
    } else {
      socket.disconnect()
    }

    return () => {
      socket.disconnect()
    }
  }, [isAuthenticated, socket, user?.id])

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
}
