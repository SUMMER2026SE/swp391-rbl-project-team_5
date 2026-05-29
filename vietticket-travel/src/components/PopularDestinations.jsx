function PopularDestinations({ destinations }) {
  return (
    <section className="section section--muted" id="destinations">
      <div className="container">
        <div className="section-heading text-center">
          <p className="eyebrow">Bán chạy nhất</p>
          <h2>Các điểm tham quan hàng đầu tại Việt Nam</h2>
        </div>

        <div className="destination-grid">
          {destinations.map((destination) => (
            <article className="destination-card" key={destination.title}>
              <div className="destination-card__media">
                <img src={destination.image.src} alt={destination.image.alt} />
                <span>{destination.location}</span>
              </div>

              <div className="destination-card__body">
                <div className="destination-card__title-row">
                  <h3>{destination.title}</h3>
                  <p>{destination.price}</p>
                </div>
                <div className="destination-card__meta">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    near_me
                  </span>
                  <span>{destination.duration}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default PopularDestinations
