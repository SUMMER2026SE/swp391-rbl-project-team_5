import { useContext } from 'react'
import SocketContext from './socketContextObject.js'

function useSocket() {
  const socket = useContext(SocketContext)

  if (!socket) {
    throw new Error('useSocket must be used inside SocketProvider')
  }

  return socket
}

export default useSocket
