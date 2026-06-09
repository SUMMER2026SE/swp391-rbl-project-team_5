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
  const [booking, setBooking] = useState(null)
  const [contact, setContact] = useState({
    fullName: '',
    email: '',
    phone: '',
  })
  const [selectedPayment, setSelectedPayment] = useState('vnpay')
  const [voucherCode, setVoucherCode] = useState('')
  const [appliedVoucherCode, setAppliedVoucherCode] = useState('')
  const [voucherMessage, setVoucherMessage] = useState('')
  const [voucherSuccess, setVoucherSuccess] = useState(false)
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isApplyingVoucher, setIsApplyingVoucher] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [now, setNow] = useState(0)

  useEffect(() => {
    let active = true

    const loadReservation = async () => {
      try {
        const reservation = await bookingService.getReservationDetails(
          reservationId,
        )
        if (!active) return

        setBooking(reservation)
        setContact({
          fullName: reservation.customer?.fullName || '',
          email: reservation.customer?.email || '',
          phone: reservation.customer?.phone || '',
        })
      } catch (error) {
        if (active) setErrorMessage(error.message)
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadReservation()
    return () => {
      active = false
    }
  }, [reservationId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const expiresAtMs = booking ? new Date(booking.expiresAt).getTime() : 0
  const remainingMs = booking
    ? Math.max(0, expiresAtMs - (now || expiresAtMs))
    : 0
  const isExpired = Boolean(
    booking && now > 0 && booking.status === 'held' && expiresAtMs <= now,
  )

  const handleContactChange = (field) => (event) => {
    setContact((current) => ({ ...current, [field]: event.target.value }))
  }

  const handleVoucherChange = (event) => {
    const nextCode = event.target.value
    setVoucherCode(nextCode)
    setVoucherMessage('')
    setVoucherSuccess(false)

    if (appliedVoucherCode) {
      setAppliedVoucherCode('')
      setBooking((current) =>
        current
          ? {
              ...current,
              voucherCode: '',
              discountAmount: 0,
              totalAmount: current.subtotalAmount,
            }
          : current,
      )
    }
  }

  const handleApplyVoucher = async (event) => {
    event.preventDefault()
    if (!booking || isApplyingVoucher) return

    setIsApplyingVoucher(true)
    setVoucherMessage('')

    try {
      const result = await bookingService.applyVoucher(
        booking.id,
        voucherCode,
        booking.subtotalAmount,
      )
      const normalizedCode = result.data.voucher.code

      setBooking((current) => ({
        ...current,
        voucherCode: normalizedCode,
        discountAmount: result.data.discountAmount,
        totalAmount: result.data.totalAmount,
      }))
      setVoucherCode(normalizedCode)
      setAppliedVoucherCode(normalizedCode)
      setVoucherMessage(result.message)
      setVoucherSuccess(true)
    } catch (error) {
      setVoucherMessage(error.message)
      setVoucherSuccess(false)
    } finally {
      setIsApplyingVoucher(false)
    }
  }

  const handleConfirm = async () => {
    if (!booking || isSubmitting) return

    setErrorMessage('')
    if (isExpired) {
      setErrorMessage('Thời gian giữ vé đã hết. Vui lòng tạo đơn đặt vé mới.')
      return
    }
    if (!contact.fullName.trim() || !contact.email.trim()) {
      setErrorMessage('Vui lòng nhập đầy đủ họ tên và email.')
      return
    }

    setIsSubmitting(true)
    try {
      const createdBooking = await bookingService.createBooking({
        reservationId: booking.id,
        fullName: contact.fullName.trim(),
        email: contact.email.trim(),
        phone: contact.phone.trim(),
        note: note.trim(),
        voucherCode: appliedVoucherCode || undefined,
        paymentMethod: selectedPayment,
      })

      if (selectedPayment === 'onsite') {
        navigate(
          `/booking-success?vnpayResponseCode=00&bookingId=${createdBooking.id}`,
        )
        return
      }

      navigate(
        `/payment/vnpay-mock/${createdBooking.id}?amount=${createdBooking.totalAmount}`,
      )
    } catch (error) {
      setErrorMessage(error.message)
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <>
        <Header links={checkoutNavLinks} />
        <main className="flex min-h-[65vh] items-center justify-center bg-surface">
          <p className="font-semibold text-primary">Đang tải đơn giữ chỗ...</p>
        </main>
        <Footer />
      </>
    )
  }

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
              Không tìm thấy đơn giữ chỗ
            </h1>
            <p className="mt-3 text-on-surface-variant">
              {errorMessage || 'Đơn giữ chỗ không tồn tại hoặc bạn không có quyền truy cập.'}
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
                <BookingRow icon="confirmation_number" label="Loại vé" value={`${booking.ticketName} (${booking.quantity} vé)`} />
                <BookingRow icon="tag" label="Mã giữ chỗ" value={booking.id} mono />
              </div>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-5 text-lg font-bold text-on-surface">
                Thông tin liên hệ
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <ContactField
                  autoComplete="name"
                  icon="person"
                  label="Họ tên"
                  onChange={handleContactChange('fullName')}
                  required
                  value={contact.fullName}
                />
                <ContactField
                  autoComplete="email"
                  icon="mail"
                  label="Email"
                  onChange={handleContactChange('email')}
                  required
                  type="email"
                  value={contact.email}
                />
                <ContactField
                  autoComplete="tel"
                  icon="phone"
                  label="Số điện thoại"
                  onChange={handleContactChange('phone')}
                  type="tel"
                  value={contact.phone}
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
                    onChange={handleVoucherChange}
                    placeholder="GIAM20"
                    value={voucherCode}
                  />
                  <button
                    className="rounded-xl bg-secondary px-5 py-3 font-bold text-white disabled:opacity-60"
                    disabled={isApplyingVoucher}
                    type="submit"
                  >
                    {isApplyingVoucher ? 'Đang kiểm tra...' : 'Áp dụng'}
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
                <PriceRow
                  label={`${booking.ticketName} (x${booking.quantity})`}
                  value={booking.subtotalAmount}
                />
                {booking.discountAmount > 0 && (
                  <PriceRow
                    discount
                    label={`Ưu đãi ${booking.voucherCode}`}
                    value={booking.discountAmount}
                  />
                )}
                <div className="mt-1 flex items-center justify-between border-t border-outline-variant/30 pt-4">
                  <span className="font-bold text-on-surface">Tổng cộng</span>
                  <span className="text-2xl font-extrabold text-primary">
                    {formatCurrency(booking.totalAmount)}
                  </span>
                </div>
              </section>

              {!isExpired && (
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
                Giá và ưu đãi được xác nhận lại tại máy chủ trước khi tạo đơn.
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

function ContactField({
  autoComplete,
  icon,
  label,
  onChange,
  required = false,
  type = 'text',
  value,
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-on-surface-variant">{label}</span>
      <span className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant" aria-hidden="true">
          {icon}
        </span>
        <input
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-4 text-sm font-medium text-on-surface outline-none focus:border-primary"
          onChange={onChange}
          required={required}
          type={type}
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
