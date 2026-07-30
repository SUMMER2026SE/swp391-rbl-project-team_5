import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'react-toastify'
import useSocket from '../context/useSocket.js'
import { getBankTransferInstruction } from '../services/paymentApi.js'
import { completeItineraryQueueItemByBookingId } from '../utils/aiItineraryBookingQueue.js'

// Trang hướng dẫn chuyển khoản: khách quét mã VietQR bằng app ngân hàng,
// KHÔNG phải nhập số tài khoản. Số tiền và nội dung đã nhúng sẵn trong mã.

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`

function CopyRow({ label, value, highlight = false }) {
  const copy = () => {
    if (!navigator?.clipboard?.writeText) return
    navigator.clipboard.writeText(String(value)).then(
      () => toast.success(`Đã sao chép ${label.toLowerCase()}.`),
      () => toast.error('Không sao chép được, vui lòng chép tay.'),
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 py-2.5">
      <span className="text-sm text-on-surface-variant">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={`text-right font-semibold ${
            highlight ? 'font-mono text-base text-primary' : 'text-on-surface'
          }`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Sao chép ${label}`}
          className="rounded-lg p-1 text-primary hover:bg-primary/10"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            content_copy
          </span>
        </button>
      </div>
    </div>
  )
}

export default function BankTransferPage() {
  const { bookingId } = useParams()
  const navigate = useNavigate()
  const socket = useSocket()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState(null)

  useEffect(() => {
    document.title = 'Chuyển khoản thanh toán | VietTicket Travel'
  }, [])

  const load = useCallback(async () => {
    try {
      const response = await getBankTransferInstruction(bookingId)
      setError('')
      // Đơn đã được xác nhận -> đưa khách sang xem vé.
      if (response.data?.paid && !response.data?.terminal) {
        const updatedQueue = completeItineraryQueueItemByBookingId(bookingId)
        toast.success('Đơn của bạn đã được xác nhận thanh toán!')
        navigate(
          updatedQueue?.id
            ? `/itinerary-checkout/${updatedQueue.id}`
            : `/tickets/${bookingId}`,
          { replace: true },
        )
        return
      }
      setInfo(response.data)
    } catch (err) {
      setError(err.message || 'Không tải được hướng dẫn chuyển khoản.')
    } finally {
      setLoading(false)
    }
  }, [bookingId, navigate])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // Webhook thường đẩy trạng thái qua Socket.IO ngay lập tức. Polling ngắn là
  // fallback khi trình duyệt vừa mất kết nối hoặc chạy qua proxy không hỗ trợ websocket.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    const handleBookingStatusUpdated = (event) => {
      if (event?.bookingId === bookingId) void load()
    }
    socket.on('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    return () => socket.off('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
  }, [bookingId, load, socket])

  // Đếm ngược hạn giữ chỗ.
  useEffect(() => {
    if (!info?.expiresAt) return undefined
    const tick = () => {
      const ms = new Date(info.expiresAt).getTime() - Date.now()
      setRemaining(ms > 0 ? ms : 0)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [info?.expiresAt])

  const countdown = (() => {
    if (remaining === null) return null
    const totalSeconds = Math.floor(remaining / 1000)
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
    const seconds = String(totalSeconds % 60).padStart(2, '0')
    return `${minutes}:${seconds}`
  })()

  if (loading) {
    return <div className="p-10 text-center text-on-surface-variant">Đang tải hướng dẫn chuyển khoản…</div>
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-error">{error}</p>
        <Link to="/my-tickets" className="mt-4 inline-block font-bold text-primary">
          Về danh sách vé của tôi
        </Link>
      </div>
    )
  }

  if (!info) {
    return <div className="p-10 text-center text-on-surface-variant">Đang chuyển tới đơn vé đã xác nhận…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-on-surface">
        {info.bookingStatus === 'REFUNDED'
          ? 'Hoàn tiền chuyển khoản'
          : info.terminal
            ? 'Theo dõi chuyển khoản đến muộn'
            : 'Chuyển khoản để hoàn tất đặt vé'}
      </h1>
      <p className="mt-1 text-sm text-on-surface-variant">
        {info.terminal
          ? 'Trang này cập nhật trạng thái đối soát của khoản chuyển khoản; mã QR thanh toán đã được khóa để tránh phát sinh giao dịch lặp.'
          : (
            <>
              Mở app ngân hàng, chọn <strong>Quét mã QR</strong> và quét mã bên dưới. Số tiền và
              nội dung đã được điền sẵn — bạn không cần nhập số tài khoản.
            </>
          )}
      </p>

      {!info.terminal && remaining !== null && (
        <div
          className={`mt-4 rounded-xl border-2 p-3 text-center font-bold ${
            remaining > 0
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-error bg-error-container/20 text-error'
          }`}
        >
          {remaining > 0
            ? `Vui lòng chuyển khoản trong ${countdown} để giữ chỗ`
            : 'Đã hết hạn giữ chỗ. Nếu bạn đã chuyển tiền, hãy liên hệ hỗ trợ để được hoàn tiền.'}
        </div>
      )}

      {info.terminal && (
          <div
            className={`mt-4 rounded-xl border-2 p-4 text-sm leading-6 ${
              info.bookingStatus === 'REFUNDED'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                : 'border-amber-300 bg-amber-50 text-amber-950'
            }`}
          >
            <p className="font-bold">
              {info.bookingStatus === 'REFUNDED'
                ? 'Khoản chuyển khoản đã được hoàn lại'
                : info.paid
                ? 'Đã ghi nhận tiền sau khi đơn hết khả năng phát vé'
                : 'Đơn đã kết thúc và không còn nhận chuyển khoản'}
            </p>
            <p className="mt-1">
              {info.bookingStatus === 'REFUNDED'
                ? 'VietTicket đã hoàn 100% theo mã giao dịch đối soát. Nếu tiền chưa về tài khoản, vui lòng liên hệ hỗ trợ và cung cấp mã đặt chỗ.'
                : info.paid
                ? 'VietTicket không phát vé sai tồn kho. Yêu cầu hoàn 100% đã được chuyển tới nhân viên để đối soát và hoàn qua ngân hàng.'
                : 'Không chuyển tiền theo mã QR này. Nếu tài khoản đã bị trừ tiền, vui lòng liên hệ hỗ trợ và cung cấp mã đặt chỗ.'}
          </p>
        </div>
      )}

      {!info.terminal && <div className="mt-5 rounded-2xl border border-outline-variant bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center">
          <QRCodeSVG
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
            marginSize={2}
            size={240}
            title={`Chuyển khoản ${info.bookingReference}`}
            value={info.qrPayload}
          />
          <p className="mt-3 text-center text-xs text-on-surface-variant">
            Mã VietQR · quét được bằng mọi app ngân hàng tại Việt Nam
          </p>
        </div>

        <div className="mt-6">
          {info.bankName && <CopyRow label="Ngân hàng" value={info.bankName} />}
          <CopyRow label="Chủ tài khoản" value={info.accountName} />
          <CopyRow label="Số tài khoản" value={info.accountNumber} highlight />
          <CopyRow label="Số tiền" value={formatCurrency(info.amount)} highlight />
          <CopyRow label="Nội dung chuyển khoản" value={info.content} highlight />
        </div>

        <div className="mt-5 rounded-xl bg-primary/5 p-4 text-sm text-on-surface-variant">
          <p className="font-bold text-on-surface">Lưu ý quan trọng</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Giữ nguyên nội dung <strong className="font-mono">{info.content}</strong> để hệ thống
              đối chiếu đúng đơn của bạn.
            </li>
            <li>Chuyển đúng số tiền {formatCurrency(info.amount)}.</li>
            <li>
              Hệ thống tự đối chiếu giao dịch và phát vé điện tử ngay khi ngân hàng báo tiền vào.
              Chỉ giao dịch sai số tiền hoặc sai nội dung mới cần nhân viên kiểm tra.
            </li>
          </ul>
        </div>
      </div>}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-xl border border-primary px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/5"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>
          {info.terminal ? 'Kiểm tra trạng thái' : 'Tôi đã chuyển khoản — kiểm tra lại'}
        </button>
        <Link
          to="/my-tickets"
          className="flex items-center gap-2 rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container"
        >
          Xem đơn của tôi
        </Link>
      </div>
    </div>
  )
}
