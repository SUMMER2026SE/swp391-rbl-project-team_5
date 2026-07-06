import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import RefundModal from '../components/tickets/RefundModal.jsx'
import ReviewModal from '../components/tickets/ReviewModal.jsx'
import useSocket from '../context/useSocket.js'
import bookingService from '../services/bookingService.js'
import { getBookingStatusMeta } from '../utils/bookingStatus.js'
import { hasUsableTicketInstances } from '../utils/ticketInstanceStatus.js'

const tabs = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unpaid', label: 'Chờ thanh toán' },
  { id: 'active', label: 'Đang sử dụng' },
  { id: 'history', label: 'Lịch sử' },
]

const fallbackImage =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80'

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const formatDate = (value) => {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

const getRemainingTime = (expiresAt, now) =>
  Math.max(0, new Date(expiresAt).getTime() - now)

const formatCountdown = (milliseconds) => {
  const totalSeconds = Math.ceil(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Mirror logic của backend `isReviewEligible`.
 * Trả về true khi booking được phép đánh giá:
 *  - COMPLETED: luôn được.
 *  - CONFIRMED + có ít nhất 1 vé USED + đã qua giờ kết thúc tham quan.
 *
 * visitDate được API trả về dạng 'YYYY-MM-DD' (UTC midnight của ngày tham quan).
 * timeSlotLabel dạng 'HH:MM - HH:MM' (giờ Việt Nam).
 * Backend là nguồn chính xác; frontend chỉ dùng để ẩn/hiện nút sớm.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

function parseEndTimeToMinutes(timeSlotLabel) {
  if (!timeSlotLabel) return null
  // dạng 'HH:MM - HH:MM' hoặc 'HH:MM-HH:MM'
  const parts = timeSlotLabel.split('-')
  if (parts.length < 2) return null
  const endStr = parts[parts.length - 1].trim()
  const match = endStr.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function canReviewNow(booking, nowMs) {
  const status = (booking.status || '').toLowerCase()
  if (status === 'completed') return true
  if (status !== 'confirmed') return false

  // Phải có ít nhất 1 vé USED
  const instances = Array.isArray(booking.ticketInstances) ? booking.ticketInstances : []
  const hasUsed = instances.some((t) => (t.status || '').toLowerCase() === 'used')
  if (!hasUsed) return false

  // Kiểm tra đã qua giờ kết thúc tham quan chưa
  const visitDate = booking.visitDate // 'YYYY-MM-DD'
  if (!visitDate) return false
  const visitDateUtcMs = new Date(`${visitDate}T00:00:00Z`).getTime()
  if (isNaN(visitDateUtcMs)) return false

  const endMinutes = parseEndTimeToMinutes(booking.timeSlotLabel)
  let deadlineMs
  if (endMinutes !== null) {
    // deadline UTC = visitDate UTC midnight + endTime(VN) - 7h offset
    deadlineMs = visitDateUtcMs + endMinutes * 60_000 - VN_OFFSET_MS
  } else {
    // Không có time slot → 00:00 VN ngày kế tiếp = visitDate UTC + 17h
    deadlineMs = visitDateUtcMs + (24 * 60 - 0) * 60_000 - VN_OFFSET_MS
  }

  return nowMs >= deadlineMs
}

function MyTicketsPage() {
  const navigate = useNavigate()
  const socket = useSocket()
  const [activeTab, setActiveTab] = useState('all')
  const [bookings, setBookings] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedReviewBooking, setSelectedReviewBooking] = useState(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true

    bookingService
      .getBookings()
      .then((data) => {
        if (active) setBookings(data)
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function handleBookingStatusUpdated(payload) {
      const status = String(payload.status || '').toLowerCase()
      const shortCode = String(payload.bookingId || '').slice(0, 8).toUpperCase()

      let message = payload.message
      if (!message) {
        if (status === 'confirmed' || status === 'completed') {
          message = `Đặt vé ${shortCode} của bạn đã được phê duyệt thành công!`
        } else if (status === 'pending_partner') {
          message = `Đơn hàng ${shortCode} đã thanh toán thành công và đang chờ đối tác phê duyệt.`
        } else {
          message = `Rất tiếc, yêu cầu đặt vé ${shortCode} đã bị từ chối.`
        }
      }

      if (status === 'confirmed' || status === 'completed') toast.success(message)
      else if (status === 'pending_partner') toast.info(message)
      else toast.error(message)

      setBookings((current) =>
        current.map((booking) =>
          booking.id === payload.bookingId ? { ...booking, status } : booking,
        ),
      )

      void bookingService
        .getBookings()
        .then((data) => {
          setBookings(data)
          setErrorMessage('')
        })
        .catch(() => {
          // The optimistic status update remains visible until the next normal fetch.
        })
    }

    socket.on('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    return () => {
      socket.off('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    }
  }, [socket])

  const refetchBookings = () => {
    void bookingService
      .getBookings()
      .then((data) => setBookings(data))
      .catch(() => {
        // Giữ nguyên danh sách hiện tại nếu tải lại thất bại.
      })
  }

  const filteredBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        const isExpired =
          booking.status === 'unpaid' &&
          getRemainingTime(booking.expiresAt, now) === 0

        if (activeTab === 'unpaid') return booking.status === 'unpaid' && !isExpired
        if (activeTab === 'active') {
          // Vé đang chờ duyệt hoàn tiền vẫn là vé "đang sử dụng" cho tới khi có kết quả.
          return ['confirmed', 'pending_partner', 'refund_requested'].includes(booking.status)
        }
        if (activeTab === 'history') {
          return (
            isExpired ||
            ['completed', 'cancelled', 'refunded'].includes(booking.status)
          )
        }
        return true
      }),
    [activeTab, bookings, now],
  )

  return (
    <>
      <Header activeLink="My Tickets" />
      <div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[1440px] bg-surface">
        <aside className="hidden w-64 shrink-0 border-r border-outline-variant/30 bg-surface-container-lowest p-6 md:block">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-primary">Xin chào</h2>
            <p className="mt-1 text-sm font-medium text-on-surface-variant">
              Sẵn sàng cho hành trình tiếp theo
            </p>
          </div>
          <nav className="flex flex-col gap-2">
            <SidebarLink href="/profile" icon="person" label="Hồ sơ" />
            <SidebarLink
              active
              href="/my-tickets"
              icon="confirmation_number"
              label="Vé của tôi"
            />
            <SidebarLink href="/favorites" icon="favorite" label="Yêu thích" />
            <SidebarLink href="/my-support" icon="support_agent" label="Hỗ trợ của tôi" />
            <SidebarLink href="/change-password" icon="settings" label="Cài đặt" />
          </nav>
          <button
            className="mt-8 w-full rounded-xl bg-gradient-to-r from-primary to-secondary px-4 py-3 font-bold text-on-primary shadow-md transition active:scale-95"
            onClick={() => navigate('/attractions')}
            type="button"
          >
            Đặt chuyến mới
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-8 md:p-8 lg:px-16">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-primary md:text-4xl">Vé của tôi</h1>
            <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
              {tabs.map((tab) => (
                <button
                  className={`whitespace-nowrap rounded-full px-6 py-2.5 text-sm font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex max-w-4xl flex-col gap-6">
            {isLoading ? (
              <p className="py-12 text-center font-semibold text-primary">
                Đang tải danh sách vé...
              </p>
            ) : errorMessage ? (
              <p className="rounded-xl bg-red-50 p-4 text-center font-semibold text-error">
                {errorMessage}
              </p>
            ) : filteredBookings.length === 0 ? (
              <EmptyTickets activeTab={activeTab} />
            ) : (
              filteredBookings.map((booking) => (
                <TicketCard
                  booking={booking}
                  key={booking.id}
                  now={now}
                  onRefetch={refetchBookings}
                  onOpenReview={setSelectedReviewBooking}
                />
              ))
            )}
          </div>
        </main>
      </div>
      <Footer />
      {selectedReviewBooking && (
        <ReviewModal
          booking={selectedReviewBooking}
          onClose={() => setSelectedReviewBooking(null)}
          onSuccess={refetchBookings}
        />
      )}
    </>
  )
}

function SidebarLink({ active = false, href, icon, label }) {
  return (
    <Link
      className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
        active
          ? 'bg-secondary-fixed text-on-secondary-fixed shadow-sm'
          : 'text-on-surface-variant hover:bg-surface-container-high'
      }`}
      to={href}
    >
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
      {label}
    </Link>
  )
}

function TicketCard({ booking, now, onRefetch, onOpenReview }) {
  const [showRefund, setShowRefund] = useState(false)
  const remainingTime = getRemainingTime(booking.expiresAt, now)
  const isExpired = booking.status === 'unpaid' && remainingTime === 0
  const hasUsableQr = hasUsableTicketInstances(booking.ticketInstances)
  const quantityText = `${booking.quantity || 1} vé`

  return (
    <>
    <article className="group overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-[0_4px_20px_rgba(0,40,50,0.05)] transition hover:shadow-[0_8px_30px_rgba(0,40,50,0.08)] md:flex">
      <div className="h-48 overflow-hidden md:h-auto md:w-64 md:shrink-0">
        <img
          alt={booking.attractionTitle}
          className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
          src={booking.attractionImage || fallbackImage}
        />
      </div>
      <div className="flex flex-1 flex-col justify-between p-6">
        <div>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-on-surface">
                {booking.attractionTitle}
              </h2>
              <p className="mt-1 flex items-center gap-1 text-sm font-medium text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  location_on
                </span>
                {booking.attractionLocation}
              </p>
            </div>
            <StatusBadge booking={booking} isExpired={isExpired} />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <TicketFact label="Mã đặt chỗ" value={booking.id} />
            <TicketFact label="Ngày" value={formatDate(booking.visitDate)} />
            <TicketFact label="Số lượng" value={quantityText} />
            <TicketFact
              emphasized
              label="Giá"
              value={formatCurrency(booking.totalAmount)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-outline-variant/30 pt-4">
          {booking.status === 'unpaid' && !isExpired && (
            <>
              <span className="mr-auto flex items-center gap-1 text-sm font-semibold text-error">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  timer
                </span>
                {formatCountdown(remainingTime)} còn lại
              </span>
              <Link
                className="rounded-xl bg-primary px-7 py-2.5 font-bold text-on-primary transition hover:brightness-110 active:scale-95"
                to={`/checkout/${booking.reservationId}`}
              >
                Thanh toán ngay
              </Link>
            </>
          )}
          {booking.status === 'confirmed' && (
            <>
              {booking.refundRequest?.status === 'REJECTED' ? (
                <div className="mr-auto flex items-start gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm">
                  <span
                    className="material-symbols-outlined mt-0.5 text-[18px] text-error"
                    aria-hidden="true"
                  >
                    block
                  </span>
                  <div>
                    <p className="font-bold text-error">Yêu cầu hoàn tiền đã bị từ chối</p>
                    {booking.refundRequest.staffNotes && (
                      <p className="mt-0.5 text-xs text-on-surface-variant">
                        Lý do: {booking.refundRequest.staffNotes}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-error transition hover:bg-error/5 active:scale-95"
                  onClick={() => setShowRefund(true)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    currency_exchange
                  </span>
                  Yêu cầu hoàn tiền
                </button>
              )}
              <Link
                className="flex items-center gap-2 rounded-xl border border-primary px-7 py-2.5 font-bold text-primary transition hover:bg-primary/5 active:scale-95"
                to={`/tickets/${booking.id}`}
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  {hasUsableQr ? 'qr_code_2' : 'receipt_long'}
                </span>
                {hasUsableQr ? 'Xem mã QR' : 'Xem chi tiết vé'}
              </Link>
            </>
          )}
          {booking.status === 'refund_requested' && (
            <span className="flex items-center gap-1 text-sm font-semibold text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                hourglass_top
              </span>
              Đang chờ duyệt hoàn tiền
              {booking.refundRequest
                ? ` — dự kiến nhận ${formatCurrency(booking.refundRequest.amount)}`
                : ''}
            </span>
          )}
          {booking.status === 'refunded' && (
            <span className="flex items-center gap-1 text-sm font-semibold text-primary">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                price_check
              </span>
              Đã hoàn {booking.refundRequest ? formatCurrency(booking.refundRequest.amount) : 'tiền'}
              {' — tiền về tài khoản trong 3-5 ngày làm việc'}
            </span>
          )}
          {canReviewNow(booking, now) && !(booking.reviewed || booking.review) && (
            <button
              className="flex items-center gap-2 rounded-xl bg-secondary-container text-on-secondary-container px-7 py-2.5 font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-sm"
              onClick={() => onOpenReview(booking)}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                rate_review
              </span>
              Đánh giá ngay
            </button>
          )}
          {canReviewNow(booking, now) && (booking.reviewed || booking.review) && (
            <>
              <div className="flex gap-0.5 text-[#feb700] mr-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className="material-symbols-outlined text-[18px]"
                    style={{ fontVariationSettings: i < (booking.rating || booking.review?.rating || 5) ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    star
                  </span>
                ))}
              </div>
              <button
                className="flex items-center gap-2 rounded-xl bg-surface-container text-on-surface-variant px-7 py-2.5 font-bold cursor-default"
                disabled
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  check_circle
                </span>
                Đã gửi đánh giá
              </button>
            </>
          )}
          {isExpired && (
            <span className="text-sm font-semibold text-on-surface-variant">
              Thời gian giữ vé đã kết thúc
            </span>
          )}
        </div>
      </div>
    </article>
    {showRefund && (
      <RefundModal
        booking={booking}
        onClose={() => setShowRefund(false)}
        onSuccess={onRefetch}
      />
    )}
    </>
  )
}

function StatusBadge({ booking, isExpired }) {
  // Nhãn + màu lấy từ nguồn dùng chung; riêng 2 trường hợp đặc thù của trang này
  // (đơn quá hạn thanh toán, đơn hoàn thành đã đánh giá) thì ghi đè tại chỗ.
  let statusConfig
  if (isExpired) {
    statusConfig = { label: 'Đã hết hạn', className: 'bg-surface-container-high text-on-surface-variant' }
  } else if (booking.status === 'completed' && (booking.reviewed || booking.review)) {
    statusConfig = { label: 'Đã xong & Đánh giá', className: 'bg-outline text-white' }
  } else {
    statusConfig = getBookingStatusMeta(booking.status)
  }

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusConfig.className}`}>
      {statusConfig.label}
    </span>
  )
}

function TicketFact({ emphasized = false, label, value }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p className={emphasized ? 'text-lg font-bold text-primary' : 'font-semibold text-on-surface'}>
        {value}
      </p>
    </div>
  )
}

function EmptyTickets({ activeTab }) {
  return (
    <div className="rounded-2xl border border-dashed border-outline-variant bg-white px-6 py-16 text-center">
      <span className="material-symbols-outlined text-5xl text-primary" aria-hidden="true">
        confirmation_number
      </span>
      <h2 className="mt-4 text-xl font-bold text-on-surface">Chưa có vé phù hợp</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-on-surface-variant">
        {activeTab === 'all'
          ? 'Các vé bạn đặt sẽ xuất hiện tại đây và được lưu lại ngay cả khi tải lại trang.'
          : 'Không có vé nào trong trạng thái này.'}
      </p>
      <Link
        className="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-bold text-on-primary"
        to="/attractions"
      >
        Khám phá điểm tham quan
      </Link>
    </div>
  )
}

export default MyTicketsPage
