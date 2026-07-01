import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchAttractions } from '../services/attractionApi.js'
import { featuredDestinations } from '../data/landingData.js'

const formatPrice = (value) =>
  value == null ? 'Xem các gói vé' : `Từ ${Number(value).toLocaleString('vi-VN')}đ`

// Đường dẫn của thẻ: địa điểm thật mở trang chi tiết; địa điểm nổi bật dự phòng
// dẫn sang trang khám phá với từ khóa để vẫn thấy các điểm tham quan nổi bật.
const getDestinationLink = (destination) =>
  destination.searchQuery
    ? `/attractions?search=${encodeURIComponent(destination.searchQuery)}`
    : `/attractions/${destination.id}`

function PopularDestinations() {
  const [destinations, setDestinations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    searchAttractions({ sort: 'popular', limit: 6 })
      .then((response) => {
        if (active) setDestinations(response.data?.attractions || [])
      })
      .catch(() => {
        if (active) setDestinations([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Khi API chưa có địa điểm đã duyệt, hiển thị danh sách nổi bật tuyển chọn.
  const items = destinations.length > 0 ? destinations : featuredDestinations

  return (
    <section className="section section--muted" id="destinations">
      <div className="container">
        <div className="section-heading text-center">
          <p className="eyebrow">Được quan tâm</p>
          <h2>Điểm tham quan nổi bật trên VietTicket</h2>
        </div>

        {loading ? (
          <p className="text-center">Đang tải điểm đến...</p>
        ) : (
          <div className="destination-grid">
            {items.map((destination) => (
              <Link
                to={getDestinationLink(destination)}
                className="destination-card block transition hover:-translate-y-1 hover:shadow-lg focus:outline-none"
                key={destination.id}
              >
                <div className="destination-card__media">
                  {destination.primaryImage ? (
                    <img
                      src={destination.primaryImage}
                      alt={destination.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-full w-full bg-[#e1e3e4]" aria-hidden="true" />
                  )}
                  <span>{destination.city}</span>
                </div>

                <div className="destination-card__body">
                  <div className="destination-card__title-row">
                    <h3>{destination.title}</h3>
                    <p>{formatPrice(destination.minPrice)}</p>
                  </div>
                  <div className="destination-card__meta">
                    <span className="material-symbols-outlined" aria-hidden="true">star</span>
                    <span>
                      {destination.totalReviews > 0
                        ? `${Number(destination.averageRating).toFixed(1)} · ${destination.totalReviews} đánh giá`
                        : 'Chưa có đánh giá'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="text-center mt-10">
          <Link
            to="/attractions"
            className="inline-flex items-center gap-2 rounded-full border-2 border-[#006068] text-[#006068] hover:bg-[#006068] hover:text-white px-8 py-3 font-bold transition-all duration-200"
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
