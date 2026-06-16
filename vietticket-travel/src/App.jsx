import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { ToastContainer } from 'react-toastify'
import { AuthProvider } from './context/AuthContext.jsx'
import { SocketProvider } from './context/SocketContext.jsx'
import AppRoutes from './routes/AppRoutes.jsx'
import ChatbotWidget from './components/ChatbotWidget.jsx'

function App() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'missing-google-client-id'

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <AuthProvider>
          <SocketProvider>
            <AppRoutes />
            <ChatbotWidget />
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
    </GoogleOAuthProvider>
  )
}

export default App
