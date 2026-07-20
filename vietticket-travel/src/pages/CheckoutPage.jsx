import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import bookingService from '../services/bookingService.js'
import { markItineraryQueueItemReserved } from '../utils/aiItineraryBookingQueue.js'
import { formatReservationReference } from '../utils/bookingReference.js'
import { validateEmail, validateOptionalPhone } from '../utils/formValidators.js'

const paymentMethods = [
  { id: 'vnpay', label: 'Ví VNPay', icon: 'account_balance_wallet' },
]

const checkoutNavLinks = [
  { label: 'Trang chủ', href: '/' },
  { label: 'Đặt vé', href: '/attractions', active: true },
  { label: 'Vé của tôi', href: '/my-tickets' },
]

const checkoutMilestones = [
  { label: 'Kiểm tra đơn', icon: 'fact_check' },
  { label: 'Thanh toán VNPay', icon: 'account_balance_wallet' },
  { label: 'Nhận vé QR', icon: 'qr_code_2' },
]

const checkoutTrustItems = [
  {
    title: 'Thanh toán bảo mật',
    description: 'Giao dịch được chuyển qua cổng VNPay, VietTicket không lưu thông tin thẻ.',
    icon: 'lock',
  },
  {
    title: 'Vé điện tử rõ ràng',
    description: 'Vé QR nằm trong mục Vé của tôi sau khi thanh toán và đơn được xác nhận.',
    icon: 'confirmation_number',
  },
  {
    title: 'Hỗ trợ sau đặt vé',
    description: 'Mã đặt chỗ giúp đội hỗ trợ tra cứu nhanh khi lịch trình thay đổi.',
    icon: 'support_agent',
  },
]

const checkoutChecklistItems = [
  { label: 'Ngày và khung giờ tham quan đã đúng', icon: 'event_available' },
  { label: 'Email nhận vé có thể truy cập', icon: 'mark_email_read' },
  { label: 'Chính sách hoàn/hủy đã được kiểm tra', icon: 'currency_exchange' },
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
  const [searchParams] = useSearchParams()
  const aiQueueId = searchParams.get('aiQueueId') || ''
  const aiQueueItemId = searchParams.get('aiQueueItemId') || ''
  const isAiItineraryCheckout = Boolean(aiQueueId && aiQueueItemId)
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
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true

    const loadReservation = async () => {
      try {
        const reservation = await bookingService.getReservationDetails(
          reservationId,
        )
        if (!active) return

        let finalBookingData = { ...reservation }

        if (reservation.bookingId) {
          try {
            const bookingDetails = await bookingService.getBookingDetails(
              reservation.bookingId,
            )
            finalBookingData = {
              ...reservation,
              fullName: bookingDetails.customer?.fullName || reservation.customer?.fullName,
              email: bookingDetails.customer?.email || reservation.customer?.email,
              phone: bookingDetails.customer?.phone || reservation.customer?.phone,
              note: bookingDetails.note || '',
              paymentMethod: bookingDetails.paymentMethod,
              voucherCode: bookingDetails.voucherCode || '',
              discountAmount: bookingDetails.discountAmount || 0,
              totalAmount: bookingDetails.totalAmount,
            }
            setContact({
              fullName: finalBookingData.fullName || '',
              email: finalBookingData.email || '',
              phone: finalBookingData.phone || '',
            })
            setNote(finalBookingData.note || '')
            setSelectedPayment(finalBookingData.paymentMethod || 'vnpay')
            setVoucherCode(finalBookingData.voucherCode || '')
            setAppliedVoucherCode(finalBookingData.voucherCode || '')
          } catch (bookingError) {
            console.error('Không thể tải chi tiết đơn hàng cũ:', bookingError)
          }
        } else {
          setContact({
            fullName: reservation.customer?.fullName || '',
            email: reservation.customer?.email || '',
            phone: reservation.customer?.phone || '',
          })
        }

        setBooking(finalBookingData)
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
  const hasVoucherCode = voucherCode.trim().length > 0

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
    if (!hasVoucherCode) {
      setVoucherMessage('Vui lòng nhập mã ưu đãi.')
      setVoucherSuccess(false)
      return
    }

    setIsApplyingVoucher(true)
    setVoucherMessage('')

    try {
      const result = await bookingService.applyVoucher(
        booking.id,
        voucherCode,
        booking.subtotalAmount,
      )
      const normalizedCode = result.data?.voucher?.code || voucherCode.trim()

      setBooking((current) =>
        current
          ? {
              ...current,
              voucherCode: normalizedCode,
              discountAmount: Number(result.data?.discountAmount) || 0,
              totalAmount: result.data?.totalAmount ?? current.totalAmount,
            }
          : current,
      )
      setVoucherCode(normalizedCode)
      setAppliedVoucherCode(normalizedCode)
      setVoucherMessage(result.message || 'Đã áp dụng mã ưu đãi.')
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

    const emailError = validateEmail(contact.email)
    if (emailError) {
      setErrorMessage(emailError)
      return
    }
    const phoneError = validateOptionalPhone(contact.phone)
    if (phoneError) {
      setErrorMessage(phoneError)
      return
    }

    setIsSubmitting(true)
    try {
      let bookingId = booking.bookingId
      if (!bookingId) {
        const createdBooking = await bookingService.createBooking({
          reservationId: booking.id,
          fullName: contact.fullName.trim(),
          email: contact.email.trim(),
          phone: contact.phone.trim(),
          note: note.trim(),
          voucherCode: appliedVoucherCode || undefined,
          paymentMethod: selectedPayment,
        })
        bookingId = createdBooking.id
      }

      if (isAiItineraryCheckout) {
        markItineraryQueueItemReserved({
          bookingId,
          itemId: aiQueueItemId,
          queueId: aiQueueId,
          reservationId: booking.id,
        })
      }

      // VNPay: lấy URL thanh toán thật rồi chuyển hướng trình duyệt sang cổng.
      const paymentUrl = await bookingService.createVNPayUrl(bookingId)
      if (!paymentUrl) {
        throw new Error('Không tạo được liên kết thanh toán VNPay. Vui lòng thử lại.')
      }
      window.location.href = paymentUrl
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

            <CheckoutMilestones hasCreatedBooking={Boolean(booking.bookingId)} />

            {isAiItineraryCheckout && (
              <div className="rounded-2xl border border-[#a6eff8] bg-[#eefcff] p-4 text-sm font-semibold text-[#00474d]">
                <span className="material-symbols-outlined mr-2 align-[-4px] text-[20px]" aria-hidden="true">
                  route
                </span>
                Bạn đang thanh toán một vé trong lịch trình AI. Sau khi thanh toán thành công, hệ thống sẽ gợi ý vé tiếp theo trong lịch trình.
              </div>
            )}

            <section className="rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-3 text-lg font-bold text-on-surface">
                Chi tiết đặt chỗ
              </h2>
              <div className="divide-y divide-outline-variant/20">
                <BookingRow icon="location_on" label="Tên địa điểm" value={booking.attractionTitle} />
                <BookingRow icon="calendar_month" label="Ngày tham quan" value={formatDate(booking.visitDate)} />
                <BookingRow icon="schedule" label="Khung giờ" value={booking.timeSlotLabel} />
                <BookingRow icon="confirmation_number" label="Loại vé" value={`${booking.ticketName} (${booking.quantity} vé)`} />
                <BookingRow icon="tag" label="Mã giữ chỗ" value={formatReservationReference(booking.id)} mono />
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
                  disabled={Boolean(booking.bookingId)}
                />
                <ContactField
                  autoComplete="email"
                  icon="mail"
                  label="Email"
                  onChange={handleContactChange('email')}
                  required
                  type="email"
                  value={contact.email}
                  disabled={Boolean(booking.bookingId)}
                />
                <ContactField
                  autoComplete="tel"
                  icon="phone"
                  label="Số điện thoại"
                  onChange={handleContactChange('phone')}
                  type="tel"
                  value={contact.phone}
                  disabled={Boolean(booking.bookingId)}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-4 text-lg font-bold text-on-surface">Ghi chú</h2>
              <textarea
                className="w-full resize-none rounded-xl border border-outline-variant/50 bg-surface-container-low p-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60 disabled:cursor-not-allowed"
                onChange={(event) => setNote(event.target.value)}
                placeholder="Nhập yêu cầu đặc biệt (nếu có)..."
                rows={4}
                value={note}
                disabled={Boolean(booking.bookingId)}
              />
            </section>
          </div>

          <aside className="lg:sticky lg:top-28 lg:col-span-5">
            <div className="flex flex-col gap-6 rounded-2xl border border-outline-variant/20 bg-white p-6 shadow-sm md:p-8">
              <CheckoutTrustPanel />

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
                      } ${booking.bookingId ? 'opacity-70 cursor-not-allowed' : ''}`}
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
                        disabled={Boolean(booking.bookingId)}
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
                    className="min-w-0 flex-1 rounded-xl border border-outline-variant px-4 py-3 uppercase outline-none focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
                    id="voucher"
                    onChange={handleVoucherChange}
                    placeholder="NHAPMA"
                    value={voucherCode}
                    disabled={Boolean(booking.bookingId)}
                  />
                  <button
                    className="rounded-xl bg-secondary px-5 py-3 font-bold text-white disabled:opacity-60"
                    disabled={isApplyingVoucher || Boolean(booking.bookingId) || !hasVoucherCode}
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
                {!booking.bookingId && (
                  <p className="mt-2 text-xs text-on-surface-variant">
                    Nhập mã ưu đãi nếu bạn có.
                  </p>
                )}
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

              <CheckoutChecklist />

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

              {booking.bookingId && (
                <p className="text-sm font-bold text-green-700 bg-green-50 p-3 rounded-xl">
                  Đơn hàng đã được tạo thành công. Hãy thanh toán; vé QR được phát
                  hành sau khi đơn được xác nhận.
                </p>
              )}

              <button
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#feb700] px-6 py-4 text-base font-bold text-gray-900 shadow-md transition hover:bg-[#e5a600] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting || isExpired}
                onClick={handleConfirm}
                type="button"
              >
                {isSubmitting ? 'Đang xử lý...' : booking.bookingId ? 'Thanh toán ngay' : 'Xác nhận & Thanh toán'}
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

function CheckoutMilestones({ hasCreatedBooking }) {
  const activeIndex = hasCreatedBooking ? 1 : 0

  return (
    <div className="grid gap-3 rounded-2xl border border-outline-variant/20 bg-white p-4 shadow-sm sm:grid-cols-3">
      {checkoutMilestones.map((step, index) => {
        const isActive = index <= activeIndex

        return (
          <div
            className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
              isActive ? 'bg-primary/5 text-primary' : 'text-on-surface-variant'
            }`}
            key={step.label}
          >
            <span
              className={`material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[20px] ${
                isActive ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'
              }`}
              aria-hidden="true"
            >
              {step.icon}
            </span>
            <div>
              <p className="text-xs font-semibold uppercase text-on-surface-variant">
                Bước {index + 1}
              </p>
              <p className="text-sm font-extrabold">{step.label}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CheckoutTrustPanel() {
  return (
    <section className="rounded-2xl bg-[#eefcff] p-5">
      <h2 className="text-base font-extrabold text-[#00474d]">
        Yên tâm trước khi thanh toán
      </h2>
      <div className="mt-4 grid gap-3">
        {checkoutTrustItems.map((item) => (
          <div className="flex gap-3" key={item.title}>
            <span
              className="material-symbols-outlined mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[19px] text-[#006068]"
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <div>
              <p className="text-sm font-extrabold text-[#1a1c1e]">{item.title}</p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-[#3e494a]">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CheckoutChecklist() {
  return (
    <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
      <h2 className="text-base font-extrabold text-on-surface">
        Kiểm tra nhanh trước khi trả tiền
      </h2>
      <div className="mt-4 grid gap-2.5">
        {checkoutChecklistItems.map((item) => (
          <div className="flex items-center gap-2 text-sm font-semibold text-on-surface-variant" key={item.label}>
            <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </div>
        ))}
      </div>
    </section>
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
  disabled = false,
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
          className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-4 text-sm font-medium text-on-surface outline-none focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
          onChange={onChange}
          required={required}
          type={type}
          value={value}
          disabled={disabled}
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
