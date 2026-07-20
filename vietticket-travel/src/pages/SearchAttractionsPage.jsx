import React, { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import AIItineraryPlanner from '../components/AIItineraryPlanner.jsx'
import RecentlyViewedAttractions from '../components/RecentlyViewedAttractions.jsx'
import { useAuth } from '../context/useAuth.js'
import { footerLinks } from '../data/landingData.js'
import { getAttractionCities, getMapPoints, searchAttractions } from '../services/attractionApi.js'
import { getFavoriteItems, getFavorites, toggleFavorite } from '../services/favoriteApi.js'
import {
  DEFAULT_ATTRACTION_PRICE_RANGE,
  parseAttractionPriceRange,
} from '../utils/searchAttractionParams.js'
import fallbackAttractionImage from '../assets/ninh_binh.webp'

const AttractionsMap = lazy(() => import('../components/AttractionsMap.jsx'))

const categoryFilters = [
  { value: 'All', text: 'Tất cả', icon: 'auto_awesome' },
  { value: 'Công viên giải trí & Nghỉ dưỡng', text: 'Công viên chủ đề', icon: 'fort' },
  { value: 'Khu vui chơi', text: 'Khu vui chơi', icon: 'mood' },
  { value: 'Bảo tàng & Di sản', text: 'Bảo tàng', icon: 'museum' },
  { value: 'Thiên nhiên & Tham quan', text: 'Thiên nhiên', icon: 'forest' },
  { value: 'Văn hóa & Trải nghiệm địa phương', text: 'Văn hóa & Lịch sử', icon: 'theater_comedy' },
  { value: 'Phiêu lưu & Đường thủy', text: 'Mạo hiểm', icon: 'sailing' },
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

const fallbackImage = fallbackAttractionImage
const DEFAULT_CITY = 'Tất cả thành phố'
const DEFAULT_PRICE_RANGE = DEFAULT_ATTRACTION_PRICE_RANGE
const DEFAULT_SORT = 'popular'
const SEARCH_PAGE_SIZE = 9

const smartSearchPresets = [
  {
    label: 'Gia đình cuối tuần',
    icon: 'family_restroom',
    category: 'Công viên giải trí & Nghỉ dưỡng',
    sort: 'popular',
  },
  {
    label: 'Thiên nhiên thư giãn',
    icon: 'forest',
    category: 'Thiên nhiên & Tham quan',
    sort: 'rating',
  },
  {
    label: 'Dưới 500k',
    icon: 'savings',
    priceRange: 500000,
    sort: 'price-asc',
  },
  {
    label: 'Được đánh giá cao',
    icon: 'hotel_class',
    stars: [4],
    sort: 'rating',
  },
]

const handleImageFallback = (event) => {
  const image = event.currentTarget
  if (image.dataset.fallbackApplied === 'true') return

  image.dataset.fallbackApplied = 'true'
  image.src = fallbackImage
}

const formatCurrency = (value) => {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Liên hệ'
  }

  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

const formatTripDate = (value) => {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
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

const normalizePage = (value) => {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

const normalizeVisitDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''

const normalizeGuestCount = (value) => {
  const guests = Number(value)
  if (!Number.isFinite(guests)) return 1
  return Math.max(1, Math.min(20, Math.round(guests)))
}

const normalizeStars = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .filter(Boolean)

  return Array.from(
    new Set(
      rawValues
        .map((item) => Number(item))
        .filter((item) => starFilters.some((star) => star.value === item)),
    ),
  ).sort((a, b) => a - b)
}

const parseSearchParams = (search) => {
  const params = new URLSearchParams(search)
  const starParam = params.get('stars') || params.get('minRating')

  return {
    currentPage: normalizePage(params.get('page')),
    priceRange: parseAttractionPriceRange(search, DEFAULT_PRICE_RANGE),
    searchQuery: params.get('search') || '',
    selectedCategory: params.get('category') || 'All',
    selectedCity: params.get('city') || DEFAULT_CITY,
    selectedSort: params.get('sort') || DEFAULT_SORT,
    selectedStars: normalizeStars(starParam),
    visitDate: normalizeVisitDate(params.get('date')),
    guestCount: normalizeGuestCount(params.get('qty') || params.get('guests')),
  }
}

const buildSearchParams = ({
  currentPage,
  guestCount,
  priceRange,
  searchQuery,
  selectedCategory,
  selectedCity,
  selectedSort,
  selectedStars,
  visitDate,
}) => {
  const params = new URLSearchParams()
  const trimmedSearch = searchQuery.trim()
  const normalizedStars = normalizeStars(selectedStars)
  const normalizedVisitDate = normalizeVisitDate(visitDate)
  const normalizedGuestCount = normalizeGuestCount(guestCount)

  if (trimmedSearch) params.set('search', trimmedSearch)
  if (selectedCategory && selectedCategory !== 'All') params.set('category', selectedCategory)
  if (selectedCity && selectedCity !== DEFAULT_CITY) params.set('city', selectedCity)
  if (priceRange < DEFAULT_PRICE_RANGE) params.set('maxPrice', String(priceRange))
  if (normalizedStars.length > 0) params.set('stars', normalizedStars.join(','))
  if (selectedSort && selectedSort !== DEFAULT_SORT) params.set('sort', selectedSort)
  if (normalizedVisitDate) params.set('date', normalizedVisitDate)
  if (normalizedGuestCount > 1) params.set('qty', String(normalizedGuestCount))
  if (currentPage > 1) params.set('page', String(currentPage))

  return params
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

  const initialParams = parseSearchParams(location.search)

  // 1. Quản lý các bộ lọc - đọc từ URL params nếu có
  const [searchQuery, setSearchQuery] = useState(initialParams.searchQuery)
  // Giá trị tìm kiếm đã debounce: input cập nhật tức thì, nhưng chỉ gọi API sau
  // khi người dùng ngừng gõ 350ms -> tránh mỗi phím một request (đồng bộ với
  // AdminUserManagementPage vốn đã debounce 300ms).
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  const [selectedCategory, setSelectedCategory] = useState(initialParams.selectedCategory)
  const [selectedCity, setSelectedCity] = useState(initialParams.selectedCity)
  const [priceRange, setPriceRange] = useState(initialParams.priceRange)
  const [debouncedPriceRange, setDebouncedPriceRange] = useState(initialParams.priceRange)
  const [selectedStars, setSelectedStars] = useState(initialParams.selectedStars)
  const [selectedSort, setSelectedSort] = useState(initialParams.selectedSort)
  const [visitDate, setVisitDate] = useState(initialParams.visitDate)
  const [guestCount, setGuestCount] = useState(initialParams.guestCount)

  // 2. Quản lý dữ liệu & phân trang
  const [attractions, setAttractions] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(initialParams.currentPage)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [mapPoints, setMapPoints] = useState([])
  const [mapLoading, setMapLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [cityList, setCityList] = useState([])

  // Tải danh sách tỉnh/thành THẬT có điểm bán vé để đổ vào bộ lọc điểm đến.
  useEffect(() => {
    let active = true
    getAttractionCities()
      .then((res) => {
        if (active && Array.isArray(res?.data?.cities)) setCityList(res.data.cities)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Sync URL query params with local state when location.search changes
  useEffect(() => {
    const params = parseSearchParams(location.search)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchQuery(params.searchQuery)
    setSelectedCategory(params.selectedCategory)
    setSelectedCity(params.selectedCity)
    setSelectedSort(params.selectedSort)
    setPriceRange(params.priceRange)
    setDebouncedPriceRange(params.priceRange)
    setSelectedStars(params.selectedStars)
    setVisitDate(params.visitDate)
    setGuestCount(params.guestCount)
    setCurrentPage(params.currentPage)
  }, [location.search])

  useEffect(() => {
    const nextParams = buildSearchParams({
      currentPage,
      guestCount,
      priceRange: debouncedPriceRange,
      searchQuery,
      selectedCategory,
      selectedCity,
      selectedSort,
      selectedStars,
      visitDate,
    })
    const nextSearch = nextParams.toString()
    const currentSearch = location.search.startsWith('?')
      ? location.search.slice(1)
      : location.search

    if (nextSearch !== currentSearch) {
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: true },
      )
    }
  }, [
    currentPage,
    guestCount,
    location.pathname,
    location.search,
    navigate,
    debouncedPriceRange,
    searchQuery,
    selectedCategory,
    selectedCity,
    selectedSort,
    selectedStars,
    visitDate,
  ])

  // Debounce ô tìm kiếm: cập nhật giá trị dùng cho API sau 350ms ngừng gõ.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Debounce bộ lọc khoảng giá: cập nhật giá trị dùng cho API sau 400ms ngừng kéo slider.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPriceRange(priceRange)
    }, 400)
    return () => clearTimeout(timer)
  }, [priceRange])

  // Tải toàn bộ điểm có toạ độ (1 lần) khi mở bản đồ.
  useEffect(() => {
    if (!showMap || mapPoints.length > 0) return
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapLoading(true)
    getMapPoints()
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
        const result = await searchAttractions({
          page: currentPage,
          limit: SEARCH_PAGE_SIZE,
          city: selectedCity && selectedCity !== DEFAULT_CITY ? selectedCity : undefined,
          category: selectedCategory && selectedCategory !== 'All' ? selectedCategory : undefined,
          maxPrice: debouncedPriceRange < DEFAULT_PRICE_RANGE ? debouncedPriceRange : undefined,
          minRating: selectedStars && selectedStars.length > 0 ? Math.min(...selectedStars) : undefined,
          search: debouncedSearchQuery || undefined,
          sort: selectedSort || undefined,
        })
        if (!active) return

        const nextAttractions = result.data?.attractions || []
        const pagination = result.data?.pagination || {}
        setAttractions(nextAttractions)
        setTotalPages(Math.max(Number(pagination.totalPages) || 1, 1))
        setTotalItems(Number(pagination.totalItems ?? pagination.total ?? nextAttractions.length) || 0)
      } catch (error) {
        if (!active) return
        console.error('Lỗi khi tải danh sách địa điểm từ API:', error)
        setAttractions([])
        setTotalPages(1)
        setTotalItems(0)
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
  }, [selectedCategory, selectedCity, debouncedPriceRange, selectedStars, currentPage, debouncedSearchQuery, selectedSort, refreshKey])

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
    setSelectedCity(DEFAULT_CITY)
    setPriceRange(DEFAULT_PRICE_RANGE)
    setDebouncedPriceRange(DEFAULT_PRICE_RANGE)
    setSelectedStars([])
    setSelectedSort(DEFAULT_SORT)
    setVisitDate('')
    setGuestCount(1)
    setCurrentPage(1)
    setShowMobileFilters(false)
    navigate('/attractions', { replace: true })
  }

  const handleRefreshFilters = () => {
    setCurrentPage(1)
    setRefreshKey((key) => key + 1)
  }

  const handleCategoryChange = (category) => {
    setSelectedCategory(category)
    setCurrentPage(1)
  }

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value)
    setCurrentPage(1)
  }

  const handleSmartPreset = (preset) => {
    if (preset.searchQuery !== undefined) setSearchQuery(preset.searchQuery)
    if (preset.city) setSelectedCity(preset.city)
    if (preset.category) setSelectedCategory(preset.category)
    if (preset.priceRange != null) {
      setPriceRange(preset.priceRange)
      setDebouncedPriceRange(preset.priceRange)
    }
    if (preset.stars) setSelectedStars(preset.stars)
    if (preset.sort) setSelectedSort(preset.sort)
    setCurrentPage(1)
    setShowMobileFilters(false)
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

  const resultSummary = loading
    ? 'Đang tải địa điểm...'
    : totalItems > attractions.length
      ? `Tìm thấy ${totalItems.toLocaleString('vi-VN')} địa điểm phù hợp, đang xem ${attractions.length}`
      : `Tìm thấy ${attractions.length.toLocaleString('vi-VN')} địa điểm phù hợp`
  const detailBookingParams = new URLSearchParams()
  if (visitDate) detailBookingParams.set('date', visitDate)
  if (guestCount > 1) detailBookingParams.set('qty', String(guestCount))
  const detailBookingQuery = detailBookingParams.toString()
    ? `?${detailBookingParams.toString()}`
    : ''

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
                    aria-label="Tìm kiếm điểm đến"
                    onChange={handleSearchChange}
                    placeholder="Tìm kiếm điểm đến..."
                    type="text"
                    value={searchQuery}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-normal text-[#3f484a]">
                  Gợi ý nhanh
                </span>
                {smartSearchPresets.map((preset) => (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#a6eff8] bg-white px-3 py-1.5 text-xs font-bold text-[#00474d] shadow-sm transition hover:border-[#00629d] hover:bg-[#eefcff] active:scale-95"
                    key={preset.label}
                    onClick={() => handleSmartPreset(preset)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                      {preset.icon}
                    </span>
                    {preset.label}
                  </button>
                ))}
              </div>

              {(visitDate || guestCount > 1) && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#a6eff8] bg-[#eefcff] px-4 py-3 text-sm font-semibold text-[#00474d]">
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    event_available
                  </span>
                  <span>
                    Ngữ cảnh đặt vé:
                    {visitDate ? ` ngày ${formatTripDate(visitDate)}` : ''}
                    {guestCount > 1 ? `, ${guestCount} khách` : ''}
                  </span>
                  <span className="text-xs font-medium text-[#3f484a]">
                    Số chỗ sẽ được kiểm tra khi bạn chọn gói vé.
                  </span>
                  <button
                    className="ml-auto rounded-full bg-white px-3 py-1 text-xs font-bold text-[#006068] transition hover:bg-[#d7f7fb]"
                    onClick={() => {
                      setVisitDate('')
                      setGuestCount(1)
                      setCurrentPage(1)
                    }}
                    type="button"
                  >
                    Bỏ ngữ cảnh
                  </button>
                </div>
              )}

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

          <div className="mb-4 md:hidden">
            <button
              aria-controls="attraction-filter-panel"
              aria-expanded={showMobileFilters}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#00629d]/30 bg-white px-4 py-3 text-sm font-bold text-[#00474d] shadow-sm transition active:scale-95"
              onClick={() => setShowMobileFilters((value) => !value)}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                tune
              </span>
              Bộ lọc
            </button>
          </div>

          <div className="flex flex-col gap-6 md:flex-row">
            <aside className={`${showMobileFilters ? 'block' : 'hidden'} md:block md:w-80 md:flex-shrink-0`}>
              <div
                className="sticky top-24 flex h-fit flex-col gap-6 rounded-lg border border-[#bec8ca]/80 bg-white p-6 shadow-[0_4px_20px_rgba(0,40,50,0.05)]"
                id="attraction-filter-panel"
              >
                <div>
                  <h2 className="text-xl font-bold text-[#00474d]">Bộ lọc</h2>
                  <p className="text-sm font-medium text-[#3f484a]">Thu hẹp kết quả tìm kiếm</p>
                </div>

                <FilterSection icon="location_on" title="Điểm đến">
                  <select
                    aria-label="Lọc theo điểm đến"
                    className="w-full rounded-lg border border-[#bec8ca] bg-[#f8fafb] p-3 text-base text-[#191c1d] outline-none transition focus:border-[#00629d] focus:ring-2 focus:ring-[#00629d]/20"
                    onChange={handleCityChange}
                    value={selectedCity}
                  >
                    {(() => {
                      const options = [DEFAULT_CITY, ...(cityList.length ? cityList : [])]
                      // Giữ thành phố đang chọn (vd từ breadcrumb) dù chưa có trong list.
                      if (
                        selectedCity
                        && selectedCity !== DEFAULT_CITY
                        && !options.includes(selectedCity)
                      ) {
                        options.push(selectedCity)
                      }
                      return options.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))
                    })()}
                  </select>
                </FilterSection>

                <FilterSection icon="payments" title="Khoảng giá">
                  <input
                    aria-label="Giá vé tối đa"
                    aria-valuetext={priceRange >= DEFAULT_PRICE_RANGE ? 'Từ 5 triệu đồng trở lên' : formatCurrency(priceRange)}
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
                    <span>{priceRange >= DEFAULT_PRICE_RANGE ? '5.000.000+ VND' : formatCurrency(priceRange)}</span>
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
                      { label: 'Gia đình', category: 'Công viên giải trí & Nghỉ dưỡng' },
                      { label: 'Cặp đôi', category: 'Thiên nhiên & Tham quan' },
                      { label: 'Mạo hiểm', category: 'Phiêu lưu & Đường thủy' },
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
                    onClick={handleRefreshFilters}
                    type="button"
                  >
                    Làm mới kết quả
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
              <RecentlyViewedAttractions variant="inline" />

              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#bec8ca]/30 shadow-[0_4px_20px_rgba(0,40,50,0.02)]">
                <p className="text-sm font-bold text-[#00474d]">
                  {resultSummary}
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#3f484a]">Sắp xếp:</span>
                    <select
                      aria-label="Sắp xếp kết quả"
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
                <div className="mb-6" id="attractions-map-panel">
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
                    Không tìm thấy địa điểm khớp bộ lọc
                  </h2>
                  <p className="mx-auto mt-1 max-w-md text-sm font-medium text-[#3f484a]">
                    {errorMessage ||
                      'Hãy thử xóa bớt bộ lọc, đổi khoảng giá hoặc dùng từ khóa khác.'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {loading ? (
                  <SkeletonCards count={SEARCH_PAGE_SIZE} />
                ) : attractions.length > 0 ? (
                  attractions.map((attraction, index) => (
                    <AttractionCard
                      attraction={attraction}
                      isFavoritePending={favoriteActionIds.has(attraction.id)}
                      isFavorite={
                        favoriteUserId === user?.id && favoriteIds.has(attraction.id)
                      }
                      key={attraction.id || `${attraction.title || attraction.name}-${index}`}
                      onToggleFavorite={handleToggleFavorite}
                      detailBookingQuery={detailBookingQuery}
                    />
                  ))
                ) : null}
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

      <div className="fixed bottom-24 right-4 z-50 sm:bottom-5 sm:right-24 md:right-28">
        <button
          className="flex items-center gap-2 rounded-full bg-[#00629d] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:scale-105 active:scale-95"
          type="button"
          aria-controls="attractions-map-panel"
          aria-expanded={showMap}
          aria-label={showMap ? 'Ẩn bản đồ địa điểm' : 'Xem bản đồ địa điểm'}
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

function AttractionCard({
  attraction,
  detailBookingQuery = '',
  isFavorite,
  isFavoritePending,
  onToggleFavorite,
}) {
  const title = attraction.title || attraction.name || 'Điểm tham quan'
  const location = attraction.city ? `${attraction.city}, Việt Nam` : attraction.address || 'Việt Nam'
  const rating = Number(attraction.averageRating || attraction.rating || 0)
  const totalReviews = Number(attraction.totalReviews || attraction.reviewCount || 0)
  const price = attraction.minPrice ?? attraction.price ?? attraction.startingPrice
  const badges = [
    { icon: 'confirmation_number', label: 'Vé điện tử' },
    rating >= 4.5 && totalReviews > 0 ? { icon: 'verified', label: 'Được yêu thích' } : null,
    Number(price) > 0 && Number(price) <= 500000 ? { icon: 'savings', label: 'Giá tốt' } : null,
  ].filter(Boolean)

  return (
    <article className="group overflow-hidden rounded-lg border border-[#bec8ca]/50 bg-white shadow-[0_4px_20px_rgba(0,40,50,0.05)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,40,50,0.12)]">
      <div className="relative h-48 overflow-hidden">
        <img
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={handleImageFallback}
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

      <div className="flex min-h-[220px] flex-col gap-3 p-4">
        <h3 className="text-xl font-bold leading-tight text-[#00474d]">{title}</h3>
        <div className="flex items-center gap-1 text-sm font-medium text-[#3f484a]">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            location_on
          </span>
          {location}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[#eefcff] px-2.5 py-1 text-[11px] font-bold text-[#00474d]"
              key={badge.label}
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                {badge.icon}
              </span>
              {badge.label}
            </span>
          ))}
        </div>
        <p className="text-xs font-semibold text-[#5f6b6d]">
          {totalReviews > 0
            ? `${totalReviews.toLocaleString('vi-VN')} đánh giá từ du khách`
            : 'Trải nghiệm mới trên VietTicket'}
        </p>

        <div className="mt-auto flex items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[#3f484a]">Giá từ</span>
            <span className="text-lg font-bold text-[#00629d]">{formatCurrency(price)}</span>
          </div>
          {attraction.id ? (
            <Link
              className="rounded-lg border border-[#00474d]/20 bg-[#00474d]/5 px-4 py-2 text-sm font-bold text-[#00474d] transition hover:bg-[#00474d] hover:text-white"
              to={`/attractions/${attraction.id}${detailBookingQuery}`}
            >
              Chi tiết
            </Link>
          ) : (
            <span className="rounded-lg border border-[#00474d]/20 bg-[#00474d]/5 px-4 py-2 text-sm font-bold text-[#00474d] opacity-50">
              Chi tiết
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function SkeletonCards({ count = SEARCH_PAGE_SIZE }) {
  return Array.from({ length: count }).map((_, index) => (
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
