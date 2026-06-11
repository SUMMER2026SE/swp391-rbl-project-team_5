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

// Diễn giải mã lỗi VNPay phổ biến thành thông báo khách hiểu được.
const VNPAY_ERROR_MESSAGES = {
  '07': 'Giao dịch bị nghi ngờ gian lận và đã bị từ chối. Vui lòng liên hệ ngân hàng của bạn.',
  '09': 'Thẻ/tài khoản chưa đăng ký dịch vụ InternetBanking tại ngân hàng.',
  10: 'Bạn xác thực thông tin thẻ/tài khoản sai quá 3 lần.',
  11: 'Đã hết thời gian chờ thanh toán. Vui lòng thử lại.',
  12: 'Thẻ/tài khoản của bạn đang bị khóa.',
  13: 'Bạn nhập sai mật khẩu xác thực (OTP).',
  24: 'Bạn đã hủy giao dịch trên cổng thanh toán.',
  51: 'Tài khoản của bạn không đủ số dư để thực hiện giao dịch.',
  65: 'Tài khoản của bạn đã vượt quá hạn mức giao dịch trong ngày.',
  75: 'Ngân hàng thanh toán đang bảo trì. Vui lòng thử lại sau ít phút.',
  79: 'Bạn nhập sai mật khẩu thanh toán quá số lần quy định.',
}

function BookingSuccessPage() {
  const [searchParams] = useSearchParams()
  // Backend /vnpay-return redirect về với ?status=success|failed|invalid&vnp_ResponseCode=...
  const statusParam = searchParams.get('status')
  const responseCode =
    searchParams.get('vnp_ResponseCode') || searchParams.get('vnpayResponseCode')
  const bookingId = searchParams.get('bookingId')
  const [booking, setBooking] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')

  // 3 kết cục: success / invalid (không xác minh được chữ ký) / failed (khách hủy, lỗi thẻ...)
  const outcome = statusParam || (responseCode === '00' ? 'success' : 'failed')
  const isSuccess = outcome === 'success'
  const isInvalid = outcome === 'invalid'
  const isPendingPartner = booking?.status === 'pending_partner'
  const failureReason =
    VNPAY_ERROR_MESSAGES[responseCode] ||
    'Giao dịch không thể hoàn tất. Bạn chưa bị trừ tiền cho đơn này.'

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
                : isInvalid
                  ? 'bg-amber-100'
                  : 'bg-red-100'
            }`}
          >
            <span
              className={`material-symbols-outlined text-5xl ${
                isSuccess
                  ? isPendingPartner
                    ? 'text-tertiary'
                    : 'text-white'
                  : isInvalid
                    ? 'text-amber-600'
                    : 'text-error'
              }`}
              aria-hidden="true"
            >
              {isSuccess
                ? isPendingPartner
                  ? 'hourglass_top'
                  : 'check_circle'
                : isInvalid
                  ? 'help'
                  : 'error'}
            </span>
          </div>

          <h1
            className={`mt-6 text-3xl font-extrabold md:text-4xl ${
              isSuccess ? 'text-primary' : isInvalid ? 'text-amber-700' : 'text-error'
            }`}
          >
            {isSuccess
              ? isPendingPartner
                ? 'Đang chờ đối tác duyệt'
                : 'Đặt vé thành công!'
              : isInvalid
                ? 'Chưa xác minh được kết quả'
                : 'Thanh toán chưa thành công'}
          </h1>

          <p className="mt-3 leading-relaxed text-on-surface-variant">
            {isSuccess
              ? isPendingPartner
                ? 'Thanh toán đã được ghi nhận. VietTicket sẽ phát hành mã QR ngay khi đối tác xác nhận vé.'
                : 'Thanh toán đã được ghi nhận và vé điện tử của bạn đã sẵn sàng.'
              : isInvalid
                ? 'Chúng tôi chưa xác minh được kết quả trả về từ cổng thanh toán. Nếu bạn đã bị trừ tiền, trạng thái đơn sẽ được cập nhật tự động trong ít phút — vui lòng kiểm tra mục "Vé của tôi" trước khi thanh toán lại.'
                : failureReason}
          </p>

          {!isSuccess && !isInvalid && (
            <p className="mt-2 text-sm text-on-surface-variant">
              Đơn giữ chỗ của bạn vẫn được giữ trong thời gian giữ chỗ. Bạn có thể thử thanh toán
              lại ngay bên dưới, hoặc đổi phương thức thanh toán khác trên VNPay.
            </p>
          )}

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
            ) : isInvalid ? (
              <Link
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-md"
                to="/my-tickets"
              >
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">confirmation_number</span>
                Kiểm tra trạng thái đơn
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
