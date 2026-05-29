import { useState } from 'react'

function PasswordInput({ id, label, icon = 'lock', error, ...inputProps }) {
  const [isVisible, setIsVisible] = useState(false)
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input auth-input--password ${error ? 'auth-input--error' : ''}`}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
        <input
          id={id}
          type={isVisible ? 'text' : 'password'}
          aria-describedby={errorId}
          aria-invalid={Boolean(error)}
          {...inputProps}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={isVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          onClick={() => setIsVisible((current) => !current)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {isVisible ? 'visibility_off' : 'visibility'}
          </span>
        </button>
      </div>
      {error ? (
        <p className="auth-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default PasswordInput
