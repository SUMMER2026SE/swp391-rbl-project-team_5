function BookingSteps({ steps, preview }) {
  return (
    <section className="section container" id="steps">
      <div className="booking-grid">
        <div className="booking-copy">
          <p className="eyebrow">Dễ dàng và nhanh chóng</p>
          <h2>Đặt vé tham quan Việt Nam chỉ với 3 bước đơn giản</h2>

          <div className="steps-list">
            {steps.map((step) => (
              <article className="step-item" key={step.title}>
                <div className={`step-icon step-icon--${step.tone}`}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {step.icon}
                  </span>
                </div>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="booking-preview" aria-label="Xem trước tiến trình đặt vé">
          <article className="booking-card">
            <img src={preview.image.src} alt={preview.image.alt} />
            <div className="booking-card__content">
              <h3>{preview.title}</h3>
              <div className="booking-card__meta">
                {preview.meta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <div className="booking-card__tools" aria-label="Tiện ích chuyến đi">
                {preview.tools.map((tool) => (
                  <span className="material-symbols-outlined" key={tool} aria-hidden="true">
                    {tool}
                  </span>
                ))}
              </div>
              <div className="booking-card__footer">
                <div className="traveler-stack" aria-hidden="true">
                  <span></span>
                  <span></span>
                </div>
                <span className="material-symbols-outlined filled favorite" aria-hidden="true">
                  favorite
                </span>
              </div>
            </div>
          </article>

          <div className="floating-card progress-card">
            <div className="progress-card__header">
              <span className="material-symbols-outlined" aria-hidden="true">
                check_circle
              </span>
              <div>
                <strong>{preview.progressLabel}</strong>
                <p>{preview.progressStatus}</p>
              </div>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default BookingSteps
