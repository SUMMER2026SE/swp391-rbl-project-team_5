import { Link } from 'react-router-dom'

function AuthLayout({
  children,
  visualTitle,
  visualDescription,
  visualImage,
  visualAlt,
  compact = false,
}) {
  return (
    <main className={`auth-shell${compact ? ' auth-shell--compact' : ''}`}>
      <section className="auth-visual" aria-label="Cảm hứng du lịch Việt Nam">
        <img src={visualImage} alt={visualAlt} />
        <div className="auth-visual__overlay"></div>
        <div className="auth-visual__content">
          <Link className="auth-brand auth-brand--light" to="/">
            <span className="material-symbols-outlined filled" aria-hidden="true">
              travel
            </span>
            VietTicket Travel
          </Link>
          <div>
            <h1>{visualTitle}</h1>
            <p>{visualDescription}</p>
          </div>
          <div className="auth-visual__pill">
            <span className="material-symbols-outlined filled" aria-hidden="true">
              verified
            </span>
            <span>Được tin dùng bởi du khách khám phá Việt Nam</span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">{children}</div>
      </section>
    </main>
  )
}

export default AuthLayout
