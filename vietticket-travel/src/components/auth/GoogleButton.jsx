import { GoogleLogin } from '@react-oauth/google'

function GoogleButton({ onSuccess, onError }) {
  const hasClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)

  if (!hasClientId) {
    return (
      <button className="google-button" type="button" disabled>
        <span>Google Login cần VITE_GOOGLE_CLIENT_ID</span>
      </button>
    )
  }

  return (
    <div className="google-login-wrapper">
      <GoogleLogin
        shape="pill"
        size="large"
        text="continue_with"
        width="100%"
        onError={onError}
        onSuccess={(credentialResponse) => onSuccess?.(credentialResponse)}
      />
    </div>
  )
}

export default GoogleButton
