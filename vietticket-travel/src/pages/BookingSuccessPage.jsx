import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import bookingService from '../services/bookingService.js'

const formatDate = (value) => {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function BookingSuccessPage() {
  const [searchParams] = useSearchParams()
  // Backend /vnpay-return redirect về với ?status=...&vnp_ResponseCode=...
  const statusParam = searchParams.get('status')
  const responseCode =
    searchParams.get('vnp_ResponseCode') || searchParams.get('vnpayResponseCode')
  const bookingId = searchParams.get('bookingId')
  const [booking, setBooking] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const isSuccess = statusParam ? statusParam === 'success' : responseCode === '00'
  const isPendingPartner = booking?.status === 'pending_partner'

  const handleRetry = async () => {
    if (!bookingId || retrying) return
    setRetrying(true)
    setRetryError('')
    try {
      const paymentUrl = await bookingService.createVNPayUrl(bookingId)
      if (!paymentUrl) throw new Error('Không tạo được liên kết thanh toán.')
      window.location.href = paymentUrl
    } catch (error) {
      setRetryError(error.message)
      setRetrying(false)
    }
  }

  useEffect(() => {
    let active = true

    if (bookingId) {
      bookingService
        .getBookingDetails(bookingId)
        .then((data) => {
          if (active) setBooking(data)
        })
        .catch(() => {
          if (active) setBooking(null)
        })
    }

    return () => {
      active = false
    }
  }, [bookingId])

  return (
    <>
      <Header activeLink="My Tickets" />
      <main className="flex min-h-[70vh] items-center justify-center bg-surface px-5 py-12">
        <section className="w-full max-w-xl rounded-3xl bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,71,77,0.12)] md:p-10">
          <div
            className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full ${
              isSuccess
                ? isPendingPartner
                  ? 'bg-tertiary-fixed'
                  : 'bg-primary-container'
                : 'bg-red-100'
            }`}
          >
            <span
              className={`material-symbols-outlined text-5xl ${
                isSuccess
                  ? isPendingPartner
                    ? 'text-tertiary'
                    : 'text-white'
                  : 'text-error'
              }`}
              aria-hidden="true"
            >
              {isSuccess ? (isPendingPartner ? 'hourglass_top' : 'check_circle') : 'error'}
            </span>
          </div>

          <h1 className={`mt-6 text-3xl font-extrabold md:text-4xl ${isSuccess ? 'text-primary' : 'text-error'}`}>
            {isSuccess
              ? isPendingPartner
                ? 'Đang chờ đối tác duyệt'
                : 'Đặt vé thành công!'
              : 'Thanh toán chưa thành công'}
          </h1>

          <p className="mt-3 leading-relaxed text-on-surface-variant">
            {isSuccess
              ? isPendingPartner
                ? 'Thanh toán đã được ghi nhận. VietTicket sẽ phát hành mã QR ngay khi đối tác xác nhận vé.'
                : 'Thanh toán đã được ghi nhận và vé điện tử của bạn đã sẵn sàng.'
              : 'Giao dịch đã bị hủy hoặc không thể hoàn tất. Đơn giữ chỗ vẫn được giữ nguyên để bạn thử lại.'}
          </p>

          {booking && (
            <div className="mt-7 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-6 text-left">
              <SummaryRow icon="tag" label="Mã đặt chỗ" value={booking.id} mono />
              <SummaryRow icon="location_on" label="Địa điểm" value={booking.attractionTitle} />
              <SummaryRow icon="calendar_month" label="Ngày tham quan" value={formatDate(booking.visitDate)} />
            </div>
          )}

          {retryError && (
            <p className="mt-6 rounded-xl bg-red-50 p-3 text-sm font-semibold text-error">
              {retryError}
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {isSuccess && booking && !isPendingPartner ? (
              <Link
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-md"
                to={`/tickets/${booking.id}`}
              >
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">qr_code_2</span>
                Xem vé điện tử
              </Link>
            ) : isSuccess ? (
              <Link
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-md"
                to="/my-tickets"
              >
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">confirmation_number</span>
                Theo dõi trạng thái vé
              </Link>
            ) : (
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                disabled={retrying || !bookingId}
                onClick={handleRetry}
              >
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">refresh</span>
                {retrying ? 'Đang chuyển tới VNPay...' : 'Thử thanh toán lại'}
              </button>
            )}

            <Link
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-primary px-6 py-3.5 text-sm font-bold text-primary"
              to="/attractions"
            >
              <span className="material-symbols-outlined text-[19px]" aria-hidden="true">explore</span>
              Khám phá thêm
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}

function SummaryRow({ icon, label, mono = false, value }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="material-symbols-outlined mt-0.5 text-primary" aria-hidden="true">{icon}</span>
      <div>
        <p className="text-xs text-on-surface-variant">{label}</p>
        <p className={mono ? 'font-mono font-bold tracking-wider text-primary' : 'font-semibold text-on-surface'}>
          {value}
        </p>
      </div>
    </div>
  )
}

export default BookingSuccessPage
