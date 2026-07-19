import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { ToastContainer } from 'react-toastify'
import { AuthProvider } from './context/AuthContext.jsx'
import { SocketProvider } from './context/SocketContext.jsx'
import { useLocation } from 'react-router-dom'
import AppRoutes from './routes/AppRoutes.jsx'
import ChatbotWidget from './components/ChatbotWidget.jsx'

function ChatbotWithRouteCheck() {
  const location = useLocation()
  const isHiddenRoute =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/partner') ||
    location.pathname.startsWith('/staff')
  
  if (isHiddenRoute) return null
  return <ChatbotWidget />
}

function App() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const app = (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <AppRoutes />
          <ChatbotWithRouteCheck />
          <ToastContainer
            autoClose={2600}
            closeOnClick
            draggable
            newestOnTop
            pauseOnHover
            position="top-right"
            theme="light"
          />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  )

  if (!googleClientId) {
    return app
  }

  return <GoogleOAuthProvider clientId={googleClientId}>{app}</GoogleOAuthProvider>
}

export default App
