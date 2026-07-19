import { useState } from 'react'
import { Link } from 'react-router-dom'
import fallbackImage from '../assets/ninh_binh.webp'
import { getRecentlyViewedAttractions } from '../utils/recentlyViewedAttractions.js'

const formatPrice = (value) => {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return 'Xem giá vé'
  return `Từ ${new Intl.NumberFormat('vi-VN').format(amount)}đ`
}

const handleImageFallback = (event) => {
  const image = event.currentTarget
  if (image.dataset.fallbackApplied === 'true') return

  image.dataset.fallbackApplied = 'true'
  image.src = fallbackImage
}

function RecentlyViewedAttractions({ variant = 'section' }) {
  const [items] = useState(() => getRecentlyViewedAttractions())

  if (items.length === 0) return null

  const isInline = variant === 'inline'

  return (
    <section className={isInline ? 'mb-8' : 'section bg-[#f8fafb]'}>
      <div className={isInline ? '' : 'container'}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Tiếp tục so sánh</p>
            <h2 className={isInline ? 'text-2xl font-bold text-[#00474d]' : undefined}>
              Vừa xem gần đây
            </h2>
          </div>
          <Link
            className="inline-flex items-center gap-1 text-sm font-extrabold text-[#006068] transition hover:text-[#00474d]"
            to="/attractions"
          >
            Khám phá thêm
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, isInline ? 3 : 6).map((item) => (
            <Link
              className="group flex overflow-hidden rounded-2xl border border-[#bdc9ca]/50 bg-white shadow-[0_4px_20px_rgba(0,40,50,0.05)] transition hover:-translate-y-1 hover:shadow-[0_14px_34px_rgba(0,96,104,0.12)]"
              key={item.id}
              to={`/attractions/${item.id}`}
            >
              <div className="h-28 w-28 shrink-0 overflow-hidden bg-[#e1e3e4]">
                <img
                  alt={item.title}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  onError={handleImageFallback}
                  src={item.primaryImage || fallbackImage}
                />
              </div>
              <div className="min-w-0 flex-1 p-4">
                <h3 className="truncate text-base font-extrabold text-[#00474d]">
                  {item.title}
                </h3>
                <p className="mt-1 flex items-center gap-1 truncate text-xs font-semibold text-[#3e494a]">
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                    location_on
                  </span>
                  {item.city || 'Việt Nam'}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-extrabold text-[#00629d]">
                    {formatPrice(item.minPrice)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fff8e2] px-2 py-1 text-xs font-bold text-[#6b4b00]">
                    <span
                      className="material-symbols-outlined text-[14px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                      aria-hidden="true"
                    >
                      star
                    </span>
                    {item.averageRating > 0 ? item.averageRating.toFixed(1) : 'New'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

export default RecentlyViewedAttractions
