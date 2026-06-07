import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import BookingModal from '../components/BookingModal.jsx'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import { appDownloadButtons, footerLinks } from '../data/landingData.js'
import { apiRequest } from '../services/api.js'

const detailNavLinks = [
  { label: 'Khám phá', href: '/attractions', active: true },
  { label: 'Đặt chỗ của tôi', href: '/profile' },
  { label: 'Hỗ trợ', href: '#support' },
]

const fallbackImages = [
  {
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuC8Obh9J3W67YZYfg7Rd0OMWCkJ57CHJISoc2WFL2cxBAWxwR0wQdffk2w_hBRrPAVcdMTjYqV25D3NSgsyBMWsitsPVdG4kJPpLKswUUbGTCpIytepBPOayEdlpp7yVm5O8OFnFYNYmFpg7ColoomMRS71dnbFpJEMnekGDwvovQVh0Mv-c840_6uhAiDzbpjAMDfgK363W3AbYJNChupnI24c8moSAB4p7ffHSFXtrNJuhkF-uO3o-HVdrnnfBVfsrTG3GoaWWT4',
    isPrimary: true,
  },
  {
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBfQA1SvY6S4CtYJQsyTIo_XF0ohBLkBXYyfKIrRj7aJ3q0q_aKM_9BUQuJARXbNZj5EghwriK7YH0Yhhdi0apIwUU1_h1xd9NCNe9ueY2pDXjlzuKUSKR29acie-KGEPuo8ldJxiFnn1mmR8S26SOJ4zkgn0h9s-KnyuVi47VrQbXWDEkv7cR6i1k-wIO8uHCZDoF6kZSK-49ssp1IIdJyZkQiFvbk5xRp_4onkwflsFbvWmXDnTTK-h_5gnhz7JYHArjt2gdXacg',
  },
  {
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAVzq7iqoicSsBqnMnzXepbqflg-cB29r3x0NJNrPAx-wfiFpHWFpadfYGsCGR23pxynHUQ6g48hSYHIb6JPHGX-kNuNq2wvpEQoMAjDoaCLsiTLwKA0XPuUHblPdYDKA1nX_OX1ofVbmUtSFyteYTBN0DfTx9YatUchhDGG5Y558IlpgkwZhimFDp1tGki-PRe_yEa9U2al3mvCzsTAK9tnFKAJmsRMIFE-zf8D3NmepICsIB4Wc8G2NsFIEVkSirLNTXkD0Tshbc',
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

const getAddress = (attraction) => {
  if (attraction.address && attraction.city) {
    return `${attraction.address}, ${attraction.city}, Việt Nam`
  }

  return attraction.address || (attraction.city ? `${attraction.city}, Việt Nam` : 'Việt Nam')
}

export default function AttractionDetailPage() {
  const { id } = useParams()
  const [attraction, setAttraction] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeImage, setActiveImage] = useState('')
  const [activeTab, setActiveTab] = useState('intro')

  // Trạng thái mở modal đặt vé & loại vé được chọn
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [selectedTicketProduct, setSelectedTicketProduct] = useState(null)

  // State quản lý số lượng vé chọn nhanh ở sidebar
  const [ticketQuantities, setTicketQuantities] = useState({})
  const [errorMessage, setErrorMessage] = useState('')
  const [isFavorite, setIsFavorite] = useState(false)

  const handleToggleFavorite = async () => {
    setIsFavorite(prev => !prev)
    try {
      await apiRequest(`/attractions/${id}/favorite`, { method: 'POST' })
    } catch (error) {
      console.error('Lỗi khi thả tim:', error)
    }
  }

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true)
      setErrorMessage('')

      try {
        const result = await apiRequest(`/attractions/${id}`)
        const detail = result.data
        const images = normalizeImages(detail)
        setAttraction(detail)
        setActiveImage(getPrimaryImageUrl(images))

        if (Array.isArray(detail.ticketProducts) && detail.ticketProducts.length > 0) {
          setTicketQuantities({ [detail.ticketProducts[0].id]: 1 })
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
  }, [id])

  const images = useMemo(() => normalizeImages(attraction), [attraction])
  const ticketProducts = attraction?.ticketProducts || []
  const rating = Number(attraction?.averageRating || 0)
  const reviewCount = Number(attraction?.totalReviews || 0)

  const handleQuantityChange = (ticketId, delta) => {
    setTicketQuantities((prev) => {
      const currentQty = prev[ticketId] || 0
      const newQty = Math.max(0, currentQty + delta)
      return { ...prev, [ticketId]: newQty }
    })
  }

  const calculateTotal = () => {
    if (!attraction || !attraction.ticketProducts) return 0

    return attraction.ticketProducts.reduce((sum, ticket) => {
      const qty = ticketQuantities[ticket.id] || 0
      return sum + qty * Number(ticket.sellingPrice)
    }, 0)
  }

  const handleOpenBookingModal = (ticket) => {
    setSelectedTicketProduct(ticket)
    setIsBookingOpen(true)
  }

  const handleOpenSelectedTicket = () => {
    const selectedTicket =
      ticketProducts.find((ticket) => (ticketQuantities[ticket.id] || 0) > 0) || ticketProducts[0]

    if (selectedTicket) {
      handleOpenBookingModal(selectedTicket)
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
        <Header links={detailNavLinks} />
        <div className="min-h-[60vh] bg-[#f9f9fc] px-5 py-20 text-center text-[#3f484a]">
          Đang tải thông tin địa điểm...
        </div>
        <Footer links={footerLinks} appButtons={appDownloadButtons} />
      </React.Fragment>
    )
  }

  if (!attraction) {
    return (
      <React.Fragment>
        <Header links={detailNavLinks} />
        <div className="min-h-[60vh] bg-[#f9f9fc] px-5 py-20 text-center">
          <h1 className="text-2xl font-bold text-[#00474d]">Không tìm thấy địa điểm!</h1>
          <p className="mt-3 text-sm font-semibold text-[#3f484a]">
            {errorMessage || 'Địa điểm này không tồn tại hoặc đã bị ẩn.'}
          </p>
        </div>
        <Footer links={footerLinks} appButtons={appDownloadButtons} />
      </React.Fragment>
    )
  }

  return (
    <React.Fragment>
      <Header links={detailNavLinks} />
      <nav aria-label="Breadcrumb" className="bg-white border-b border-[#bec8ca]/40">
        <div className="mx-auto max-w-[1280px] px-5 md:px-12 py-3 flex items-center gap-1.5 text-sm font-semibold text-[#3f484a]">
          <a href="/" className="hover:text-[#006068] transition-colors">Trang chủ</a>
          <span className="material-symbols-outlined text-[14px] text-[#bec8ca]" aria-hidden="true">chevron_right</span>
          <a href="/attractions" className="hover:text-[#006068] transition-colors">Khám phá</a>
          <span className="material-symbols-outlined text-[14px] text-[#bec8ca]" aria-hidden="true">chevron_right</span>
          {attraction?.city && (
            <><a href={`/attractions?city=${attraction.city}`} className="hover:text-[#006068] transition-colors">{attraction.city}</a>
            <span className="material-symbols-outlined text-[14px] text-[#bec8ca]" aria-hidden="true">chevron_right</span></>
          )}
          <span className="text-[#006068] font-bold truncate max-w-[240px]">{attraction?.title}</span>
        </div>
      </nav>
      <main className="bg-[#f9f9fc] px-5 py-8 text-[#1a1c1e] md:px-12">
        <div className="mx-auto max-w-[1280px]">
          <section className="mb-16">
            <div className="group relative mb-4 aspect-[21/9] overflow-hidden rounded-xl shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
              <img
                alt={attraction.title}
                className="h-full w-full object-cover"
                src={activeImage || getPrimaryImageUrl(images)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />

              {images.length > 1 && (
                <React.Fragment>
                  <button
                    aria-label="Ảnh trước"
                    className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur-md transition hover:bg-white/40 group-hover:opacity-100"
                    onClick={() => goToGalleryImage(-1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      arrow_back_ios_new
                    </span>
                  </button>
                  <button
                    aria-label="Ảnh tiếp theo"
                    className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur-md transition hover:bg-white/40 group-hover:opacity-100"
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
                          {rating >= index + 1 ? 'star' : rating > index ? 'star_half' : 'star'}
                        </span>
                      ))}
                    </div>
                    <span className="font-bold text-[#00474d]">{rating ? rating.toFixed(1) : 'New'}</span>
                    <span className="text-sm font-semibold text-[#3f484a]">({reviewCount} đánh giá)</span>
                  </div>
                </div>
              </header>

              <div className="relative h-[240px] cursor-pointer overflow-hidden rounded-xl shadow-[0_4px_20px_rgba(0,96,104,0.04)]">
                <img
                  alt={`Bản đồ ${attraction.title}`}
                  className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuD4SQfZEiMvqJFA8JXu1XSAVXVbQC3saek2qaqrSTQnpEZl6Yt2UY26pnGFeGhs2TxKfl9ubg5G9d6PEfAualT8Y5KUNo8M66zKkH4wOABLefNgiYPja3eqgjT-7zOI34hJRwqJwCIhWjZwR6riy2St1eQkzw2u3jz1DgPd_lztB7tcP9tPPGppkXgYZI9yINIvgmhdcUQZq4SUhu3XpcVh5VlU9dECTRW_mm-ZU8ztcy3DCh6axjQDrtCJzWYLSvpBkqOIVSpwuXM"
                />
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-white/20 bg-white/75 px-4 py-2 text-sm font-bold text-[#00474d] backdrop-blur-md">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    map
                  </span>
                  Xem bản đồ chi tiết
                </div>
              </div>

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
                      aria-label={isFavorite ? 'Bỏ yêu thích' : 'Lưu yêu thích'}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-[#bec8ca] transition hover:border-[#ba1a1a] hover:text-[#ba1a1a] active:scale-95"
                      onClick={handleToggleFavorite}
                      type="button"
                    >
                      <span
                        className={`material-symbols-outlined text-[20px] transition ${
                          isFavorite ? 'text-[#ba1a1a]' : 'text-[#3f484a]'
                        }`}
                        style={{ fontVariationSettings: isFavorite ? "'FILL' 1" : "'FILL' 0" }}
                        aria-hidden="true"
                      >
                        favorite
                      </span>
                    </button>
                    <button
                      aria-label="Chia sẻ"
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-[#bec8ca] text-[#3f484a] transition hover:border-[#006068] hover:text-[#006068] active:scale-95"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">share</span>
                    </button>
                  </div>
                </div>

                {ticketProducts.length > 0 ? (
                  ticketProducts.map((ticket, index) => (
                    <TicketProductCard
                      isFeatured={index === 0}
                      key={ticket.id}
                      onChoose={() => handleOpenBookingModal(ticket)}
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
                      Tổng cộng ({Object.values(ticketQuantities).reduce((sum, qty) => sum + qty, 0)} vé)
                    </span>
                    <span className="text-xl font-bold text-[#00474d]">{formatCurrency(calculateTotal())}</span>
                  </div>
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#feb700] py-4 text-lg font-bold text-[#6b4b00] transition hover:shadow-[0_12px_32px_rgba(0,96,104,0.08)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={ticketProducts.length === 0}
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
                <p className="mb-4 text-sm font-bold text-[#00474d]">Tại sao chọn VietTicket?</p>
                <ul className="space-y-3">
                  {['Giá rẻ hơn tại quầy', 'Bỏ qua hàng chờ mua vé', 'Tích điểm đổi quà'].map((item) => (
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

      <Footer links={footerLinks} appButtons={appDownloadButtons} />

      {isBookingOpen && selectedTicketProduct && (
        <BookingModal
          attractionId={id}
          attractionImage={activeImage || getPrimaryImageUrl(images)}
          attractionLocation={getAddress(attraction)}
          attractionTitle={attraction.title}
          isOpen={isBookingOpen}
          onClose={() => setIsBookingOpen(false)}
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
          description="Nhận vé sau khi đặt thành công"
          icon="verified_user"
          title="Xác nhận tức thì"
        />
        <FeatureBox
          description="Chọn ngày và khung giờ phù hợp"
          icon="event_available"
          title="Linh hoạt thời gian"
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

function ReviewTab({ attraction }) {
  const rating = Number(attraction.averageRating || 0)
  const totalReviews = Number(attraction.totalReviews || 0)

  const mockReviews = [
    { initials: 'NT', name: 'Nguyễn Thị Thu', date: '05/2026', stars: 5, text: 'Trải nghiệm tuyệt vời! Cáp treo dài nhất thế giới thực sự ấn tượng. Cầu Vàng đẹp hơn trong ảnh nhiều lần. Nhân viên phục vụ nhiệt tình và chuyên nghiệp.' },
    { initials: 'TH', name: 'Trần Hoàng', date: '04/2026', stars: 4, text: 'Rất xứng đáng với số tiền bỏ ra. Khu Làng Pháp cực đẹp, nhà thờ cổ kính rất photogenic. Thức ăn ở đây hơi đắt nhưng chất lượng ổn. Nên đặt vé trực tuyến để bỏ qua hàng chờ.' },
    { initials: 'LM', name: 'Lê Minh', date: '03/2026', stars: 5, text: 'Đây là lần thứ 3 tôi đến Bà Nà Hills và lần nào cũng không thất vọng. VietTicket giúp tôi đặt vé nhanh, không cần xếp hàng. Cực kỳ tiện lợi!' },
  ]

  const displayRating = rating > 0 ? rating : 4.9
  const displayReviews = totalReviews > 0 ? totalReviews : 2540
  const ratingBars = [{ pct: 78 }, { pct: 15 }, { pct: 5 }, { pct: 1 }, { pct: 1 }]

  return (
    <div className="space-y-6">
      {/* Rating summary */}
      <div className="flex flex-col sm:flex-row gap-6 p-6 bg-[#006068]/5 rounded-2xl">
        <div className="text-center flex-shrink-0">
          <div className="text-[56px] font-bold text-[#006068] leading-none">{displayRating.toFixed(1)}</div>
          <div className="flex justify-center gap-0.5 my-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className="material-symbols-outlined text-[#feb700]" style={{ fontVariationSettings: "'FILL' 1", fontSize: '18px' }}>star</span>
            ))}
          </div>
          <p className="text-sm font-semibold text-[#3f484a]">{displayReviews.toLocaleString('vi-VN')} đánh giá</p>
        </div>
        <div className="flex-1 space-y-2">
          {ratingBars.map((bar, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#3f484a] w-4">{5 - i}</span>
              <span className="material-symbols-outlined text-[#feb700]" style={{ fontVariationSettings: "'FILL' 1", fontSize: '12px' }}>star</span>
              <div className="flex-1 h-2 bg-[#e2e2e5] rounded-full overflow-hidden">
                <div className="h-full bg-[#feb700] rounded-full transition-all" style={{ width: `${bar.pct}%` }} />
              </div>
              <span className="text-xs font-semibold text-[#3f484a] w-8">{bar.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Individual reviews */}
      <div className="space-y-5">
        {mockReviews.map((review, i) => (
          <div key={i} className={`flex gap-4 ${i < mockReviews.length - 1 ? 'pb-5 border-b border-[#bec8ca]/40' : ''}`}>
            <div className="w-11 h-11 rounded-full bg-[#006068]/10 flex items-center justify-center flex-shrink-0 font-bold text-sm text-[#006068]">
              {review.initials}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-bold text-sm text-[#1a1c1e]">{review.name}</h4>
                <span className="text-xs font-semibold text-[#3f484a]">{review.date}</span>
              </div>
              <div className="flex gap-0.5 mb-2">
                {Array.from({ length: review.stars }).map((_, j) => (
                  <span key={j} className="material-symbols-outlined text-[#feb700]" style={{ fontVariationSettings: "'FILL' 1", fontSize: '14px' }}>star</span>
                ))}
              </div>
              <p className="text-sm text-[#3f484a] leading-6">{review.text}</p>
            </div>
          </div>
        ))}
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
            {ticket.refundPolicy === 'NON_REFUNDABLE' ? 'Không hoàn tiền' : 'Hoàn tiền 100%'}
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
            disabled={quantity <= 0}
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
