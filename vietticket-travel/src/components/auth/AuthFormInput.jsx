function AuthFormInput({
  id,
  label,
  icon,
  error,
  className = '',
  wrapperClassName = '',
  ...inputProps
}) {
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className={`auth-field ${wrapperClassName}`}>
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input ${error ? 'auth-input--error' : ''} ${className}`}>
        {icon ? (
          <span className="material-symbols-outlined" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <input
          id={id}
          aria-describedby={errorId}
          aria-invalid={Boolean(error)}
          {...inputProps}
        />
      </div>
      {error ? (
        <p className="auth-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default AuthFormInput
