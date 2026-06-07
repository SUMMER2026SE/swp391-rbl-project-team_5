import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import bookingService from '../services/bookingService.js'

const paymentMethods = [
  { id: 'vnpay', label: 'Ví VNPay', icon: 'account_balance_wallet' },
  { id: 'card', label: 'Thẻ tín dụng / Ghi nợ', icon: 'credit_card' },
  { id: 'onsite', label: 'Thanh toán khi đến nơi', icon: 'store' },
]

const checkoutNavLinks = [
  { label: 'Trang chủ', href: '/' },
  { label: 'Đặt vé', href: '/attractions', active: true },
  { label: 'Vé của tôi', href: '/my-tickets' },
]

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const formatCountdown = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const formatDate = (value) => {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
}

function CheckoutPage() {
  const { reservationId } = useParams()
  const navigate = useNavigate()
  const [booking, setBooking] = useState(() =>
    bookingService.getBookingDetails(reservationId),
  )
  const [selectedPayment, setSelectedPayment] = useState(
    booking?.paymentMethod || 'vnpay',
  )
  const [voucherCode, setVoucherCode] = useState(booking?.voucherCode || '')
  const [voucherMessage, setVoucherMessage] = useState('')
  const [voucherSuccess, setVoucherSuccess] = useState(Boolean(booking?.voucherCode))
  const [note, setNote] = useState(booking?.note || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [now, setNow] = useState(0)

  useEffect(() => {
    const refreshTime = () => setNow(Date.now())
    refreshTime()
    const timer = window.setInterval(refreshTime, 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Bug #2 fix: tính thời gian còn lại TRƯỚC early return (rules-of-hooks)
  // 'now === 0' nghĩa là interval chưa kịp chạy lần đầu → dùng expiresAt để tính lượng còn lại
  const expiresAtMs = booking ? new Date(booking.expiresAt).getTime() : 0
  const remainingMs = Math.max(0, expiresAtMs - (now > 0 ? now : expiresAtMs - 10 * 60 * 1000))

  if (!booking) {
    return (
      <>
        <Header links={checkoutNavLinks} />
        <main className="flex min-h-[65vh] items-center justify-center bg-surface px-5">
          <div className="max-w-lg text-center">
            <span className="material-symbols-outlined text-6xl text-error" aria-hidden="true">
              error
            </span>
            <h1 className="mt-4 text-3xl font-bold text-primary">
              Không tìm thấy đơn đặt vé
            </h1>
            <p className="mt-3 text-on-surface-variant">
              Đơn giữ chỗ không tồn tại hoặc đã bị xóa khỏi trình duyệt.
            </p>
            <Link
              className="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-bold text-white"
              to="/attractions"
            >
              Chọn vé khác
            </Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const isExpired =
    booking.status === 'unpaid' &&
    now > 0 &&
    expiresAtMs <= now

  const handleApplyVoucher = (event) => {
    event.preventDefault()
    const result = bookingService.applyVoucher(booking.id, voucherCode)
    setVoucherMessage(result.message)
    setVoucherSuccess(result.success)

    if (result.booking) {
      setBooking(result.booking)
    }
  }

  const handleConfirm = () => {
    setErrorMessage('')

    if (isExpired) {
      setErrorMessage('Thời gian giữ vé đã hết. Vui lòng tạo đơn đặt vé mới.')
      return
    }

    // Bug #3 fix: lưu ghi chú trước khi xử lý thanh toán
    if (note.trim()) {
      bookingService.updateNote(booking.id, note.trim())
    }

    setIsSubmitting(true)
    const processingBooking = bookingService.processPayment(
      booking.id,
      selectedPayment,
    )

    if (!processingBooking) {
      setErrorMessage('Không thể cập nhật phương thức thanh toán.')
      setIsSubmitting(false)
      return
    }

    if (selectedPayment === 'vnpay') {
      navigate(
        `/payment/vnpay-mock/${booking.id}?amount=${processingBooking.totalAmount}`,
      )
      return
    }

    // Bug #4 fix: onsite không đồng nghĩa pending_partner
    // pending_partner chỉ khi ticket cần đối tác duyệt thủ công
    const successStatus = booking.requiresPartnerApproval
      ? 'pending_partner'
      : 'confirmed'
    bookingService.confirmPayment(booking.id, successStatus)
    navigate(`/booking-success?vnpayResponseCode=00&bookingId=${booking.id}`)
  }

  const quantityLabel = [
    booking.adultCount ? `Người lớn x${booking.adultCount}` : '',
    booking.childCount ? `Trẻ em x${booking.childCount}` : '',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <Header links={checkoutNavLinks} />
      <main className="min-h-screen bg-surface px-5 py-8 md:px-12">
        <div className="mx-auto grid max-w-[1280px] items-start gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <nav className="flex flex-wrap items-center gap-1.5 text-sm text-on-surface-variant">
              <Link className="hover:text-primary" to="/">Trang chủ</Link>
              <span className="material-symbols-outlined text-base" aria-hidden="true">chevron_right</span>
              <Link className="hover:text-primary" to="/attractions">Đặt vé</Link>
              <span className="material-symbols-outlined text-base" aria-hidden="true">chevron_right</span>
              <span className="font-semibold text-primary">Xác nhận thanh toán</span>
            </nav>

            <h1 className="text-3xl font-bold text-primary md:text-4xl">
              Xác nhận đặt vé
            </h1>

            <section className="rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-3 text-lg font-bold text-on-surface">
                Chi tiết đặt chỗ
              </h2>
              <div className="divide-y divide-outline-variant/20">
                <BookingRow icon="location_on" label="Tên địa điểm" value={booking.attractionTitle} />
                <BookingRow icon="calendar_month" label="Ngày tham quan" value={formatDate(booking.visitDate)} />
                <BookingRow icon="schedule" label="Khung giờ" value={booking.timeSlotLabel} />
                <BookingRow icon="confirmation_number" label="Loại vé" value={`${booking.ticketName} (${quantityLabel || `${booking.quantity} vé`})`} />
                <BookingRow icon="tag" label="Mã đặt chỗ" value={booking.id} mono />
              </div>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-5 text-lg font-bold text-on-surface">
                Thông tin liên hệ
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnlyField
                  icon="person"
                  label="Họ tên"
                  value={booking.customer?.fullName || 'Khách hàng VietTicket'}
                />
                <ReadOnlyField
                  icon="mail"
                  label="Email"
                  value={booking.customer?.email || 'Chưa cập nhật'}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-4 text-lg font-bold text-on-surface">Ghi chú</h2>
              <textarea
                className="w-full resize-none rounded-xl border border-outline-variant/50 bg-surface-container-low p-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                onChange={(event) => setNote(event.target.value)}
                placeholder="Nhập yêu cầu đặc biệt (nếu có)..."
                rows={4}
                value={note}
              />
            </section>
          </div>

          <aside className="lg:sticky lg:top-28 lg:col-span-5">
            <div className="flex flex-col gap-6 rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <section>
                <h2 className="mb-4 text-lg font-bold text-on-surface">
                  Phương thức thanh toán
                </h2>
                <div className="flex flex-col gap-3">
                  {paymentMethods.map((method) => (
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition ${
                        selectedPayment === method.id
                          ? 'border-primary bg-primary/5'
                          : 'border-outline-variant/40 hover:border-primary/40'
                      }`}
                      htmlFor={`payment-${method.id}`}
                      key={method.id}
                    >
                      <input
                        checked={selectedPayment === method.id}
                        className="h-4 w-4 accent-primary"
                        id={`payment-${method.id}`}
                        name="paymentMethod"
                        onChange={() => setSelectedPayment(method.id)}
                        type="radio"
                      />
                      <span className="material-symbols-outlined text-primary" aria-hidden="true">
                        {method.icon}
                      </span>
                      <span className="font-semibold text-on-surface">{method.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <form className="border-t border-outline-variant/20 pt-5" onSubmit={handleApplyVoucher}>
                <label className="text-sm font-bold text-on-surface" htmlFor="voucher">
                  Mã ưu đãi
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-xl border border-outline-variant px-4 py-3 uppercase outline-none focus:border-primary"
                    id="voucher"
                    onChange={(event) => setVoucherCode(event.target.value)}
                    placeholder="GIAM20"
                    value={voucherCode}
                  />
                  <button
                    className="rounded-xl bg-secondary px-5 py-3 font-bold text-white"
                    type="submit"
                  >
                    Áp dụng
                  </button>
                </div>
                {voucherMessage && (
                  <p className={`mt-2 text-sm font-semibold ${voucherSuccess ? 'text-green-700' : 'text-error'}`}>
                    {voucherMessage}
                  </p>
                )}
                <p className="mt-2 text-xs text-on-surface-variant">
                  Thử mã GIAM20 hoặc VIETTICKET10.
                </p>
              </form>

              <section className="flex flex-col gap-3 border-t border-outline-variant/20 pt-5">
                {/* Bug #6 fix: chỉ hiển thị nếu adultCount > 0 */}
                {booking.adultCount > 0 && (
                  <PriceRow label={`Vé người lớn (x${booking.adultCount})`} value={booking.adultCount * booking.adultPrice} />
                )}
                {booking.childCount > 0 && (
                  <PriceRow label={`Vé trẻ em (x${booking.childCount})`} value={booking.childCount * booking.childPrice} />
                )}
                {booking.discountAmount > 0 && (
                  <PriceRow discount label={`Ưu đãi ${booking.voucherCode}`} value={booking.discountAmount} />
                )}
                <div className="mt-1 flex items-center justify-between border-t border-outline-variant/30 pt-4">
                  <span className="font-bold text-on-surface">Tổng cộng</span>
                  <span className="text-2xl font-extrabold text-primary">
                    {formatCurrency(booking.totalAmount)}
                  </span>
                </div>
              </section>

              {/* Bug #2 fix: countdown timer hiển thị thời gian còn lại */}
              {booking.status === 'unpaid' && !isExpired && (
                <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
                  remainingMs < 2 * 60 * 1000
                    ? 'bg-red-50 text-error'
                    : 'bg-tertiary-fixed/30 text-on-tertiary-fixed-variant'
                }`}>
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">timer</span>
                  <span>Giữ chỗ còn: <strong>{formatCountdown(remainingMs)}</strong></span>
                </div>
              )}
              {isExpired && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-error">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">timer_off</span>
                  Thời gian giữ chỗ đã hết. Vui lòng đặt vé lại.
                </div>
              )}

              {errorMessage && (
                <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-error">
                  {errorMessage}
                </p>
              )}

              <button
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#feb700] px-6 py-4 text-base font-bold text-gray-900 shadow-md transition hover:bg-[#e5a600] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting || isExpired}
                onClick={handleConfirm}
                type="button"
              >
                {isSubmitting ? 'Đang xử lý...' : 'Xác nhận & Thanh toán'}
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  arrow_forward
                </span>
              </button>
              <p className="text-center text-xs text-on-surface-variant">
                Không mất phí đặt vé • Thanh toán được mô phỏng trong môi trường demo
              </p>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}

function BookingRow({ icon, label, mono = false, value }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="material-symbols-outlined mt-0.5 shrink-0 text-primary" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="mb-0.5 text-xs text-on-surface-variant">{label}</p>
        <p className={mono ? 'font-mono font-bold tracking-wider text-primary' : 'font-semibold text-on-surface'}>
          {value}
        </p>
      </div>
    </div>
  )
}

function ReadOnlyField({ icon, label, value }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-on-surface-variant">{label}</span>
      <span className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant" aria-hidden="true">
          {icon}
        </span>
        <input
          className="w-full cursor-not-allowed rounded-xl border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-4 text-sm font-medium text-on-surface"
          readOnly
          value={value}
        />
      </span>
    </label>
  )
}

function PriceRow({ discount = false, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className={discount ? 'font-semibold text-green-700' : 'font-semibold text-on-surface'}>
        {discount ? '-' : ''}{formatCurrency(value)}
      </span>
    </div>
  )
}

export default CheckoutPage
