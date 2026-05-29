function Testimonials({ testimonials, partners }) {
  return (
    <>
      <section className="section container testimonials-section">
        <div className="testimonials-layout">
          <div className="testimonials-intro">
            <p className="eyebrow">Ý kiến khách hàng</p>
            <h2>Khách du lịch nói gì về chúng tôi.</h2>
            <div className="testimonial-dots" aria-hidden="true">
              {testimonials.map((testimonial, index) => (
                <span
                  className={index === 0 ? 'testimonial-dots__active' : ''}
                  key={testimonial.name}
                ></span>
              ))}
            </div>
          </div>

          <div className="testimonial-list">
            {testimonials.map((testimonial, index) => (
              <article
                className={`testimonial-card${
                  index === 0 ? ' testimonial-card--featured' : ''
                }`}
                key={testimonial.name}
              >
                <img
                  src={testimonial.avatar}
                  alt={`Ảnh đại diện của ${testimonial.name}`}
                />
                <blockquote>
                  <p>"{testimonial.quote}"</p>
                </blockquote>
                <h3>{testimonial.name}</h3>
                <p>{testimonial.location}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="partners-band" aria-label="Đối tác du lịch">
        <div className="container partners-list">
          {partners.map((partner) => (
            <span key={partner}>{partner}</span>
          ))}
        </div>
      </section>
    </>
  )
}

export default Testimonials
