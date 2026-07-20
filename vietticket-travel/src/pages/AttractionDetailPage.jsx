import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import BookingModal from '../components/BookingModal.jsx'
import Footer from '../components/Footer.jsx'
import LocationMap from '../components/LocationMap.jsx'
import WeatherWidget from '../components/WeatherWidget.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import { useAuth } from '../context/useAuth.js'
import { footerLinks } from '../data/landingData.js'
import { getAttractionDetail } from '../services/attractionApi.js'
import { getFavoriteItems, getFavorites, toggleFavorite } from '../services/favoriteApi.js'
import reviewService from '../services/reviewService.js'
import { AI_BOOKING_SOURCE, isDateInputValue } from '../utils/aiBookingPrefill.js'
import { loadItineraryBookingQueue } from '../utils/aiItineraryBookingQueue.js'
import { normalizeInitialQuantity } from '../utils/bookingQuantity.js'
import { formatAttractionLocation } from '../utils/location.js'
import { saveRecentlyViewedAttraction } from '../utils/recentlyViewedAttractions.js'
import fallbackDetailImage from '../assets/halong_bay.webp'

const detailNavLinks = [
  { label: 'Khám phá', href: '/attractions', active: true },
  { label: 'Vé của tôi', href: '/my-tickets' },
  { label: 'Hỗ trợ', href: '/support' },
]

const fallbackImages = [
  {
    imageUrl: fallbackDetailImage,
    isPrimary: true,
  },
]

const tabItems = [
  { id: 'intro', label: 'Giới thiệu' },
  { id: 'amenity', label: 'Tiện ích' },
  { id: 'review', label: 'Đánh giá' },
]

const formatCurrency = (value) => {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Liên hệ'
  }

  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

const getRefundPolicyLabel = (ticket) => {
  const cutoffHours = Number(ticket?.refundCutoffHours ?? 24)
  const cutoffLabel = cutoffHours === 0 ? 'trước giờ bắt đầu' : `trước ${cutoffHours} giờ`
  if (ticket?.refundPolicy === 'FREE_CANCELLATION') {
    return `Hoàn 100% khi hủy ${cutoffLabel}`
  }
  if (ticket?.refundPolicy === 'REFUND_WITH_FEE') {
    const feeRate = Number(ticket?.refundFeeRate || 0)
    return feeRate > 0
      ? `Hoàn một phần khi hủy ${cutoffLabel}, phí ${Math.round(feeRate * 100)}%`
      : 'Hoàn một phần theo chính sách'
  }
  return 'Không hoàn tiền'
}

const getLowestTicketPrice = (ticketProducts = []) =>
  ticketProducts.reduce((lowest, ticket) => {
    const price = Number(ticket?.sellingPrice)
    if (!Number.isFinite(price) || price <= 0) return lowest
    return lowest == null ? price : Math.min(lowest, price)
  }, null)

const getBestRefundPolicyLabel = (ticketProducts = []) => {
  if (ticketProducts.some((ticket) => ticket?.refundPolicy === 'FREE_CANCELLATION')) {
    return 'Có vé hoàn 100%'
  }
  if (ticketProducts.some((ticket) => ticket?.refundPolicy === 'REFUND_WITH_FEE')) {
    return 'Có hỗ trợ hoàn'
  }
  return 'Theo chính sách vé'
}

const getImageUrl = (image) => (typeof image === 'string' ? image : image?.imageUrl)

const normalizeImages = (attraction) => {
  if (Array.isArray(attraction?.images) && attraction.images.length > 0) {
    return attraction.images.filter((image) => getImageUrl(image))
  }

  if (attraction?.primaryImage) {
    return [{ imageUrl: attraction.primaryImage, isPrimary: true }]
  }

  return fallbackImages
}

const getPrimaryImageUrl = (images) => {
  const primaryImage = images.find((image) => image.isPrimary)
  return getImageUrl(primaryImage) || getImageUrl(images[0]) || getImageUrl(fallbackImages[0])
}

const handleImageFallback = (event) => {
  const image = event.currentTarget
  if (image.dataset.fallbackApplied === 'true') return

  image.dataset.fallbackApplied = 'true'
  image.src = fallbackDetailImage
}

const getAddress = (attraction) => {
  return formatAttractionLocation(attraction, { includeCountry: true })
}

const getOpenDaysLabel = (openDays) => {
  const values = Array.isArray(openDays)
    ? openDays
    : String(openDays || '').split(',')
  const flags = values.map((value) => value === true || value === 1 || String(value).trim() === '1')
  if (flags.length !== 7) return ''
  if (flags.every(Boolean)) return 'hằng ngày'
  if (flags.slice(0, 5).every(Boolean) && flags.slice(5).every((value) => !value)) return 'Thứ Hai–Thứ Sáu'

  const dayNames = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']
  const activeDays = dayNames.filter((_, index) => flags[index])
  return activeDays.length > 0 ? activeDays.join(', ') : ''
}

const getOpeningSchedule = (attraction) => {
  const openTime = String(attraction?.openTime || '').trim()
  const closeTime = String(attraction?.closeTime || '').trim()
  const days = getOpenDaysLabel(attraction?.openDays)
  const slots = Array.isArray(attraction?.timeSlots) ? attraction.timeSlots : []
  const distinctSlots = slots.filter(
    (slot) => !(slots.length === 1 && slot.startTime === openTime && slot.endTime === closeTime),
  )
  const slotLabel = distinctSlots
    .map((slot) => `${slot.startTime}–${slot.endTime}`)
    .join(', ')

  if (openTime && closeTime) {
    const base = `${openTime}–${closeTime}${days ? `, ${days}` : ''}`
    return slotLabel ? `${base}. Khung vé: ${slotLabel}` : base
  }
  if (slotLabel) return `Các khung vé: ${slotLabel}`
  return 'Xem lịch khả dụng khi chọn ngày tham quan'
}

export default function AttractionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isAuthLoading, user } = useAuth()
  const [attraction, setAttraction] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeImage, setActiveImage] = useState('')
  const [activeTab, setActiveTab] = useState('intro')

  // Trạng thái mở modal đặt vé & loại vé được chọn
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [selectedTicketProduct, setSelectedTicketProduct] = useState(null)
  const [bookingInitialQuantity, setBookingInitialQuantity] = useState(1)
  const [bookingInitialDate, setBookingInitialDate] = useState('')
  const [bookingInitialTimeSlotId, setBookingInitialTimeSlotId] = useState('')
  const [aiBookingQueueContext, setAiBookingQueueContext] = useState(null)
  const [aiRecommendationContext, setAiRecommendationContext] = useState(null)

  // State quản lý số lượng vé chọn nhanh ở sidebar
  const [ticketQuantities, setTicketQuantities] = useState({})
  const [errorMessage, setErrorMessage] = useState('')
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteUserId, setFavoriteUserId] = useState('')
  const [isFavoriteUpdating, setIsFavoriteUpdating] = useState(false)

  const handleToggleFavorite = async () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location } })
      return
    }

    if (isFavoriteUpdating) return

    setIsFavoriteUpdating(true)
    try {
      const result = await toggleFavorite(id)
      setIsFavorite(Boolean(result.data?.isFavorite))
      setFavoriteUserId(user?.id || '')
    } catch (error) {
      console.error('Lỗi khi thả tim:', error)
      toast.error(error.message)
    } finally {
      setIsFavoriteUpdating(false)
    }
  }

  const handleShareAttraction = async () => {
    const shareUrl = `${window.location.origin}/attractions/${id}`
    const title = attraction?.title || 'VietTicket Travel'
    const text = attraction?.city
      ? `Khám phá ${title} tại ${attraction.city} trên VietTicket Travel.`
      : `Khám phá ${title} trên VietTicket Travel.`

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: shareUrl })
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
        toast.success('Đã sao chép liên kết chia sẻ.')
        return
      }

      window.prompt('Sao chép liên kết chia sẻ:', shareUrl)
    } catch (error) {
      if (error?.name !== 'AbortError') {
        toast.error('Không thể chia sẻ địa điểm lúc này. Vui lòng thử lại.')
      }
    }
  }

  useEffect(() => {
    let active = true

    if (isAuthLoading) return undefined
    if (!isAuthenticated) return undefined

    getFavorites()
      .then((result) => {
        if (!active) return
        setIsFavorite(
          getFavoriteItems(result).some(
            (item) => (item.attractionId || item.attraction?.id || item.id) === id,
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
  }, [id, isAuthenticated, isAuthLoading, user?.id])

  const displayedIsFavorite =
    isAuthenticated && favoriteUserId === user?.id && isFavorite

  useEffect(() => {
    const initialParams = new URLSearchParams(location.search)
    const isAiQueuePrefill =
      initialParams.get('source') === AI_BOOKING_SOURCE &&
      initialParams.get('bookNow') === '1' &&
      initialParams.get('aiQueueId')

    if (isAiQueuePrefill && isAuthLoading) return undefined

    const fetchDetail = async () => {
      setLoading(true)
      setErrorMessage('')

      try {
        const result = await getAttractionDetail(id)
        const detail = result.data
        const images = normalizeImages(detail)
        const products = Array.isArray(detail.ticketProducts) ? detail.ticketProducts : []
        setAttraction(detail)
        setActiveImage(getPrimaryImageUrl(images))
        saveRecentlyViewedAttraction({
          ...detail,
          id: detail.id || id,
          minPrice: getLowestTicketPrice(products),
          primaryImage: getPrimaryImageUrl(images),
        })

        if (products.length > 0) {
          const params = new URLSearchParams(location.search)
          const isAiSource = params.get('source') === AI_BOOKING_SOURCE
          const shouldPrefillBooking = params.get('bookNow') === '1'
          const shouldPrefillAiBooking = isAiSource && shouldPrefillBooking
          const aiQueueId = params.get('aiQueueId')
          const aiQueueItemId = params.get('aiQueueItemId')
          const requestedDate = isDateInputValue(params.get('date')) ? params.get('date') : ''
          const requestedQuantity = normalizeInitialQuantity(params.get('qty') || params.get('guests'))
          const hasSearchTripContext = Boolean(requestedDate || params.get('qty') || params.get('guests'))
          const recommendationContext =
            !shouldPrefillAiBooking && (isAiSource || hasSearchTripContext)
              ? {
                  date: requestedDate,
                  quantity: requestedQuantity,
                  source: isAiSource ? 'ai' : 'search',
                }
              : null
          setAiRecommendationContext(recommendationContext)

          if (shouldPrefillAiBooking && aiQueueId) {
            const queue = loadItineraryBookingQueue()
            const currentUserId = user?.id || user?.userId || ''
            const queueOwnerMatches = !queue?.ownerId || queue.ownerId === currentUserId
            const itemIndex = queue?.id === aiQueueId
              ? queue.items.findIndex((item) => item.id === aiQueueItemId)
              : -1
            const queueItem = itemIndex >= 0 ? queue?.items[itemIndex] : queue?.items?.[0]
            setAiBookingQueueContext(
              queue?.id === aiQueueId && queueOwnerMatches && queueItem
                ? {
                    current: itemIndex >= 0 ? itemIndex + 1 : 1,
                    item: queueItem,
                    itemId: queueItem.id,
                    planTitle: queue.planTitle,
                    queueId: queue.id,
                    total: queue.items.length,
                  }
                : null,
            )
          } else {
            setAiBookingQueueContext(null)
          }

          const requestedTicketId = params.get('ticketId')
          const prefillTicket = shouldPrefillBooking
            ? requestedTicketId
              ? products.find((item) => String(item.id) === requestedTicketId)
              : products[0]
            : null

          if (shouldPrefillBooking && requestedTicketId && !prefillTicket) {
            toast.warning('Không tìm thấy gói vé đã chọn. Vui lòng chọn lại trong danh sách vé.')
          }

          if (shouldPrefillBooking && prefillTicket) {
            const quantity = normalizeInitialQuantity(params.get('qty'))
            const date = params.get('date')
            const timeSlotId = params.get('timeSlotId')

            setTicketQuantities({ [prefillTicket.id]: quantity })
            setSelectedTicketProduct(prefillTicket)
            setBookingInitialQuantity(quantity)
            setBookingInitialDate(isDateInputValue(date) ? date : '')
            setBookingInitialTimeSlotId(timeSlotId ? String(timeSlotId) : '')
            setIsBookingOpen(true)
            window.history.replaceState(null, '', location.pathname)
          } else {
            setTicketQuantities({ [products[0].id]: recommendationContext?.quantity || 1 })
            setBookingInitialDate(recommendationContext?.date || '')
          }
        } else {
          setAiRecommendationContext(null)
        }
      } catch (error) {
        console.error('Lỗi khi tải chi tiết địa điểm từ API:', error)
        setAttraction(null)
        setErrorMessage(error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchDetail()
  }, [id, isAuthLoading, location.pathname, location.search, user?.id, user?.userId])

  const images = useMemo(() => normalizeImages(attraction), [attraction])
  const ticketProducts = attraction?.ticketProducts || []
  const rating = Number(attraction?.averageRating || 0)
  const reviewCount = Number(attraction?.totalReviews || 0)
  const lowestTicketPrice = getLowestTicketPrice(ticketProducts)
  const decisionHighlights = [
    {
      icon: 'payments',
      title: 'Giá từ',
      value: formatCurrency(lowestTicketPrice),
    },
    {
      icon: attraction?.requiresManualApproval ? 'manage_accounts' : 'verified',
      title: 'Xác nhận',
      value: attraction?.requiresManualApproval ? 'Đối tác duyệt' : 'Tức thì',
    },
    {
      icon: 'currency_exchange',
      title: 'Hoàn vé',
      value: getBestRefundPolicyLabel(ticketProducts),
    },
    {
      icon: 'qr_code_2',
      title: 'Nhận vé',
      value: 'QR trên điện thoại',
    },
  ]

  const handleQuantityChange = (ticketId, delta) => {
    setTicketQuantities((prev) => {
      const currentQty = prev[ticketId] || 0
      const newQty = Math.max(1, currentQty + delta)
      return { [ticketId]: newQty }
    })
  }

  const calculateTotal = () => {
    if (!attraction || !attraction.ticketProducts) return 0

    return attraction.ticketProducts.reduce((sum, ticket) => {
      const qty = ticketQuantities[ticket.id] || 0
      return sum + qty * (Number(ticket.sellingPrice) || 0)
    }, 0)
  }

  const getBookingQuantity = (ticket) => Math.max(1, Number(ticketQuantities[ticket?.id] || 0) || 1)
  const selectedTicketCount = Object.values(ticketQuantities).reduce((sum, qty) => {
    const amount = Number(qty) || 0
    return amount > 0 ? sum + amount : sum
  }, 0)

  const handleOpenBookingModal = (ticket, quantity = getBookingQuantity(ticket), options = {}) => {
    const effectiveDate = options.date || aiRecommendationContext?.date || ''
    setSelectedTicketProduct(ticket)
    setBookingInitialQuantity(normalizeInitialQuantity(quantity))
    setBookingInitialDate(isDateInputValue(effectiveDate) ? effectiveDate : '')
    setBookingInitialTimeSlotId(options.timeSlotId ? String(options.timeSlotId) : '')
    setIsBookingOpen(true)
  }

  const handleCloseBookingModal = () => {
    setIsBookingOpen(false)
    setBookingInitialDate('')
    setBookingInitialTimeSlotId('')
  }

  const handleOpenSelectedTicket = () => {
    const selectedTicket =
      ticketProducts.find((ticket) => (ticketQuantities[ticket.id] || 0) > 0) || ticketProducts[0]

    if (selectedTicket) {
      handleOpenBookingModal(selectedTicket, getBookingQuantity(selectedTicket))
    }
  }

  const goToGalleryImage = (direction) => {
    const activeIndex = images.findIndex((image) => getImageUrl(image) === activeImage)
    const nextIndex = (activeIndex + direction + images.length) % images.length
    setActiveImage(getImageUrl(images[nextIndex]))
  }

  if (loading) {
    return (
      <React.Fragment>
        <Seo
          title="Đang tải địa điểm"
          description="VietTicket Travel đang tải thông tin điểm tham quan."
        />
        <Header links={detailNavLinks} />
        <div className="min-h-[60vh] bg-[#f9f9fc] px-5 py-20 text-center text-[#3f484a]">
          Đang tải thông tin địa điểm...
        </div>
        <Footer links={footerLinks} />
      </React.Fragment>
    )
  }

  if (!attraction) {
    return (
      <React.Fragment>
        <Seo
          title="Không tìm thấy địa điểm"
          description="Địa điểm này không tồn tại hoặc đã bị ẩn trên VietTicket Travel."
        />
        <Header links={detailNavLinks} />
        <div className="min-h-[60vh] bg-[#f9f9fc] px-5 py-20 text-center">
          <h1 className="text-2xl font-bold text-[#00474d]">Không tìm thấy địa điểm!</h1>
          <p className="mt-3 text-sm font-semibold text-[#3f484a]">
            {errorMessage || 'Địa điểm này không tồn tại hoặc đã bị ẩn.'}
          </p>
          <Link
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#00474d] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#006068]"
            to="/attractions"
          >
            Quay lại danh sách
          </Link>
        </div>
        <Footer links={footerLinks} />
      </React.Fragment>
    )
  }

  return (
    <React.Fragment>
      <Seo
        title={attraction.title}
        description={String(attraction.description || `Đặt vé ${attraction.title} trên VietTicket Travel`).slice(0, 160)}
      />
      <Header links={detailNavLinks} />
      <nav aria-label="Breadcrumb" className="bg-white border-b border-[#bec8ca]/40">
        <div className="mx-auto max-w-[1280px] px-5 md:px-12 py-3 flex items-center gap-1.5 text-sm font-semibold text-[#3f484a]">
          <Link to="/" className="hover:text-[#006068] transition-colors">Trang chủ</Link>
          <span className="material-symbols-outlined text-[14px] text-[#bec8ca]" aria-hidden="true">chevron_right</span>
          <Link to="/attractions" className="hover:text-[#006068] transition-colors">Khám phá</Link>
          <span className="material-symbols-outlined text-[14px] text-[#bec8ca]" aria-hidden="true">chevron_right</span>
          {attraction?.city && (
            <><Link to={`/attractions?city=${encodeURIComponent(attraction.city)}`} className="hover:text-[#006068] transition-colors">{attraction.city}</Link>
            <span className="material-symbols-outlined text-[14px] text-[#bec8ca]" aria-hidden="true">chevron_right</span></>
          )}
          <span className="text-[#006068] font-bold truncate max-w-[240px]">{attraction?.title}</span>
        </div>
      </nav>
      <main className="bg-[#f9f9fc] px-5 pb-28 pt-8 text-[#1a1c1e] md:px-12 lg:pb-8">
        <div className="mx-auto max-w-[1280px]">
          <section className="mb-16">
            <div className="group relative mb-4 aspect-[16/9] overflow-hidden rounded-xl shadow-[0_4px_20px_rgba(0,96,104,0.04)] lg:aspect-[5/2]">
              <img
                alt={attraction.title}
                className="h-full w-full object-cover"
                fetchPriority="high"
                loading="eager"
                onError={handleImageFallback}
                src={activeImage || getPrimaryImageUrl(images)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />

              {images.length > 1 && (
                <React.Fragment>
                  <button
                    aria-label="Ảnh trước"
                    className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white opacity-100 backdrop-blur-md transition hover:bg-white/40 md:opacity-0 md:group-hover:opacity-100"
                    onClick={() => goToGalleryImage(-1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      arrow_back_ios_new
                    </span>
                  </button>
                  <button
                    aria-label="Ảnh tiếp theo"
                    className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white opacity-100 backdrop-blur-md transition hover:bg-white/40 md:opacity-0 md:group-hover:opacity-100"
                    onClick={() => goToGalleryImage(1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      arrow_forward_ios
                    </span>
                  </button>
                </React.Fragment>
              )}

              <div className="absolute bottom-6 left-6 flex items-center gap-2 rounded-lg border border-white/20 bg-white/75 px-4 py-2 text-sm font-bold text-[#1a1c1e] backdrop-blur-md">
                <span
                  className="material-symbols-outlined text-[#feb700]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  aria-hidden="true"
                >
                  star
                </span>
                Điểm đến hàng đầu {attraction.city || 'Việt Nam'}
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-2">
              {images.map((image, index) => {
                const imageUrl = getImageUrl(image)
                const isActive = activeImage === imageUrl

                return (
                  <button
                    className={`h-20 min-w-[120px] overflow-hidden rounded-lg border transition ${
                      isActive
                        ? 'border-2 border-[#00474d] ring-2 ring-[#00474d]/20 ring-offset-2'
                        : 'border-[#bec8ca] hover:border-[#00474d]'
                    }`}
                    key={image.id || imageUrl || index}
                    onClick={() => setActiveImage(imageUrl)}
                    type="button"
                  >
                    <img
                      alt={`${attraction.title} thumbnail ${index + 1}`}
                      className="h-full w-full object-cover"
                      onError={handleImageFallback}
                      src={imageUrl}
                    />
                  </button>
                )
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-10">
            <div className="space-y-8 lg:col-span-7">
              <header className="space-y-3">
                <h1 className="text-3xl font-bold leading-tight text-[#00474d] md:text-5xl">
                  {attraction.title}
                </h1>
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-1 text-sm font-semibold text-[#3f484a]">
                    <span className="material-symbols-outlined text-[20px] text-[#00474d]" aria-hidden="true">
                      location_on
                    </span>
                    {getAddress(attraction)}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <span
                          className="material-symbols-outlined text-[#feb700]"
                          key={index}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                          aria-hidden="true"
                        >
                          {rating >= index + 1 ? 'star' : rating > index ? 'star_half' : 'star_outline'}
                        </span>
                      ))}
                    </div>
                    <span className="font-bold text-[#00474d]">{rating ? rating.toFixed(1) : 'New'}</span>
                    <span className="text-sm font-semibold text-[#3f484a]">({reviewCount} đánh giá)</span>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {decisionHighlights.map((item) => (
                  <DecisionHighlight
                    icon={item.icon}
                    key={item.title}
                    title={item.title}
                    value={item.value}
                  />
                ))}
              </div>

              {attraction.latitude != null && attraction.longitude != null ? (
                <LocationMap
                  latitude={attraction.latitude}
                  longitude={attraction.longitude}
                  title={attraction.title}
                />
              ) : (
                <div className="flex h-[140px] items-center justify-center gap-2 rounded-xl border border-dashed border-[#bec8ca] bg-[#f8fafb] text-sm font-semibold text-[#3f484a]">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    location_off
                  </span>
                  Chưa có toạ độ bản đồ cho địa điểm này
                </div>
              )}

              {attraction.latitude != null && attraction.longitude != null && (
                <WeatherWidget
                  key={`${attraction.latitude},${attraction.longitude}`}
                  latitude={attraction.latitude}
                  longitude={attraction.longitude}
                  categories={attraction.categories}
                />
              )}

              <section className="space-y-4">
                <div className="flex overflow-x-auto border-b border-[#bec8ca]">
                  {tabItems.map((tab) => {
                    const isActive = activeTab === tab.id

                    return (
                      <button
                        className={`whitespace-nowrap px-8 py-4 text-base font-bold transition ${
                          isActive
                            ? 'border-b-2 border-[#00474d] text-[#00474d]'
                            : 'text-[#3f484a] hover:text-[#00474d]'
                        }`}
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        type="button"
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>

                <div className="py-4 text-base leading-7 text-[#3f484a]">
                  {activeTab === 'intro' && <IntroTab attraction={attraction} />}
                  {activeTab === 'amenity' && <AmenityTab attraction={attraction} />}
                  {activeTab === 'review' && <ReviewTab attraction={attraction} />}
                </div>
              </section>
            </div>

            <aside className="space-y-4 lg:sticky lg:top-28 lg:col-span-3">
              <div className="space-y-4 rounded-2xl border border-[#bec8ca]/40 bg-white p-4 shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-[#00474d]">Đặt vé ngay</h2>
                  <div className="flex items-center gap-2">
                    <button
                      aria-label={displayedIsFavorite ? 'Bỏ yêu thích' : 'Lưu yêu thích'}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-[#bec8ca] transition hover:border-[#ba1a1a] hover:text-[#ba1a1a] active:scale-95"
                      disabled={isFavoriteUpdating}
                      onClick={handleToggleFavorite}
                      type="button"
                    >
                      <span
                        className={`material-symbols-outlined text-[20px] transition ${
                          displayedIsFavorite ? 'text-[#ba1a1a]' : 'text-[#3f484a]'
                        }`}
                        style={{ fontVariationSettings: displayedIsFavorite ? "'FILL' 1" : "'FILL' 0" }}
                        aria-hidden="true"
                      >
                        favorite
                      </span>
                    </button>
                    <button
                      aria-label="Chia sẻ"
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-[#bec8ca] text-[#3f484a] transition hover:border-[#006068] hover:text-[#006068] active:scale-95"
                      onClick={handleShareAttraction}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">share</span>
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-[#a6eff8] bg-[#eefcff] px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-normal text-[#006068]">
                    Giá tốt nhất hiện có
                  </p>
                  <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                    <span className="text-xl font-bold text-[#00474d]">{formatCurrency(lowestTicketPrice)}</span>
                    <span className="text-xs font-semibold text-[#3f484a]">
                      {attraction.requiresManualApproval ? 'Chờ đối tác xác nhận' : 'Có thể nhận QR sau thanh toán'}
                    </span>
                  </div>
                </div>

                {aiBookingQueueContext && (
                  <div className="rounded-2xl border border-[#a6eff8] bg-[#eefcff] p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="material-symbols-outlined mt-0.5 text-[#006068]"
                        aria-hidden="true"
                      >
                        route
                      </span>
                      <div>
                        <p className="text-sm font-bold text-[#00474d]">
                          Đặt vé từ lịch trình AI
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#3f484a]">
                          Bước {aiBookingQueueContext.current}/{aiBookingQueueContext.total}
                          {aiBookingQueueContext.item?.dayLabel
                            ? ` - ${aiBookingQueueContext.item.dayLabel}`
                            : ''}
                        </p>
                        {aiBookingQueueContext.item?.ticketName && (
                          <p className="mt-1 text-xs text-[#5b6668]">
                            {aiBookingQueueContext.item.ticketName} x {aiBookingQueueContext.item.quantity}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!aiBookingQueueContext && aiRecommendationContext && (
                  <div className="rounded-2xl border border-[#a6eff8] bg-[#eefcff] p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="material-symbols-outlined mt-0.5 text-[#006068]"
                        aria-hidden="true"
                      >
                        auto_awesome
                      </span>
                      <div>
                        <p className="text-sm font-bold text-[#00474d]">
                          {aiRecommendationContext.source === 'ai'
                            ? 'Ngữ cảnh từ gợi ý AI'
                            : 'Ngữ cảnh từ tìm kiếm'}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#3f484a]">
                          {aiRecommendationContext.date
                            ? `Ngày tham quan: ${aiRecommendationContext.date}`
                            : aiRecommendationContext.source === 'ai'
                              ? 'Khách đang xem từ kết quả gợi ý AI'
                              : 'Khách đang xem từ kết quả tìm kiếm'}
                          {aiRecommendationContext.quantity
                            ? ` - ${aiRecommendationContext.quantity} vé`
                            : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {ticketProducts.length > 0 ? (
                  ticketProducts.map((ticket, index) => (
                    <TicketProductCard
                      isFeatured={index === 0}
                      key={ticket.id}
                      onChoose={() => handleOpenBookingModal(ticket, getBookingQuantity(ticket))}
                      onQuantityChange={(delta) => handleQuantityChange(ticket.id, delta)}
                      quantity={ticketQuantities[ticket.id] || 0}
                      ticket={ticket}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-[#bec8ca] bg-[#f3f3f6] p-4 text-sm font-semibold text-[#3f484a]">
                    Chưa có sản phẩm vé cho địa điểm này.
                  </div>
                )}

                <div className="space-y-4 border-t border-[#bec8ca] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-[#3f484a]">
                      Tổng cộng ({selectedTicketCount} vé)
                    </span>
                    <span className="text-xl font-bold text-[#00474d]">{formatCurrency(calculateTotal())}</span>
                  </div>
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#feb700] py-4 text-lg font-bold text-[#3d2a00] transition hover:shadow-[0_12px_32px_rgba(0,96,104,0.08)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={ticketProducts.length === 0 || selectedTicketCount === 0}
                    onClick={handleOpenSelectedTicket}
                    type="button"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      shopping_cart_checkout
                    </span>
                    Đặt vé ngay
                  </button>
                  <p className="text-center text-[11px] font-semibold text-[#3f484a]">
                    Không mất phí đặt vé - Hỗ trợ 24/7
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/50 bg-white/70 p-6 backdrop-blur-md">
                <p className="mb-4 text-sm font-bold text-[#00474d]">VietTicket đồng hành trước chuyến đi</p>
                <ul className="space-y-3">
                  {[
                    'Vé QR lưu trên điện thoại',
                    'Thanh toán an toàn qua VNPay',
                    'Chính sách hoàn hiển thị theo từng loại vé',
                    'Hỗ trợ khi lịch trình thay đổi',
                  ].map((item) => (
                    <li className="flex items-center gap-3 text-sm font-semibold text-[#3f484a]" key={item}>
                      <span
                        className="material-symbols-outlined text-lg text-[#00474d]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                        aria-hidden="true"
                      >
                        check_circle
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {ticketProducts.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#bec8ca]/60 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(0,40,50,0.12)] backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-[1280px] items-center gap-3 pr-16">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase text-[#3f484a]">
                {selectedTicketCount > 0 ? `Tạm tính ${selectedTicketCount} vé` : 'Giá từ'}
              </p>
              <p className="truncate text-lg font-extrabold text-[#00474d]">
                {formatCurrency(calculateTotal() || lowestTicketPrice)}
              </p>
            </div>
            <button
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#feb700] px-4 py-3 text-sm font-extrabold text-[#3d2a00] shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={selectedTicketCount === 0}
              onClick={handleOpenSelectedTicket}
              type="button"
            >
              <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
                shopping_cart_checkout
              </span>
              Chọn vé
            </button>
          </div>
        </div>
      )}

      <Footer links={footerLinks} />

      {isBookingOpen && selectedTicketProduct && (
        <BookingModal
          aiQueueId={
            String(selectedTicketProduct.id) === String(aiBookingQueueContext?.item?.ticketId || '')
              ? aiBookingQueueContext?.queueId || ''
              : ''
          }
          aiQueueItemId={
            String(selectedTicketProduct.id) === String(aiBookingQueueContext?.item?.ticketId || '')
              ? aiBookingQueueContext?.itemId || ''
              : ''
          }
          attractionId={id}
          attractionImage={activeImage || getPrimaryImageUrl(images)}
          attractionLocation={getAddress(attraction)}
          attractionTitle={attraction.title}
          initialDate={bookingInitialDate}
          initialQuantity={bookingInitialQuantity}
          initialTimeSlotId={bookingInitialTimeSlotId}
          isOpen={isBookingOpen}
          key={`${selectedTicketProduct.id}-${bookingInitialQuantity}-${bookingInitialDate || 'auto'}-${bookingInitialTimeSlotId || 'auto'}`}
          onClose={handleCloseBookingModal}
          requiresManualApproval={Boolean(attraction.requiresManualApproval)}
          ticketProduct={selectedTicketProduct}
        />
      )}
    </React.Fragment>
  )
}

function IntroTab({ attraction }) {
  return (
    <div className="space-y-4">
      <p>
        {attraction.description ||
          `${attraction.title} là một trong những điểm tham quan nổi bật tại ${
            attraction.city || 'Việt Nam'
          }, phù hợp cho du khách muốn khám phá, vui chơi và đặt vé trực tuyến nhanh chóng.`}
      </p>
      <p>
        Đặt vé qua VietTicket Travel giúp bạn nhận thông tin vé rõ ràng, giữ chỗ nhanh và chuẩn bị
        lịch trình thuận tiện hơn trước khi khởi hành.
      </p>
      <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
        <FeatureBox
          description={
            attraction.requiresManualApproval
              ? 'Vé QR được phát hành sau khi đối tác xác nhận đơn'
              : 'Nhận vé QR sau khi thanh toán thành công'
          }
          icon="verified_user"
          title={attraction.requiresManualApproval ? 'Đối tác xác nhận' : 'Xác nhận tức thì'}
        />
        <FeatureBox
          description={getOpeningSchedule(attraction)}
          icon="schedule"
          title="Giờ hoạt động"
        />
      </div>
    </div>
  )
}

function AmenityTab({ attraction }) {
  const categories = attraction.categories || []
  const ticketProducts = attraction.ticketProducts || []

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-3 text-xl font-bold text-[#00474d]">Danh mục trải nghiệm</h2>
        <div className="flex flex-wrap gap-2">
          {(categories.length > 0 ? categories : [{ name: 'Điểm tham quan' }, { name: 'Vé điện tử QR' }]).map(
            (category) => (
              <span
                className="rounded-full bg-[#a6eff8]/45 px-4 py-2 text-sm font-bold text-[#00474d]"
                key={category.id || category.name}
              >
                {category.name}
              </span>
            ),
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FeatureBox description="Hỗ trợ khách hàng trong quá trình đặt vé" icon="support_agent" title="Hỗ trợ 24/7" />
        <FeatureBox description="Thanh toán bảo mật và giữ vé tạm thời" icon="lock" title="Thanh toán an toàn" />
      </div>

      {ticketProducts.length > 0 && (
        <div>
          <h2 className="mb-3 text-xl font-bold text-[#00474d]">Loại vé hiện có</h2>
          <div className="grid gap-3">
            {ticketProducts.map((ticket) => (
              <div className="rounded-xl border border-[#bec8ca] bg-white p-4" key={ticket.id}>
                <p className="font-bold text-[#1a1c1e]">{ticket.name}</p>
                <p className="mt-1 text-sm">{ticket.description || 'Vé tham quan tiêu chuẩn.'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const REVIEWS_PAGE_SIZE = 6

function ReviewTab({ attraction }) {
  const [reviews, setReviews] = useState([])
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: REVIEWS_PAGE_SIZE, totalPages: 1 })
  const [breakdown, setBreakdown] = useState({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all', '5', '4', '3', '2', '1'
  const [now] = useState(() => Date.now())

  // Tải 1 trang review từ server; append=true khi bấm "Xem thêm".
  const loadReviews = (filter, page, append) => {
    const rating = ['5', '4', '3', '2', '1'].includes(filter) ? Number(filter) : undefined
    if (append) setIsLoadingMore(true)
    else setIsLoading(true)
    setLoadError('')

    return reviewService
      .getReviews(attraction.id, { page, limit: REVIEWS_PAGE_SIZE, rating })
      .then((result) => {
        setReviews((current) => (append ? [...current, ...result.data] : result.data))
        setMeta(result.meta)
        setBreakdown(result.breakdown)
      })
      .catch((err) => {
        console.error('Lỗi khi tải đánh giá:', err)
        setLoadError('Không thể tải đánh giá. Vui lòng thử lại.')
      })
      .finally(() => {
        setIsLoading(false)
        setIsLoadingMore(false)
      })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReviews(filterType, 1, false)
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attraction.id, filterType])

  const rating = Number(attraction.averageRating || 0)
  const totalReviews = Number(attraction.totalReviews || 0)

  const formatReviewDate = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`
  }

  const maskName = (name) => {
    if (!name) return 'Khách hàng'
    const parts = name.trim().split(/\s+/)
    if (parts.length === 1) {
      const first = parts[0][0] || ''
      return `${first}***`
    }
    return parts
      .map((part) => {
        if (part.length <= 1) return part
        return `${part[0]}***`
      })
      .join(' ')
  }



  // Tổng review hiển thị (mọi mức sao) — dùng cho histogram, không phụ thuộc filter.
  const breakdownTotal = [1, 2, 3, 4, 5].reduce((acc, star) => acc + (breakdown[star] || 0), 0)

  return (
    <div className="space-y-6">
      {/* Section Header with Rating Summary Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-[#bec8ca]/30 pb-8">
        <div>
          <h2 className="text-2xl font-bold text-[#00474d] mb-2">Đánh giá từ du khách</h2>
          <p className="text-sm text-[#3f484a]">Khám phá những trải nghiệm thực tế từ cộng đồng Modern Explorer.</p>
        </div>

        {/* Rating Summary Card */}
        <div className="bg-white p-6 rounded-xl shadow-[0px_4px_20px_rgba(0,123,133,0.05)] border border-[#bec8ca]/30 flex items-center gap-x-6 self-start lg:self-auto">
          <div className="text-center">
            <div className="text-4xl font-bold text-[#00474d] leading-none">{rating > 0 ? rating.toFixed(1) : '0.0'}</div>
            <div className="text-[11px] text-[#3f484a] mt-1 font-semibold">trên 5.0</div>
          </div>
          <div className="h-12 w-px bg-[#bec8ca]/30"></div>
          <div>
            <div className="flex gap-x-0.5 mb-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <span 
                  key={i} 
                  className="material-symbols-outlined text-[#feb700] text-[20px]"
                  style={{ fontVariationSettings: rating >= i + 1 ? "'FILL' 1" : rating > i ? "'FILL' 0.5" : "'FILL' 0" }}
                >
                  star
                </span>
              ))}
            </div>
            <div className="text-sm font-bold text-[#00474d]">{totalReviews.toLocaleString('vi-VN')} đánh giá</div>
          </div>
        </div>
      </div>

      {/* Rating Histogram */}
      {breakdownTotal > 0 && (
        <div className="bg-white p-6 rounded-xl border border-[#bec8ca]/20 shadow-[0px_4px_20px_rgba(0,96,104,0.04)] max-w-md space-y-2">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = breakdown[star] || 0
            const percent = breakdownTotal > 0 ? Math.round((count / breakdownTotal) * 100) : 0
            return (
              <button
                key={star}
                className="group flex w-full items-center gap-3 text-left"
                onClick={() => setFilterType(filterType === String(star) ? 'all' : String(star))}
                title={`Lọc đánh giá ${star} sao`}
                type="button"
              >
                <span className="flex w-12 shrink-0 items-center gap-0.5 text-xs font-bold text-[#3f484a]">
                  {star}
                  <span
                    className="material-symbols-outlined text-[14px] text-[#feb700]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    star
                  </span>
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#f3f3f6]">
                  <span
                    className={`block h-full rounded-full transition-all duration-500 ${
                      filterType === String(star) ? 'bg-[#00474d]' : 'bg-[#feb700] group-hover:bg-[#e5a500]'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-xs font-semibold text-[#3f484a]">
                  {count} ({percent}%)
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Filter Chips */}
      <div className="flex flex-wrap gap-2 py-2">
        <button
          className={`px-5 py-2 rounded-full text-xs font-semibold transition-all ${
            filterType === 'all'
              ? 'bg-[#00474d] text-white shadow-sm'
              : 'bg-[#f3f3f6] text-[#3f484a] hover:bg-[#bec8ca]/20'
          }`}
          onClick={() => setFilterType('all')}
          type="button"
        >
          Tất cả ({breakdownTotal})
        </button>
        {[5, 4, 3, 2, 1].map((star) => {
          const count = breakdown[star] || 0
          if (count === 0 && filterType !== String(star)) return null
          return (
            <button
              key={star}
              className={`px-5 py-2 rounded-full text-xs font-semibold transition-all ${
                filterType === String(star)
                  ? 'bg-[#00474d] text-white shadow-sm'
                  : 'bg-[#f3f3f6] text-[#3f484a] hover:bg-[#bec8ca]/20'
              }`}
              onClick={() => setFilterType(String(star))}
              type="button"
            >
              {star} sao ({count})
            </button>
          )
        })}
      </div>

      {/* Review List */}
      <div className="space-y-6 pt-2">
        {isLoading ? (
          <p className="py-12 text-center text-sm font-semibold text-[#3f484a]">
            Đang tải đánh giá...
          </p>
        ) : loadError ? (
          <div className="text-center py-12 bg-white rounded-xl border border-[#bec8ca]/20">
            <p className="text-sm font-semibold text-[#3f484a] mb-4">{loadError}</p>
            <button
              type="button"
              className="px-6 py-2.5 bg-[#00474d] text-white rounded-lg font-bold text-xs hover:bg-[#003d42] transition-colors"
              onClick={() => void loadReviews(filterType, 1, false)}
            >
              Thử lại
            </button>
          </div>
        ) : reviews.length === 0 ? (
          <p className="text-center py-12 text-[#6f797a] bg-white rounded-xl border border-[#bec8ca]/20">
            {filterType === 'all'
              ? 'Chưa có đánh giá nào. Hãy là người đầu tiên chia sẻ trải nghiệm!'
              : 'Không tìm thấy đánh giá phù hợp với bộ lọc.'}
          </p>
        ) : (
          reviews.map((review) => (
            <div 
              key={review.id} 
              className="bg-white p-6 rounded-xl border border-[#bec8ca]/20 shadow-[0px_4px_20px_rgba(0,96,104,0.04)] transition hover:shadow-[0px_12px_32px_rgba(0,96,104,0.08)] duration-200"
            >
              {/* Reviewer and Stars Row */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-x-4">
                  {review.user?.profile?.avatarUrl ? (
                    <img
                      alt="User Profile"
                      className="w-12 h-12 rounded-full object-cover border border-[#bec8ca]/20"
                      src={review.user.profile.avatarUrl}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#006068]/10 text-[#006068] flex items-center justify-center font-bold text-sm">
                      {review.user?.fullName ? review.user.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : 'KH'}
                    </div>
                  )}
                  <div>
                    <div className="text-base font-bold text-[#00474d]">{maskName(review.user?.fullName)}</div>
                    <div className="text-xs text-[#3f484a] font-semibold mt-0.5">
                      Đã trải nghiệm vào {formatReviewDate(review.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-x-0.5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <span 
                      key={j} 
                      className={`material-symbols-outlined text-[20px] ${j < review.rating ? 'text-[#feb700]' : 'text-[#bec8ca]'}`}
                      style={{ fontVariationSettings: j < review.rating ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      star
                    </span>
                  ))}
                </div>
              </div>

              {/* Comment Content */}
              <p className="text-sm text-[#1a1c1e] mb-6 leading-relaxed">
                {review.comment || 'Khách hàng không để lại bình luận chi tiết.'}
              </p>

              {/* Partner Response */}
              {review.replyComment && (
                <div className="ml-4 md:ml-12 p-5 bg-[#f3f3f6] rounded-lg border-l-4 border-[#00474d]/30">
                  <div className="flex items-center gap-x-2 mb-2">
                    <span className="material-symbols-outlined text-[#00474d] text-[18px]">verified_user</span>
                    <span className="text-xs font-bold text-[#00474d]">Phản hồi từ Đối tác</span>
                    <span className="text-xs text-[#3f484a] ml-auto">{formatTimeAgo(review.repliedAt || review.updatedAt, now)}</span>
                  </div>
                  <p className="text-sm text-[#3f484a] italic">
                    "{review.replyComment}"
                  </p>
                </div>
              )}
            </div>
          ))
        )}

        {/* Load More */}
        {!isLoading && !loadError && meta.page < meta.totalPages && (
          <div className="pt-2 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-[#00474d] px-8 py-3 text-sm font-bold text-[#00474d] transition-colors hover:bg-[#00474d] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void loadReviews(filterType, meta.page + 1, true)}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                  Đang tải...
                </>
              ) : (
                <>
                  Xem thêm đánh giá ({meta.total - reviews.length} còn lại)
                  <span className="material-symbols-outlined text-[18px]">expand_more</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FeatureBox({ description, icon, title }) {
  return (
    <div className="flex gap-4 rounded-xl border border-[#00474d]/10 bg-[#00474d]/5 p-4">
      <span className="material-symbols-outlined text-[#00474d]" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="font-bold text-[#00474d]">{title}</p>
        <p className="text-sm opacity-80">{description}</p>
      </div>
    </div>
  )
}

function DecisionHighlight({ icon, title, value }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#bec8ca]/50 bg-white p-4 shadow-[0_4px_20px_rgba(0,96,104,0.035)]">
      <span className="material-symbols-outlined text-[22px] text-[#006068]" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-normal text-[#5f6b6d]">{title}</p>
        <p className="mt-1 text-sm font-bold text-[#00474d]">{value}</p>
      </div>
    </div>
  )
}

function TicketProductCard({ isFeatured, onChoose, onQuantityChange, quantity, ticket }) {
  return (
    <div
      className={`space-y-3 rounded-xl border p-4 transition hover:border-[#00474d] ${
        isFeatured ? 'border-[#00474d]/20 bg-[#00474d]/5' : 'border-[#bec8ca] bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-[#1a1c1e]">{ticket.name}</h3>
          <span className="mt-1 inline-flex rounded-full bg-[#feb700]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-normal text-[#6b4b00]">
            {getRefundPolicyLabel(ticket)}
          </span>
        </div>
        <div className="text-right">
          {ticket.originalPrice ? (
            <p className="text-xs font-semibold text-[#3f484a] line-through">
              {formatCurrency(ticket.originalPrice)}
            </p>
          ) : null}
          <p className="text-lg font-bold text-[#00474d]">{formatCurrency(ticket.sellingPrice)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3 rounded-lg border border-[#bec8ca] bg-white px-3 py-1">
          <button
            className="text-lg font-bold text-[#3f484a] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={quantity <= 1}
            onClick={() => onQuantityChange(-1)}
            type="button"
          >
            -
          </button>
          <span className="min-w-5 text-center text-sm font-bold">{quantity}</span>
          <button
            className="text-lg font-bold text-[#00474d]"
            onClick={() => onQuantityChange(1)}
            type="button"
          >
            +
          </button>
        </div>
        <button
          className={`rounded-lg px-4 py-2 text-sm font-bold transition active:scale-95 ${
            isFeatured
              ? 'bg-[#00474d] text-white'
              : 'border border-[#00474d] text-[#00474d] hover:bg-[#00474d]/5'
          }`}
          onClick={onChoose}
          type="button"
        >
          Chọn
        </button>
      </div>
    </div>
  )
}

const formatTimeAgo = (dateStr, referenceTime) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const diffMs = (referenceTime || Date.now()) - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Hôm nay'
  if (diffDays === 1) return 'Hôm qua'
  if (diffDays < 7) return `${diffDays} ngày trước`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} tuần trước`
  return `${Math.floor(diffDays / 30)} tháng trước`
}
