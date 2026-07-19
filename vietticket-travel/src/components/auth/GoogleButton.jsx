import { useEffect, useRef, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { toast } from 'react-toastify'

function GoogleButton({ onSuccess, onError }) {
  const hasClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
  const wrapperRef = useRef(null)
  const [buttonWidth, setButtonWidth] = useState(320)

  useEffect(() => {
    if (!hasClientId || !wrapperRef.current) return undefined

    const updateButtonWidth = () => {
      const width = wrapperRef.current?.getBoundingClientRect().width || 320
      setButtonWidth(Math.max(240, Math.min(400, Math.floor(width))))
    }

    updateButtonWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateButtonWidth)
      return () => window.removeEventListener('resize', updateButtonWidth)
    }

    const resizeObserver = new ResizeObserver(updateButtonWidth)
    resizeObserver.observe(wrapperRef.current)

    return () => resizeObserver.disconnect()
  }, [hasClientId])

  const handleFallbackClick = () => {
    if (import.meta.env.DEV) {
      toast.warning('[DEV MODE] Vui lòng cấu hình VITE_GOOGLE_CLIENT_ID trong file .env để sử dụng Google Login.')
    } else {
      toast.info('Đăng nhập bằng Google hiện không khả dụng. Vui lòng sử dụng Email và Mật khẩu.')
    }
  }

  if (!hasClientId) {
    return (
      <button 
        className="google-button" 
        type="button"
        onClick={handleFallbackClick}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <span>Đăng nhập với Google</span>
      </button>
    )
  }

  return (
    <div className="google-login-wrapper" ref={wrapperRef}>
      <GoogleLogin
        shape="pill"
        size="large"
        text="continue_with"
        width={String(buttonWidth)}
        onError={onError}
        onSuccess={(credentialResponse) => onSuccess?.(credentialResponse)}
      />
    </div>
  )
}

export default GoogleButton
