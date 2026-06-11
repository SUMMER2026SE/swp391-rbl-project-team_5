import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/Header.jsx'
import Footer from '../components/Footer.jsx'
import { appDownloadButtons, footerLinks } from '../data/landingData.js'
import { getFavoriteItems, getFavorites, toggleFavorite } from '../services/favoriteApi.js'

const regionFilters = ['Tất cả', 'Miền Bắc', 'Miền Trung', 'Miền Nam']

const favNavLinks = [
  { label: 'Khám phá', href: '/attractions' },
  { label: 'Vé của tôi', href: '/my-tickets' },
  { label: 'Yêu thích', href: '/favorites', active: true },
]

const fallbackImage =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCQb-j3ztbZ9j-ilb9Hk28vN_mFyex_GLBLrd7CaAh6m96QFxnipQiir-9dDHaNOMJAFT6o0LPqr8Jt592v5xuNPxWswNdneL_yPnIXd-O981bbEXx0lQASAR_VGHtliBIs664ZNMoT07f0hIb-YeFJ7KxXbsMBKmPZwUgFZnrtxNsl1cVvIp3RioN0jwS7KwF997c-jq_p6BR0s-NxKwIJ1ylgbM4h2sM8Y401Jsc2YzHnvbHZ5NeSLVbSNT2e78DzkMTC6SFvRzo'

const northernCities = ['Hà Nội', 'Hạ Long', 'Quảng Ninh', 'Ninh Bình', 'Sa Pa', 'Lào Cai']
const centralCities = ['Đà Nẵng', 'Huế', 'Quảng Nam', 'Hội An', 'Nha Trang', 'Khánh Hòa']
const southernCities = ['TP. HCM', 'Hồ Chí Minh', 'Phú Quốc', 'Kiên Giang', 'Cần Thơ']

const getAttraction = (favorite) => favorite.attraction || favorite

const getAttractionImage = (attraction) => {
  if (attraction.primaryImage) {
    return attraction.primaryImage
  }

  if (attraction.imageUrl) {
    return attraction.imageUrl
  }

  if (Array.isArray(attraction.images) && attraction.images.length > 0) {
    const primary = attraction.images.find((image) => image.isPrimary)
    return primary?.imageUrl || attraction.images[0]?.imageUrl || fallbackImage
  }

  return fallbackImage
}

const getRegion = (item) => {
  const attraction = getAttraction(item)

  if (item.region || attraction.region) {
    return item.region || attraction.region
  }

  const city = attraction.city || attraction.location || ''

  if (northernCities.some((name) => city.includes(name))) {
    return 'Miền Bắc'
  }

  if (centralCities.some((name) => city.includes(name))) {
    return 'Miền Trung'
  }

  if (southernCities.some((name) => city.includes(name))) {
    return 'Miền Nam'
  }

  return 'Khác'
}

export default function UserFavoritesPage() {
  const navigate = useNavigate()
  const [favorites, setFavorites] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRegion, setSelectedRegion] = useState('Tất cả')
  const [errorMessage, setErrorMessage] = useState('')
  const [removingIds, setRemovingIds] = useState([])

  useEffect(() => {
    const fetchFavorites = async () => {
      setLoading(true)
      setErrorMessage('')

      try {
        const result = await getFavorites()
        setFavorites(getFavoriteItems(result))
      } catch (error) {
        console.error('Lỗi tải danh sách yêu thích:', error)
        setFavorites([])
        setErrorMessage(error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchFavorites()
  }, [])

  const handleRemoveFavorite = async (attractionId) => {
    setErrorMessage('')
    setRemovingIds((current) => [...current, attractionId])

    try {
      const result = await toggleFavorite(attractionId)

      if (result.data?.isFavorite === false) {
        setFavorites((prev) =>
          prev.filter((item) => {
            const attraction = getAttraction(item)
            return item.attractionId !== attractionId && attraction.id !== attractionId
          }),
        )
      }
    } catch (error) {
      console.error('Lỗi khi bỏ yêu thích địa điểm:', error)
      setErrorMessage(error.message)
    } finally {
      setRemovingIds((current) => current.filter((id) => id !== attractionId))
    }
  }

  const filteredFavorites = useMemo(
    () =>
      favorites.filter((item) => {
        if (selectedRegion === 'Tất cả') return true
        return getRegion(item) === selectedRegion
      }),
    [favorites, selectedRegion],
  )

  return (
    <React.Fragment>
      <Header links={favNavLinks} />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="bg-white border-b border-[#bec8ca]/40">
        <div className="mx-auto max-w-[1280px] px-5 md:px-12 py-3 flex items-center gap-1.5 text-sm font-semibold text-[#3f484a]">
          <a href="/" className="hover:text-[#006068] transition-colors">Trang chủ</a>
          <span className="material-symbols-outlined text-[14px] text-[#bec8ca]">chevron_right</span>
          <a href="/profile" className="hover:text-[#006068] transition-colors">Tài khoản</a>
          <span className="material-symbols-outlined text-[14px] text-[#bec8ca]">chevron_right</span>
          <span className="text-[#006068] font-bold">Địa điểm yêu thích</span>
        </div>
      </nav>

      <main className="min-h-screen bg-[#f9f9fc] py-10 px-5 md:px-12">
        <div className="mx-auto max-w-[1280px]">
          <section className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="mb-2 text-sm font-bold uppercase tracking-normal text-[#006068]">Bộ sưu tập cá nhân</p>
              <h1 className="text-3xl font-bold text-[#006068] md:text-4xl">Địa điểm yêu thích</h1>
              <p className="mt-2 text-base font-semibold text-[#3e494a]">
                {favorites.length} địa điểm đã lưu trong hành trình của bạn
              </p>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2">
              {regionFilters.map((region) => {
                const isActive = selectedRegion === region

                return (
                  <button
                    className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold transition ${
                      isActive
                        ? 'bg-[#006068] text-white shadow-md'
                        : 'bg-[#e2e2e5] text-[#3e494a] hover:bg-[#d5faff]'
                    }`}
                    key={region}
                    onClick={() => setSelectedRegion(region)}
                    type="button"
                  >
                    {region}
                  </button>
                )
              })}
            </div>
          </section>

          {errorMessage ? (
            <div className="mb-6 rounded-xl border border-[#ffdad6] bg-[#ffdad6]/55 p-4 text-sm font-semibold text-[#93000a]">
              {errorMessage}
            </div>
          ) : null}

          {loading ? (
            <FavoritesSkeleton />
          ) : filteredFavorites.length > 0 ? (
            <section className="mb-20 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredFavorites.map((item) => {
                const attraction = getAttraction(item)

                return (
                  <FavoriteCard
                    attraction={attraction}
                    isRemoving={removingIds.includes(attraction.id)}
                    key={item.id || attraction.id}
                    onBook={() => navigate(`/attractions/${attraction.id}`)}
                    onRemove={() => handleRemoveFavorite(attraction.id)}
                  />
                )
              })}
            </section>
          ) : (
            <EmptyFavorites selectedRegion={selectedRegion} />
          )}

          <section className="flex flex-col items-center gap-8 rounded-[32px] bg-[#f3f3f6] p-8 md:flex-row md:p-12">
            <div className="flex-1">
              <span className="mb-4 inline-block rounded-full bg-[#feb700] px-4 py-1.5 text-xs font-bold text-[#6b4b00]">
                KHÁM PHÁ THÊM
              </span>
              <h2 className="mb-4 text-3xl font-bold text-[#1a1c1e]">Hoàn thiện kỳ nghỉ mơ ước của bạn</h2>
              <p className="mb-8 max-w-lg text-base font-semibold leading-7 text-[#3e494a]">
                Nhận ngay ưu đãi nhóm khi đặt vé cho các địa điểm đã lưu và lên lịch trình tham quan
                trọn vẹn hơn.
              </p>
              <button
                className="rounded-full bg-[#006068] px-8 py-4 font-bold text-white shadow-lg transition hover:bg-[#007b85] active:scale-95"
                onClick={() => navigate('/attractions')}
                type="button"
              >
                Khám phá địa điểm
              </button>
            </div>
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-xl md:w-1/3">
              <img
                alt="Nhóm bạn đi du lịch"
                className="h-full w-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCN0PFNa1VMYsDg7FMmsFPI1ILCkcqKuikGnFcUDzvw8VSSFp3ALxjST0wQc7HslC83-Zhd2w8kdymMfWFx-e_S25SwtXg5MK6dN8SZ9qYK3OSvmkfxLAj7_90vHzHyrNKb8EvceJ8zY58XjdxuhnhyjZuapTJVy4MXLDr8yUVAd2j1q7gnzFvenKtu8Pr0423VgJ_T90ZVfITb0VewIu4OwI9Ttn-Phqbow4E0d_REf23_9-uofD0vinbM3QoXcRXeljG32bUtlq8"
              />
            </div>
          </section>
        </div>
      </main>

      <Footer links={footerLinks} appButtons={appDownloadButtons} />
    </React.Fragment>
  )
}

function FavoriteCard({ attraction, isRemoving, onBook, onRemove }) {
  const title = attraction.title || attraction.name || 'Địa điểm tham quan'
  const location = attraction.city ? `${attraction.city}, Việt Nam` : attraction.address || 'Việt Nam'
  const rating = Number(attraction.averageRating || attraction.rating || 0)

  return (
    <article className="group overflow-hidden rounded-[24px] bg-white shadow-[0_4px_20px_rgba(0,123,133,0.05)] transition duration-300 hover:shadow-[0_8px_30px_rgba(0,123,133,0.08)]">
      <div className="relative aspect-square overflow-hidden">
        <img
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          src={getAttractionImage(attraction)}
        />
        <div className="absolute right-4 top-4 z-10">
          <button
            aria-label={`Bỏ yêu thích ${title}`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#ba1a1a] shadow-md backdrop-blur-md transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRemoving}
            onClick={onRemove}
            type="button"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden="true"
            >
              favorite
            </span>
          </button>
        </div>
      </div>

      <div className="p-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="truncate text-lg font-bold text-[#1a1c1e]">{title}</h2>
          <div className="flex items-center gap-1 text-[#006068]">
            <span
              className="material-symbols-outlined text-sm"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden="true"
            >
              star
            </span>
            <span className="text-sm font-bold">{rating ? rating.toFixed(1) : 'New'}</span>
          </div>
        </div>
        <p className="mb-6 text-sm font-semibold text-[#3e494a]">{location}</p>
        <button
          className="w-full rounded-xl bg-[#007b85] py-3 text-sm font-bold text-[#d5faff] transition hover:bg-[#006068] hover:text-white"
          onClick={onBook}
          type="button"
        >
          Đặt vé ngay
        </button>
      </div>
    </article>
  )
}

function FavoritesSkeleton() {
  return (
    <section className="mb-20 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_4px_20px_rgba(0,123,133,0.05)]" key={index}>
          <div className="aspect-square animate-pulse bg-[#e2e2e5]" />
          <div className="space-y-4 p-5">
            <div className="h-5 w-3/4 animate-pulse rounded bg-[#e2e2e5]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-[#e2e2e5]" />
            <div className="h-11 animate-pulse rounded-xl bg-[#e2e2e5]" />
          </div>
        </div>
      ))}
    </section>
  )
}

function EmptyFavorites({ selectedRegion }) {
  return (
    <section className="mb-20 rounded-[24px] border border-dashed border-[#bdc9ca] bg-white p-10 text-center">
      <span className="material-symbols-outlined mb-3 text-5xl text-[#006068]" aria-hidden="true">
        favorite
      </span>
      <h2 className="text-2xl font-bold text-[#006068]">Chưa có địa điểm yêu thích</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-[#3e494a]">
        {selectedRegion === 'Tất cả'
          ? 'Hãy lưu các điểm tham quan bạn thích để lên kế hoạch nhanh hơn.'
          : `Bạn chưa lưu địa điểm nào ở ${selectedRegion}.`}
      </p>
    </section>
  )
}
