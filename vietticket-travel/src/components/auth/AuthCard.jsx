import { Link } from 'react-router-dom'

function AuthCard({ title, description, children, footer }) {
  return (
    <article className="auth-card">
      <Link className="auth-brand" to="/">
        <span className="material-symbols-outlined filled" aria-hidden="true">
          travel
        </span>
        VietTicket Travel
      </Link>

      <div className="auth-card__heading">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>

      {children}

      {footer ? <div className="auth-card__footer">{footer}</div> : null}
    </article>
  )
}

export default AuthCard
