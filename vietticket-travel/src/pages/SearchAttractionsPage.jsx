import React, { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import AIItineraryPlanner from '../components/AIItineraryPlanner.jsx'
import { useAuth } from '../context/useAuth.js'
import { featuredDestinations, footerLinks } from '../data/landingData.js'
import { apiRequest } from '../services/api.js'
import { getFavoriteItems, getFavorites, toggleFavorite } from '../services/favoriteApi.js'

const AttractionsMap = lazy(() => import('../components/AttractionsMap.jsx'))

const categoryFilters = [
  { value: 'All', text: 'Tất cả', icon: 'auto_awesome' },
  { value: 'Theme Park & Resort', text: 'Công viên chủ đề', icon: 'fort' },
  { value: 'Amusement Park', text: 'Khu vui chơi', icon: 'mood' },
  { value: 'Museum', text: 'Bảo tàng', icon: 'museum' },
  { value: 'Nature & Sightseeing', text: 'Thiên nhiên', icon: 'forest' },
  { value: 'Cultural Experience', text: 'Văn hóa & Lịch sử', icon: 'theater_comedy' },
  { value: 'Adventure', text: 'Mạo hiểm', icon: 'sailing' },
]

const cityOptions = [
  'Tất cả thành phố',
  'Đà Nẵng',
  'Phú Quốc',
  'Hạ Long',
  'Nha Trang',
  'TP. HCM',
  'Hà Nội',
  'Sa Pa',
]

const starFilters = [
  { value: 5, label: '5 sao' },
  { value: 4, label: 'Từ 4 sao' },
  { value: 3, label: 'Từ 3 sao' },
]

const searchNavLinks = [
  { label: 'Khám phá', href: '/attractions', active: true },
  { label: 'Vé của tôi', href: '/my-tickets' },
  { label: 'Hỗ trợ', href: '/support' },
]

const fallbackImage =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCKCCSrWKDWnm1egxswx9ZDrsvUaf9XQAsPHBSMsnDBW-OM9iEJywudgQuEOwCJwRDBayEUi00MFLNyuz7_Ysw2yYOeWH3ksI6A73M_HISMDbZRKLyFWxT2dcs54bwuBnw02BVwqnjZtSY5vzFiUYTLtWmH3V3u5n7Ctp2Q8Qm89mBg3hYrJnSPSb6XsGkslTlRAtazp3UmX3CcxiG2hECKwTb9C4qvMtHaxIj1MnfhANSSytvNfsYou2PU9Y0VtNfXp1FJKkzYx6k'

const formatCurrency = (value) => {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Liên hệ'
  }

  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

const getPrimaryImage = (attraction) => {
  if (attraction.primaryImage) {
    return attraction.primaryImage
  }

  if (attraction.imageUrl) {
    return attraction.imageUrl
  }

  if (Array.isArray(attraction.images) && attraction.images.length > 0) {
    const primaryImage = attraction.images.find((image) => image.isPrimary)
    return primaryImage?.imageUrl || attraction.images[0]?.imageUrl || fallbackImage
  }

  return fallbackImage
}

const getPageNumbers = (currentPage, totalPages) => {
  const visibleCount = Math.min(totalPages, 5)
  const startPage = Math.min(
    Math.max(currentPage - 2, 1),
    Math.max(totalPages - visibleCount + 1, 1),
  )

  return Array.from({ length: visibleCount }, (_, index) => startPage + index)
}

export default function SearchAttractionsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isAuthLoading, user } = useAuth()

  const [favoriteIds, setFavoriteIds] = useState(new Set())
  const [favoriteUserId, setFavoriteUserId] = useState('')
  const [favoriteActionIds, setFavoriteActionIds] = useState(new Set())

  const handleToggleFavorite = async (e, attractionId) => {
    e.stopPropagation()

    if (!isAuthenticated) {
      navigate('/login', { state: { from: location } })
      return
    }

    if (favoriteActionIds.has(attractionId)) return

    setFavoriteActionIds((current) => new Set(current).add(attractionId))
    try {
      const result = await toggleFavorite(attractionId)
      setFavoriteIds((current) => {
        const next = new Set(current)
        if (result.data?.isFavorite) next.add(attractionId)
        else next.delete(attractionId)
        return next
      })
      setFavoriteUserId(user?.id || '')
    } catch (error) {
      console.error('Lỗi khi thả tim:', error)
      toast.error(error.message)
    } finally {
      setFavoriteActionIds((current) => {
        const next = new Set(current)
        next.delete(attractionId)
        return next
      })
    }
  }

  useEffect(() => {
    let active = true

    if (isAuthLoading) return undefined
    if (!isAuthenticated) return undefined

    getFavorites()
      .then((result) => {
        if (!active) return
        setFavoriteIds(
          new Set(
            getFavoriteItems(result)
              .map((item) => item.attractionId || item.attraction?.id || item.id)
            .filter(Boolean),
          ),
        )
        setFavoriteUserId(user?.id || '')
      })
      .catch((error) => {
        if (active && error.status !== 401) toast.error(error.message)
      })

    return () => {
      active = false
    }
  }, [isAuthenticated, isAuthLoading, user?.id])

  // 1. Quản lý các bộ lọc - đọc từ URL params nếu có
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('search') || ''
  })
  const [selectedCategory, setSelectedCategory] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('category') || 'All'
  })
  const [selectedCity, setSelectedCity] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('city') || 'Tất cả thành phố'
  })
  const [priceRange, setPriceRange] = useState(5000000)
  const [selectedStars, setSelectedStars] = useState([])
  const [selectedSort, setSelectedSort] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('sort') || 'popular'
  })

  // 2. Quản lý dữ liệu & phân trang
  const [attractions, setAttractions] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [errorMessage, setErrorMessage] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [mapPoints, setMapPoints] = useState([])
  const [mapLoading, setMapLoading] = useState(false)

  // Sync URL query params with local state when location.search changes
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchQuery(params.get('search') || '')
    setSelectedCategory(params.get('category') || 'All')
    setSelectedCity(params.get('city') || 'Tất cả thành phố')
    setSelectedSort(params.get('sort') || 'popular')
    setPriceRange(5000000)
    setSelectedStars([])
    setCurrentPage(1)
  }, [location.search])

  // Tải toàn bộ điểm có toạ độ (1 lần) khi mở bản đồ.
  useEffect(() => {
    if (!showMap || mapPoints.length > 0) return
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapLoading(true)
    apiRequest('/attractions/map-points')
      .then((result) => {
        if (active) setMapPoints(result.data?.points || [])
      })
      .catch(() => {
        if (active) toast.error('Không tải được dữ liệu bản đồ.')
      })
      .finally(() => {
        if (active) setMapLoading(false)
      })
    return () => {
      active = false
    }
  }, [showMap, mapPoints.length])

  // 3. Gọi API fetch danh sách địa điểm
  useEffect(() => {
    let active = true

    const fetchAttractions = async () => {
      setLoading(true)
      setErrorMessage('')

      try {
        // Xây dựng query params gửi lên API
        const params = new URLSearchParams()
        params.append('page', currentPage.toString())
        params.append('limit', '9')
        if (selectedCity && selectedCity !== 'Tất cả thành phố') {
          params.append('city', selectedCity)
        }
        if (selectedCategory && selectedCategory !== 'All') {
          params.append('category', selectedCategory)
        }
        if (priceRange < 5000000) {
          params.append('maxPrice', priceRange.toString())
        }
        if (selectedStars && selectedStars.length > 0) {
          params.append('minRating', Math.min(...selectedStars).toString())
        }
        if (searchQuery) {
          params.append('search', searchQuery)
        }
        if (selectedSort) {
          params.append('sort', selectedSort)
        }

        const result = await apiRequest(`/attractions?${params.toString()}`)
        if (!active) return

        setAttractions(result.data?.attractions || [])
        setTotalPages(Math.max(result.data?.pagination?.totalPages || 1, 1))
      } catch (error) {
        if (!active) return
        console.error('Lỗi khi tải danh sách địa điểm từ API:', error)
        setAttractions([])
        setTotalPages(1)
        setErrorMessage(error.message)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    fetchAttractions()

    return () => {
      active = false
    }
  }, [selectedCategory, selectedCity, priceRange, selectedStars, currentPage, searchQuery, selectedSort])

  // Handler lọc đánh giá sao
  const handleStarChange = (star) => {
    setSelectedStars((prev) =>
      prev.includes(star) ? prev.filter((selectedStar) => selectedStar !== star) : [...prev, star],
    )
    setCurrentPage(1)
  }

  const handleClearFilters = () => {
    setSearchQuery('')
    setSelectedCategory('All')
    setSelectedCity('Tất cả thành phố')
    setPriceRange(5000000)
    setSelectedStars([])
    setSelectedSort('popular')
    setCurrentPage(1)
    navigate('/attractions', { replace: true })
  }

  const handleCategoryChange = (category) => {
    setSelectedCategory(category)
    setCurrentPage(1)
  }

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value)
    setCurrentPage(1)
  }

  const handleCityChange = (event) => {
    setSelectedCity(event.target.value)
    setCurrentPage(1)
  }

  const handlePriceChange = (event) => {
    setPriceRange(Number(event.target.value))
    setCurrentPage(1)
  }

  const pageNumbers = getPageNumbers(currentPage, totalPages)

  // Khi API chưa có địa điểm phù hợp, gợi ý các điểm tham quan nổi bật tuyển chọn
  // (lọc theo bộ lọc hiện tại; nếu không khớp thì hiển thị toàn bộ danh sách nổi bật).
  const matchedFeatured = featuredDestinations.filter((item) => {
    if (selectedCity !== 'Tất cả thành phố' && item.city !== selectedCity) return false
    if (selectedCategory !== 'All' && item.category !== selectedCategory) return false
    if (
      searchQuery &&
      !`${item.title} ${item.city}`.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false
    }
    return true
  })
  const featuredFallback = matchedFeatured.length > 0 ? matchedFeatured : featuredDestinations

  return (
    <React.Fragment>
      <Seo
        title="Điểm tham quan Việt Nam"
        description="Khám phá và so sánh giá vé các điểm tham quan tại Việt Nam trên VietTicket Travel."
      />
      <Header links={searchNavLinks} />
      <AIItineraryPlanner />
      <main className="min-h-screen bg-[#f8fafb] px-5 py-8 text-[#191c1d] md:px-16">
        <div className="mx-auto max-w-[1280px]">
          <section className="mb-6">
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
                <div>
                  <p className="mb-2 text-sm font-semibold uppercase tracking-normal text-[#00629d]">
                    VietTicket Travel
                  </p>
                  <h1 className="max-w-3xl text-3xl font-bold leading-tight text-[#00474d] md:text-4xl">
                    Tìm kiếm điểm tham quan tuyệt vời
                  </h1>
                </div>

                <label className="relative block">
                  <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#3f484a]">
                    search
                  </span>
                  <input
                    className="h-12 w-full rounded-lg border border-[#bec8ca] bg-white pl-12 pr-4 text-base text-[#191c1d] outline-none transition focus:border-[#00629d] focus:ring-2 focus:ring-[#00629d]/20"
                    onChange={handleSearchChange}
                    placeholder="Tìm kiếm điểm đến..."
                    type="text"
                    value={searchQuery}
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                {categoryFilters.map((category) => {
                  const isActive = selectedCategory === category.value

                  return (
                    <button
                      className={`flex items-center gap-1 rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                        isActive
                          ? 'border-transparent bg-gradient-to-r from-[#00474d] to-[#00629d] text-white shadow-sm'
                          : 'border-[#bec8ca] bg-white text-[#191c1d] hover:bg-[#eceeef]'
                      }`}
                      key={category.value}
                      onClick={() => handleCategoryChange(category.value)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                        {category.icon}
                      </span>
                      {category.text}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-6 md:flex-row">
            <aside className="md:w-80 md:flex-shrink-0">
              <div className="sticky top-24 flex h-fit flex-col gap-6 rounded-lg border border-[#bec8ca]/80 bg-white p-6 shadow-[0_4px_20px_rgba(0,40,50,0.05)]">
                <div>
                  <h2 className="text-xl font-bold text-[#00474d]">Bộ lọc</h2>
                  <p className="text-sm font-medium text-[#3f484a]">Thu hẹp kết quả tìm kiếm</p>
                </div>

                <FilterSection icon="location_on" title="Điểm đến">
                  <select
                    className="w-full rounded-lg border border-[#bec8ca] bg-[#f8fafb] p-3 text-base text-[#191c1d] outline-none transition focus:border-[#00629d] focus:ring-2 focus:ring-[#00629d]/20"
                    onChange={handleCityChange}
                    value={selectedCity}
                  >
                    {cityOptions.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </FilterSection>

                <FilterSection icon="payments" title="Khoảng giá">
                  <input
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#e6e8e9] accent-[#00629d]"
                    max="5000000"
                    min="0"
                    onChange={handlePriceChange}
                    step="100000"
                    type="range"
                    value={priceRange}
                  />
                  <div className="flex justify-between text-xs font-semibold text-[#3f484a]">
                    <span>0 VND</span>
                    <span>{priceRange >= 5000000 ? '5.000.000+ VND' : formatCurrency(priceRange)}</span>
                  </div>
                </FilterSection>

                <FilterSection icon="grade" title="Đánh giá sao">
                  <div className="space-y-2">
                    {starFilters.map((star) => (
                      <label className="group flex cursor-pointer items-center gap-3" key={star.value}>
                        <input
                          checked={selectedStars.includes(star.value)}
                          className="h-4 w-4 rounded border-[#bec8ca] text-[#00629d] focus:ring-[#00629d]"
                          onChange={() => handleStarChange(star.value)}
                          type="checkbox"
                        />
                        <span className="flex items-center text-base text-[#3f484a] transition group-hover:text-[#191c1d]">
                          {star.label}
                          <span
                            className="material-symbols-outlined ml-1 text-[16px] text-[#ffba20]"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            star
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </FilterSection>

                <FilterSection icon="sailing" title="Loại hình du lịch">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Gia đình', category: 'Theme Park & Resort' },
                      { label: 'Cặp đôi', category: 'Nature & Sightseeing' },
                      { label: 'Mạo hiểm', category: 'Adventure' },
                    ].map((type) => {
                      const isActive = selectedCategory === type.category
                      return (
                        <button
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95 ${
                            isActive
                              ? 'bg-[#00629d] text-white shadow-sm'
                              : 'bg-[#eceeef] text-[#3f484a] hover:bg-[#bec8ca]'
                          }`}
                          key={type.label}
                          onClick={() => {
                            setSelectedCategory(type.category)
                            setCurrentPage(1)
                          }}
                          type="button"
                        >
                          {type.label}
                        </button>
                      )
                    })}
                  </div>
                </FilterSection>

                <div className="flex flex-col gap-2 mt-2">
                  <button
                    className="w-full rounded-lg bg-gradient-to-r from-[#00474d] to-[#00629d] py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg active:scale-95"
                    onClick={() => setCurrentPage(1)}
                    type="button"
                  >
                    Áp dụng bộ lọc
                  </button>
                  <button
                    className="w-full rounded-lg border border-[#bec8ca] bg-white py-3 text-sm font-bold text-[#3f484a] transition hover:bg-[#eceeef] active:scale-95"
                    onClick={handleClearFilters}
                    type="button"
                  >
                    Xóa bộ lọc
                  </button>
                </div>
              </div>
            </aside>

            <section className="flex-grow">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#bec8ca]/30 shadow-[0_4px_20px_rgba(0,40,50,0.02)]">
                <p className="text-sm font-bold text-[#00474d]">
                  {loading ? 'Đang tải địa điểm...' : `Tìm thấy ${attractions.length} địa điểm phù hợp`}
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#3f484a]">Sắp xếp:</span>
                    <select
                      className="rounded-lg border border-[#bec8ca] bg-[#f8fafb] px-3 py-1.5 text-xs font-bold text-[#3f484a] outline-none focus:border-[#00629d] transition cursor-pointer"
                      value={selectedSort}
                      onChange={(e) => {
                        setSelectedSort(e.target.value)
                        setCurrentPage(1)
                      }}
                    >
                      <option value="popular">Phổ biến nhất</option>
                      <option value="rating">Đánh giá cao nhất</option>
                      <option value="price-asc">Giá thấp nhất</option>
                      <option value="price-desc">Giá cao nhất</option>
                    </select>
                  </div>
                  <p className="text-xs font-semibold text-[#3f484a]">
                    Trang {currentPage}/{totalPages}
                  </p>
                </div>
              </div>

              {showMap && (
                <div className="mb-6">
                  {mapLoading ? (
                    <div className="flex h-[480px] items-center justify-center rounded-xl border border-[#bec8ca]/60 bg-white text-sm font-semibold text-[#3f484a]">
                      Đang tải bản đồ...
                    </div>
                  ) : (
                    <>
                      <Suspense fallback={<div className="h-[520px] flex items-center justify-center">Đang tải bản đồ...</div>}>
                        <AttractionsMap attractions={mapPoints} navigate={navigate} />
                      </Suspense>
                      <p className="mt-2 text-xs font-medium text-[#3f484a]">
                        Hiển thị {mapPoints.length} địa điểm bán vé trên toàn quốc.
                      </p>
                    </>
                  )}
                </div>
              )}

              {!loading && attractions.length === 0 && (
                <div className="mb-6 rounded-2xl border border-dashed border-[#bec8ca] bg-white p-6 text-center">
                  <span
                    className="material-symbols-outlined mx-auto mb-2 text-3xl text-[#00629d]"
                    aria-hidden="true"
                  >
                    travel_explore
                  </span>
                  <h2 className="text-lg font-bold text-[#00474d]">
                    Chưa có địa điểm khớp bộ lọc — gợi ý điểm tham quan nổi bật
                  </h2>
                  <p className="mx-auto mt-1 max-w-md text-sm font-medium text-[#3f484a]">
                    {errorMessage ||
                      'Dưới đây là những điểm tham quan nổi bật được yêu thích nhất trên VietTicket.'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {loading ? (
                  <SkeletonCards />
                ) : attractions.length > 0 ? (
                  attractions.map((attraction, index) => (
                    <AttractionCard
                      attraction={attraction}
                      isFavoritePending={favoriteActionIds.has(attraction.id)}
                      isFavorite={
                        favoriteUserId === user?.id && favoriteIds.has(attraction.id)
                      }
                      key={attraction.id || `${attraction.title || attraction.name}-${index}`}
                      navigate={navigate}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))
                ) : (
                  featuredFallback.map((item) => (
                    <FeaturedFallbackCard
                      attraction={item}
                      key={item.id}
                      navigate={navigate}
                    />
                  ))
                )}
              </div>

              {!loading && totalPages > 1 && (
                <div className="mt-16 flex items-center justify-center gap-2">
                  <PaginationButton
                    disabled={currentPage === 1}
                    icon="chevron_left"
                    onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
                  />
                  {pageNumbers.map((page) => (
                    <button
                      className={`h-10 w-10 rounded-lg text-sm font-bold transition ${
                        page === currentPage
                          ? 'bg-[#00474d] text-white'
                          : 'border border-[#bec8ca] bg-white text-[#3f484a] hover:bg-[#90d8e1] hover:text-[#00474d]'
                      }`}
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      type="button"
                    >
                      {page}
                    </button>
                  ))}
                  <PaginationButton
                    disabled={currentPage >= totalPages}
                    icon="chevron_right"
                    onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <div className="fixed bottom-5 right-5 z-50">
        <button
          className="flex items-center gap-2 rounded-full bg-[#00629d] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:scale-105 active:scale-95"
          type="button"
          onClick={() => setShowMap((value) => !value)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {showMap ? 'list' : 'map'}
          </span>
          {showMap ? 'Ẩn bản đồ' : 'Xem bản đồ'}
        </button>
      </div>

      <Footer links={footerLinks} />
    </React.Fragment>
  )
}

function FilterSection({ icon, title, children }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#00629d]">
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
          {icon}
        </span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

function AttractionCard({ attraction, isFavorite, isFavoritePending, navigate, onToggleFavorite }) {
  const title = attraction.title || attraction.name || 'Điểm tham quan'
  const location = attraction.city ? `${attraction.city}, Việt Nam` : attraction.address || 'Việt Nam'
  const rating = Number(attraction.averageRating || attraction.rating || 0)
  const price = attraction.minPrice ?? attraction.price ?? attraction.startingPrice

  return (
    <article className="group overflow-hidden rounded-lg border border-[#bec8ca]/50 bg-white shadow-[0_4px_20px_rgba(0,40,50,0.05)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,40,50,0.12)]">
      <div className="relative h-48 overflow-hidden">
        <img
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          src={getPrimaryImage(attraction)}
        />
        <button
          aria-label={isFavorite ? `Bỏ yêu thích ${title}` : `Lưu yêu thích ${title}`}
          className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur-md shadow-sm transition hover:scale-110 active:scale-95"
          disabled={isFavoritePending}
          onClick={(e) => onToggleFavorite && onToggleFavorite(e, attraction.id)}
          type="button"
        >
          <span
            className={`material-symbols-outlined text-[20px] transition ${
              isFavorite ? 'text-[#ba1a1a]' : 'text-[#3f484a] hover:text-[#ba1a1a]'
            }`}
            style={{ fontVariationSettings: isFavorite ? "'FILL' 1" : "'FILL' 0" }}
            aria-hidden="true"
          >
            favorite
          </span>
        </button>
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 shadow-sm backdrop-blur-md">
          <span
            className="material-symbols-outlined text-[16px] text-[#ffba20]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            star
          </span>
          <span className="text-xs font-semibold text-[#191c1d]">
            {rating > 0 ? rating.toFixed(1) : 'New'}
          </span>
        </div>
      </div>

      <div className="flex min-h-[172px] flex-col gap-3 p-4">
        <h3 className="text-xl font-bold leading-tight text-[#00474d]">{title}</h3>
        <div className="flex items-center gap-1 text-sm font-medium text-[#3f484a]">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            location_on
          </span>
          {location}
        </div>

        <div className="mt-auto flex items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[#3f484a]">Giá từ</span>
            <span className="text-lg font-bold text-[#00629d]">{formatCurrency(price)}</span>
          </div>
          <button
            className="rounded-lg border border-[#00474d]/20 bg-[#00474d]/5 px-4 py-2 text-sm font-bold text-[#00474d] transition hover:bg-[#00474d] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!attraction.id}
            onClick={() => navigate(`/attractions/${attraction.id}`)}
            type="button"
          >
            Chi tiết
          </button>
        </div>
      </div>
    </article>
  )
}

function SkeletonCards() {
  return Array.from({ length: 9 }).map((_, index) => (
    <div
      className="overflow-hidden rounded-lg border border-[#bec8ca]/50 bg-white shadow-[0_4px_20px_rgba(0,40,50,0.05)]"
      key={index}
    >
      <div className="h-48 animate-pulse bg-[#e1e3e4]" />
      <div className="space-y-4 p-4">
        <div className="h-6 w-3/4 animate-pulse rounded bg-[#e1e3e4]" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[#e1e3e4]" />
        <div className="flex items-end justify-between pt-6">
          <div className="space-y-2">
            <div className="h-3 w-14 animate-pulse rounded bg-[#e1e3e4]" />
            <div className="h-5 w-28 animate-pulse rounded bg-[#e1e3e4]" />
          </div>
          <div className="h-10 w-20 animate-pulse rounded-lg bg-[#e1e3e4]" />
        </div>
      </div>
    </div>
  ))
}

function FeaturedFallbackCard({ attraction, navigate }) {
  const title = attraction.title || 'Điểm tham quan'
  const location = attraction.city ? `${attraction.city}, Việt Nam` : 'Việt Nam'
  const rating = Number(attraction.averageRating || 0)
  const goToSearch = () =>
    navigate(`/attractions?search=${encodeURIComponent(attraction.searchQuery || title)}`)

  return (
    <article className="group overflow-hidden rounded-lg border border-[#bec8ca]/50 bg-white shadow-[0_4px_20px_rgba(0,40,50,0.05)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,40,50,0.12)]">
      <div className="relative h-48 overflow-hidden">
        <img
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          src={attraction.primaryImage || fallbackImage}
        />
        <div className="absolute left-3 top-3 rounded-full bg-[#00629d] px-2 py-1 text-xs font-bold text-white shadow-sm">
          Nổi bật
        </div>
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 shadow-sm backdrop-blur-md">
          <span
            className="material-symbols-outlined text-[16px] text-[#ffba20]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            star
          </span>
          <span className="text-xs font-semibold text-[#191c1d]">
            {rating > 0 ? rating.toFixed(1) : 'New'}
          </span>
        </div>
      </div>

      <div className="flex min-h-[172px] flex-col gap-3 p-4">
        <h3 className="text-xl font-bold leading-tight text-[#00474d]">{title}</h3>
        <div className="flex items-center gap-1 text-sm font-medium text-[#3f484a]">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            location_on
          </span>
          {location}
        </div>

        <div className="mt-auto flex items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[#3f484a]">Giá từ</span>
            <span className="text-lg font-bold text-[#00629d]">{formatCurrency(attraction.minPrice)}</span>
          </div>
          <button
            className="rounded-lg border border-[#00474d]/20 bg-[#00474d]/5 px-4 py-2 text-sm font-bold text-[#00474d] transition hover:bg-[#00474d] hover:text-white"
            onClick={goToSearch}
            type="button"
          >
            Khám phá
          </button>
        </div>
      </div>
    </article>
  )
}

function PaginationButton({ disabled, icon, onClick }) {
  return (
    <button
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#bec8ca] bg-white text-[#3f484a] transition hover:bg-[#00474d] hover:text-white disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white disabled:hover:text-[#3f484a]"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
