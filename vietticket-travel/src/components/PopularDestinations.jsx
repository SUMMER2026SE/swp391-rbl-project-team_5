import { Link } from 'react-router-dom'

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
            <Link
              to={`/attractions?search=${encodeURIComponent(destination.title)}`}
              className="destination-card block transition hover:-translate-y-1 hover:shadow-lg focus:outline-none"
              key={destination.title}
            >
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
            </Link>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            to="/attractions"
            className="inline-flex items-center gap-2 rounded-full border-2 border-[#006068] text-[#006068] hover:bg-[#006068] hover:text-white px-8 py-3 font-bold transition-all duration-200"
            style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
          >
            Xem tất cả điểm đến
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

export default PopularDestinations
