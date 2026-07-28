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
    // Keep trying while the user is authenticated. A temporary mobile
    // network gap must not permanently disable queue and booking alerts.
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.25,
    timeout: 10000,
    withCredentials: true,
  })
}

export function SocketProvider({ children }) {
  const { isAuthenticated, user } = useAuth()
  const [socket] = useState(createSocket)

  useEffect(() => {
    const shouldConnect = Boolean(isAuthenticated && user?.id)

    function reconnectWhenAvailable() {
      if (shouldConnect && !socket.connected) socket.connect()
    }

    if (shouldConnect) {
      socket.connect()
      window.addEventListener('online', reconnectWhenAvailable)
      document.addEventListener('visibilitychange', reconnectWhenAvailable)
    } else {
      socket.disconnect()
    }

    return () => {
      window.removeEventListener('online', reconnectWhenAvailable)
      document.removeEventListener('visibilitychange', reconnectWhenAvailable)
      socket.disconnect()
    }
  }, [isAuthenticated, socket, user?.id])

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
}
