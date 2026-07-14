function BookingSteps({ steps = [], preview = {} }) {
  const previewImage = preview?.image || {}
  const previewMeta = Array.isArray(preview?.meta) ? preview.meta : []
  const previewTools = Array.isArray(preview?.tools) ? preview.tools : []

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
            {previewImage.src ? (
              <img src={previewImage.src} alt={previewImage.alt || preview.title || 'Xem trước đặt vé'} />
            ) : null}
            <div className="booking-card__content">
              <h3>{preview.title}</h3>
              <div className="booking-card__meta">
                {previewMeta.map((item, index) => (
                  <span key={`meta-${index}`}>{item}</span>
                ))}
              </div>
              <div className="booking-card__tools" aria-label="Tiện ích chuyến đi">
                {previewTools.map((tool, index) => (
                  <span className="material-symbols-outlined" key={`${tool}-${index}`} aria-hidden="true">
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
