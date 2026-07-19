import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import bookingService from '../services/bookingService.js'
import {
  buildItineraryQueueBookingUrl,
  completeItineraryQueueItemByBookingId,
  getItineraryQueueProgress,
  getNextItineraryQueueStep,
} from '../utils/aiItineraryBookingQueue.js'
import {
  canRetryBookingPayment,
  deriveBookingPaymentOutcome,
} from '../utils/bookingPaymentOutcome.js'

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

const getSupportUrl = (bookingId) =>
  bookingId ? `/support?bookingId=${encodeURIComponent(bookingId)}` : '/support'

const getPostPaymentActions = ({
  booking,
  bookingId,
  isInvalid,
  isPendingPartner,
  isSuccess,
  isUnknown,
}) => {
  const resolvedBookingId = booking?.id || bookingId || ''

  if (isSuccess && !isPendingPartner) {
    return [
      {
        title: 'Mở vé QR',
        description: 'Kiểm tra mã QR, ngày tham quan và khung giờ trước khi tới cổng.',
        icon: 'qr_code_2',
        to: resolvedBookingId ? `/tickets/${resolvedBookingId}` : '/my-tickets',
      },
      {
        title: 'Lưu lại lịch trình',
        description: 'Trong trang vé, bạn có thể mở bản đồ và thêm lịch tham quan vào calendar.',
        icon: 'event_available',
        to: resolvedBookingId ? `/tickets/${resolvedBookingId}` : '/my-tickets',
      },
      {
        title: 'Cần hỗ trợ?',
        description: 'Gửi yêu cầu kèm mã đặt chỗ để đội hỗ trợ xử lý nhanh hơn.',
        icon: 'support_agent',
        to: getSupportUrl(resolvedBookingId),
      },
    ]
  }

  if (isSuccess && isPendingPartner) {
    return [
      {
        title: 'Theo dõi trạng thái',
        description: 'Vé QR sẽ xuất hiện trong Vé của tôi khi đối tác xác nhận.',
        icon: 'hourglass_top',
        to: '/my-tickets',
      },
      {
        title: 'Kiểm tra email',
        description: 'Thông báo xác nhận sẽ được gửi tới email trong đơn đặt vé.',
        icon: 'mark_email_read',
      },
      {
        title: 'Hỏi hỗ trợ nếu cần',
        description: 'Dùng mã đặt chỗ để hỏi tiến độ khi lịch đi của bạn gần sát.',
        icon: 'support_agent',
        to: getSupportUrl(resolvedBookingId),
      },
    ]
  }

  if (isInvalid || isUnknown) {
    return [
      {
        title: 'Kiểm tra đơn trước',
        description: 'Nếu đã bị trừ tiền, hãy xem lại trạng thái trong Vé của tôi trước khi thanh toán lại.',
        icon: 'receipt_long',
        to: '/my-tickets',
      },
      {
        title: 'Giữ lại mã giao dịch',
        description: 'Mã đặt chỗ và thông tin ngân hàng giúp đối soát nhanh hơn.',
        icon: 'tag',
      },
      {
        title: 'Gửi yêu cầu hỗ trợ',
        description: 'Đội hỗ trợ có thể kiểm tra trạng thái thanh toán và đơn đặt vé.',
        icon: 'support_agent',
        to: getSupportUrl(resolvedBookingId),
      },
    ]
  }

  return [
    {
      title: 'Thử thanh toán lại',
      description: 'Đơn vẫn có thể được giữ trong thời gian giữ chỗ, dùng nút thanh toán lại bên dưới.',
      icon: 'refresh',
    },
    {
      title: 'Kiểm tra ngân hàng',
      description: 'Đảm bảo số dư, OTP và hạn mức giao dịch còn khả dụng.',
      icon: 'account_balance',
    },
    {
      title: 'Cần người hỗ trợ?',
      description: 'Gửi yêu cầu nếu bạn không chắc giao dịch đã bị trừ tiền hay chưa.',
      icon: 'support_agent',
      to: getSupportUrl(resolvedBookingId),
    },
  ]
}

function BookingSuccessPage() {
  const [searchParams] = useSearchParams()
  // Backend /vnpay-return redirect về với ?status=success|failed|invalid&vnp_ResponseCode=...
  const statusParam = searchParams.get('status')
  const responseCode =
    searchParams.get('vnp_ResponseCode') || searchParams.get('vnpayResponseCode')
  const bookingId = searchParams.get('bookingId')
  const [bookingResult, setBookingResult] = useState({
    bookingId: '',
    data: null,
    error: null,
  })
  const [aiQueueResult, setAiQueueResult] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const booking =
    bookingResult.bookingId === bookingId ? bookingResult.data : null
  const bookingLoadError =
    bookingResult.bookingId === bookingId ? bookingResult.error : null
  const bookingLoading =
    Boolean(bookingId) && bookingResult.bookingId !== bookingId

  // Chỉ dữ liệu booking đã xác thực từ API mới có quyền kết luận thanh toán thành công.
  // Query string của trình duyệt chỉ hỗ trợ diễn giải lỗi cho một booking chưa thanh toán.
  const outcome = deriveBookingPaymentOutcome({
    booking,
    bookingId,
    callbackStatus: statusParam,
    isLoading: bookingLoading,
    loadError: bookingLoadError,
    responseCode,
  })
  const isSuccess = outcome === 'success'
  const isInvalid = outcome === 'invalid'
  const isUnknown = outcome === 'unknown'
  const isVerifying = outcome === 'verifying'
  const isPendingPartner = booking?.status === 'pending_partner'
  const isRetryAllowed = canRetryBookingPayment(booking)
  const nextAiBookingUrl = aiQueueResult?.nextUrl || ''
  const failureReason = isUnknown
    ? 'Trang này cần thông tin giao dịch từ cổng thanh toán. Vui lòng kiểm tra lại đơn trong mục Vé của tôi.'
    : (VNPAY_ERROR_MESSAGES[responseCode] ||
        'Hệ thống chưa ghi nhận giao dịch thanh toán thành công cho đơn này.')
  const nextActionItems = getPostPaymentActions({
    booking,
    bookingId,
    isInvalid,
    isPendingPartner,
    isSuccess,
    isUnknown,
  })

  const handleRetry = async () => {
    if (!bookingId || !isRetryAllowed || retrying) return
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

    if (!bookingId) {
      return () => {
        active = false
      }
    }

    bookingService
      .getBookingDetails(bookingId)
      .then((data) => {
        if (!active) return
        setBookingResult({ bookingId, data, error: null })
      })
      .catch((error) => {
        if (!active) return
        setBookingResult({ bookingId, data: null, error })
      })

    return () => {
      active = false
    }
  }, [bookingId])

  useEffect(() => {
    if (!isSuccess || !bookingId) return undefined

    let active = true

    Promise.resolve().then(() => {
      const updatedQueue = completeItineraryQueueItemByBookingId(bookingId)
      if (!active || !updatedQueue) return

      const nextItem = getNextItineraryQueueStep(updatedQueue)
      setAiQueueResult({
        nextItem,
        nextUrl: nextItem ? buildItineraryQueueBookingUrl(updatedQueue, nextItem) : '',
        planTitle: updatedQueue.planTitle,
        progress: getItineraryQueueProgress(updatedQueue),
      })
    })

    return () => {
      active = false
    }
  }, [bookingId, isSuccess])

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
                : isInvalid || isUnknown || isVerifying
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
                  : isInvalid || isUnknown || isVerifying
                    ? 'text-amber-600'
                    : 'text-error'
              }`}
              aria-hidden="true"
            >
              {isSuccess
                ? isPendingPartner
                  ? 'hourglass_top'
                  : 'check_circle'
                : isVerifying
                  ? 'progress_activity'
                  : isInvalid || isUnknown
                    ? 'help'
                  : 'error'}
            </span>
          </div>

          <h1
            className={`mt-6 text-3xl font-extrabold md:text-4xl ${
              isSuccess || isVerifying
                ? 'text-primary'
                : isInvalid || isUnknown
                  ? 'text-amber-700'
                  : 'text-error'
            }`}
          >
            {isSuccess
              ? isPendingPartner
                ? 'Đang chờ đối tác duyệt'
                : 'Đặt vé thành công!'
              : isVerifying
                ? 'Đang xác minh thanh toán'
                : isUnknown
                ? 'Thiếu thông tin thanh toán'
                : isInvalid
                ? 'Chưa xác minh được kết quả'
                : 'Thanh toán chưa thành công'}
          </h1>

          <p className="mt-3 leading-relaxed text-on-surface-variant">
            {isSuccess
              ? isPendingPartner
                ? 'Thanh toán đã được ghi nhận. VietTicket sẽ phát hành mã QR ngay khi đối tác xác nhận vé.'
                : 'Thanh toán đã được ghi nhận và vé điện tử của bạn đã sẵn sàng.'
              : isVerifying
                ? 'VietTicket đang đối chiếu trạng thái đơn và thanh toán trực tiếp với máy chủ. Vui lòng chờ trong giây lát.'
                : isUnknown
                ? 'Không tìm thấy thông tin giao dịch trên đường dẫn hiện tại. Bạn có thể kiểm tra trạng thái đơn trong mục "Vé của tôi".'
                : isInvalid
                ? 'Chúng tôi chưa xác minh được kết quả trả về từ cổng thanh toán. Nếu bạn đã bị trừ tiền, trạng thái đơn sẽ được cập nhật tự động trong ít phút — vui lòng kiểm tra mục "Vé của tôi" trước khi thanh toán lại.'
                : failureReason}
          </p>

          {!isSuccess && !isInvalid && !isUnknown && !isVerifying && isRetryAllowed && (
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

          {isSuccess && aiQueueResult?.progress?.total > 0 && (
            <div className="mt-6 rounded-2xl border border-[#a6eff8] bg-[#eefcff] p-5 text-left">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined mt-0.5 text-[#006068]" aria-hidden="true">
                  route
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#00474d]">
                    Tiến độ lịch trình AI
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#3f484a]">
                    Đã hoàn tất {aiQueueResult.progress.completed}/{aiQueueResult.progress.total} vé trong {aiQueueResult.planTitle || 'lịch trình AI'}.
                  </p>
                  {aiQueueResult.nextItem ? (
                    <div className="mt-3">
                      <p className="text-xs text-[#5b6668]">
                        Tiếp theo: {aiQueueResult.nextItem.attractionTitle} - {aiQueueResult.nextItem.ticketName}
                      </p>
                      {nextAiBookingUrl && (
                        <Link
                          className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-[#00474d] px-4 py-2 text-xs font-bold text-white"
                          to={nextAiBookingUrl}
                        >
                          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                            shopping_cart_checkout
                          </span>
                          Đặt vé tiếp theo
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-semibold text-[#006068]">
                      Tất cả vé trong lịch trình AI đã được xử lý.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isVerifying && <NextActionPanel items={nextActionItems} />}

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
            ) : isVerifying ? (
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white opacity-70"
                disabled
              >
                <span className="material-symbols-outlined animate-spin text-[19px]" aria-hidden="true">
                  progress_activity
                </span>
                Đang xác minh
              </button>
            ) : isInvalid || isUnknown || !isRetryAllowed ? (
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
                disabled={retrying || !bookingId || !isRetryAllowed}
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

function NextActionPanel({ items }) {
  return (
    <div className="mt-6 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5 text-left">
      <h2 className="text-base font-extrabold text-on-surface">
        Việc nên làm tiếp theo
      </h2>
      <div className="mt-4 grid gap-3">
        {items.map((item) => {
          const content = (
            <>
              <span
                className="material-symbols-outlined mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[19px] text-primary"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-extrabold text-on-surface">
                  {item.title}
                </strong>
                <span className="mt-0.5 block text-xs font-semibold leading-5 text-on-surface-variant">
                  {item.description}
                </span>
              </span>
              {item.to && (
                <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">
                  arrow_forward
                </span>
              )}
            </>
          )

          return item.to ? (
            <Link
              className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-white"
              key={item.title}
              to={item.to}
            >
              {content}
            </Link>
          ) : (
            <div className="flex items-start gap-3 rounded-xl p-2" key={item.title}>
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BookingSuccessPage
