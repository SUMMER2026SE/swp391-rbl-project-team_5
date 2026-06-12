import { Link } from 'react-router-dom'

function HeroSection({ content }) {
  return (
    <section className="hero-section section container" id="top">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className="hero-description">{content.description}</p>

          <div className="hero-actions">
            <Link className="button button--secondary button--large" to="/attractions">
              {content.primaryCta}
            </Link>
            <a className="demo-button" href="#steps">
              <span className="demo-button__icon" aria-hidden="true">
                <span className="material-symbols-outlined filled">play_arrow</span>
              </span>
              Xem cách đặt vé
            </a>
          </div>
        </div>

        <div className="hero-visual" aria-label="Ảnh minh họa đặt vé du lịch Việt Nam">
          <div className="hero-image-frame">
            <img src={content.image.src} alt={content.image.alt} loading="lazy" />
          </div>

          <div className="floating-card hero-notification">
            <span className="floating-card__icon material-symbols-outlined" aria-hidden="true">
              {content.notification.icon}
            </span>
            <div>
              <p>{content.notification.label}</p>
              <strong>{content.notification.title}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default HeroSection
