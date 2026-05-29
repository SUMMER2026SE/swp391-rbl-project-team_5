import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-toastify/dist/ReactToastify.css'
import './styles/global.css'
import './styles/auth.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
