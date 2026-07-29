import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import useSocket from '../context/useSocket.js'
import {
  acceptRecoveryOption,
  declineRecoveryCase,
  getRecoveryCase,
  listRecoveryCases,
} from '../services/recoveryApi.js'
import fallbackImage from '../assets/halong_bay.webp'
import { formatBookingReference } from '../utils/bookingReference.js'
import {
  getCountdownState,
  getRecoveryRefundStage,
  getRecoveryResolutionContent,
  sortRecoveryCases,
} from '../utils/recoveryPresentation.js'

const FALLBACK_IMAGE = fallbackImage

const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const formatDate = (value) => {
  if (!value) return 'Chưa xác định'
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`))
}

const formatDateTime = (value) => {
  if (!value) return 'Chưa xác định'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Chưa xác định'
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

const getRestrictionLabels = (restrictions = {}) => {
  const labels = []
  const optionalNumber = (value) => {
    if (value == null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const minAge = optionalNumber(restrictions.minAgeYears)
  const maxAge = optionalNumber(restrictions.maxAgeYears)
  const minHeight = optionalNumber(restrictions.minHeightCm)
  const maxHeight = optionalNumber(restrictions.maxHeightCm)

  if (minAge != null && maxAge != null) labels.push(`Độ tuổi ${minAge}–${maxAge}`)
  else if (minAge != null) labels.push(`Từ ${minAge} tuổi`)
  else if (maxAge != null) labels.push(`Tối đa ${maxAge} tuổi`)

  if (minHeight != null && maxHeight != null) {
    labels.push(`Chiều cao ${minHeight}–${maxHeight} cm`)
  } else if (minHeight != null) labels.push(`Cao từ ${minHeight} cm`)
  else if (maxHeight != null) labels.push(`Cao tối đa ${maxHeight} cm`)

  if (restrictions.requiresAdult === true) labels.push('Cần người lớn đi cùng')
  return labels
}

const getRefundPolicyLabel = (option = {}) => {
  const policy = option.refundPolicy || option.snapshotRefundPolicy
  if (policy === 'FREE_CANCELLATION') {
    return 'Có thể hoàn theo chính sách hủy miễn phí'
  }
  if (policy === 'REFUND_WITH_FEE') {
    const rate = Number(option.refundFeeRate ?? option.snapshotRefundFeeRate)
    const suffix = Number.isFinite(rate) ? ` (phí tối đa ${Math.round(rate * 100)}%)` : ''
    return `Có thể hoàn theo chính sách có phí${suffix}`
  }
  return 'Theo chính sách không hoàn tiền của sản phẩm'
}

const STATUS_META = {
  OPEN: { label: 'Đang chờ bạn chọn', color: 'bg-amber-100 text-amber-800', icon: 'timer' },
  REPLACED: { label: 'Đã cứu chuyến', color: 'bg-emerald-100 text-emerald-800', icon: 'verified' },
  REFUND_PENDING: { label: 'Đang hoàn tiền', color: 'bg-sky-100 text-sky-800', icon: 'payments' },
  REFUNDED: { label: 'Đã hoàn tiền', color: 'bg-slate-100 text-slate-700', icon: 'task_alt' },
}

function useCountdown(expiresAt, active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  return getCountdownState(expiresAt, now)
}

function FinancialSummary({ creditAmount, option }) {
  const refundAmount = Math.max(0, Number(option.refundAmount || 0))
  const hasRefund = refundAmount > 0
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>Bạn đã thanh toán</span>
        <strong className="text-slate-900">{formatCurrency(creditAmount)}</strong>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
        <span>Giá vé thay thế</span>
        <strong className="text-slate-900">{formatCurrency(option.totalAmount)}</strong>
      </div>
      <div className="my-3 h-px bg-slate-200" />
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">
          {hasRefund ? 'Bạn được hoàn chênh lệch' : 'Phí đổi vé'}
        </span>
        <strong className={`text-base ${hasRefund ? 'text-emerald-700' : 'text-slate-900'}`}>
          {formatCurrency(refundAmount)}
        </strong>
      </div>
      {!hasRefund && (
        <p className="mt-2 text-xs font-semibold text-emerald-700">
          Không cần trả thêm tiền khi xác nhận phương án này.
        </p>
      )}
    </div>
  )
}

function RefundProgress({ recoveryCase, compact = false }) {
  const stage = getRecoveryRefundStage(recoveryCase)
  const progress = recoveryCase.refundProgress
  const stageContent = {
    QUEUED: {
      icon: 'schedule',
      title: 'Đã xếp hàng hoàn tiền an toàn',
      description: 'Hệ thống đang chuẩn bị yêu cầu cho cổng thanh toán.',
    },
    PREPARING: {
      icon: 'hourglass_top',
      title: 'Đang chuẩn bị yêu cầu hoàn tiền',
      description: 'Hệ thống đang khóa an toàn giao dịch trước khi gửi sang cổng thanh toán.',
    },
    PROCESSING: {
      icon: 'sync',
      title: 'Đang xử lý tại cổng thanh toán',
      description: 'Yêu cầu đã được gửi và đang chờ kết quả xác nhận.',
    },
    RECONCILING: {
      icon: 'policy',
      title: 'Đang đối soát để tránh hoàn lặp',
      description: 'Kết quả chưa đủ rõ để gửi lại. Hệ thống đang xác minh an toàn với cổng thanh toán.',
    },
    RETRY_PENDING: {
      icon: 'error',
      title: 'Đang chờ xử lý lại an toàn',
      description: 'Lần xử lý trước chưa hoàn tất. Yêu cầu vẫn được giữ để nhân viên kiểm tra.',
    },
    CONFIRMED: {
      icon: 'price_check',
      title: 'Cổng thanh toán đã xác nhận',
      description: 'Ngân hàng phát hành có thể cần thêm thời gian để cập nhật số dư.',
    },
  }[stage]
  const gatewayComplete = stage === 'CONFIRMED'

  return (
    <div
      aria-live="polite"
      className={`${compact ? 'mt-4' : 'mt-6'} rounded-2xl border border-slate-200 bg-slate-50 p-4`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`material-symbols-outlined mt-0.5 text-[22px] ${
            stage === 'RETRY_PENDING' ? 'text-amber-700' : 'text-teal-700'
          }`}
        >
          {stageContent.icon}
        </span>
        <div>
          <p className="font-black text-slate-900">{stageContent.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{stageContent.description}</p>
        </div>
      </div>
      {!compact && (
        <ol className="mt-4 grid gap-3 text-xs font-bold text-slate-600 sm:grid-cols-3">
          {[
            { label: '1. Ghi nhận yêu cầu', done: true },
            { label: '2. Cổng xác nhận', done: gatewayComplete, active: !gatewayComplete },
            { label: '3. Ngân hàng ghi có', done: false, active: gatewayComplete },
          ].map((item) => (
            <li
              className={`rounded-xl border px-3 py-2.5 ${
                item.done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : item.active
                    ? 'border-sky-200 bg-sky-50 text-sky-800'
                    : 'border-slate-200 bg-white text-slate-500'
              }`}
              key={item.label}
            >
              {item.label}
            </li>
          ))}
        </ol>
      )}
      {progress?.requestedAt && (
        <p className="mt-3 text-xs font-semibold text-slate-500">
          Yêu cầu được tạo lúc {formatDateTime(progress.requestedAt)}
        </p>
      )}
    </div>
  )
}

function RecoveryOptionCard({ option, creditAmount, onSelect, disabled }) {
  const [imageFailed, setImageFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const rating = Number(option.averageRating || 0)
  const reasons = Array.isArray(option.recommendationReasons)
    ? option.recommendationReasons
    : []
  const restrictionLabels = getRestrictionLabels(option.restrictions)
  return (
    <article className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-teal-300 hover:shadow-xl">
      <div
        className="relative h-48 overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${FALLBACK_IMAGE})` }}
      >
        {!imageFailed && option.imageUrl ? (
          <img
            alt={option.attractionTitle}
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            src={option.imageUrl}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="sr-only">{option.attractionTitle}</span>
        )}
        <div className="absolute left-4 top-4 rounded-full bg-white/95 px-3 py-1.5 text-xs font-extrabold text-teal-800 shadow">
          Độ phù hợp {Math.round(Number(option.matchScore || 0))}/100
        </div>
        <div className="absolute bottom-3 right-3 rounded-full bg-slate-950/75 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
          Còn {option.availableTickets} vé
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">
              {option.ticketName}
            </p>
            <h3 className="mt-1 text-xl font-black leading-tight text-slate-900">
              {option.attractionTitle}
            </h3>
          </div>
          {Number(option.totalReviews || 0) > 0 ? (
            <div
              aria-label={`${rating.toFixed(1)} trên 5 từ ${Number(option.totalReviews)} lượt đánh giá`}
              className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700"
            >
              <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                star
              </span>
              {rating.toFixed(1)}
            </div>
          ) : (
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
              Chưa có đánh giá
            </span>
          )}
        </div>
        {option.ticketDescription && (
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
            {option.ticketDescription}
          </p>
        )}
        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-teal-700" aria-hidden="true">
              calendar_month
            </span>
            {formatDate(option.visitDate)}
          </p>
          <p className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-teal-700" aria-hidden="true">
              schedule
            </span>
            {option.startTime ? `${option.startTime} – ${option.endTime}` : 'Vé cả ngày'}
          </p>
          <p className="flex items-center gap-2 sm:col-span-2">
            <span className="material-symbols-outlined text-[18px] text-teal-700" aria-hidden="true">
              location_on
            </span>
            <span>
              {option.address || `${option.district ? `${option.district}, ` : ''}${option.city}`}
              {option.distanceKm != null
                ? ` · ${option.distanceKm} km đường thẳng từ điểm cũ`
                : ''}
            </span>
          </p>
        </div>
        {Number(option.distanceKm) >= 25 && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
            Điểm này khá xa địa điểm cũ. Hãy kiểm tra thời gian di chuyển trước khi đổi vé.
          </p>
        )}
        {restrictionLabels.length > 0 && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <p className="text-xs font-extrabold uppercase tracking-wider text-sky-800">
              Điều kiện sử dụng
            </p>
            <p className="mt-1 text-sm font-semibold leading-6 text-sky-950">
              {restrictionLabels.join(' · ')}
            </p>
          </div>
        )}
        <p className="mt-3 rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm font-semibold leading-6 text-teal-900">
          {getRefundPolicyLabel(option)}. Quyền hoàn của vé thay thế không thấp hơn vé cũ.
        </p>
        <ul className="mt-4 space-y-2">
          {reasons.map((reason, index) => (
            <li
              className="flex items-start gap-2 text-sm text-slate-700"
              key={`${reason}:${index}`}
            >
              <span className="material-symbols-outlined mt-0.5 text-[17px] text-emerald-600" aria-hidden="true">
                check_circle
              </span>
              {reason}
            </li>
          ))}
        </ul>
        <Link
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-teal-800 underline-offset-4 hover:underline"
          to={`/attractions/${option.attractionId}`}
        >
           Xem thông tin địa điểm
           <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
             arrow_forward
           </span>
        </Link>
        <div className="my-5 h-px bg-slate-100" />
        <FinancialSummary creditAmount={creditAmount} option={option} />
        <button
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#07545b] px-4 py-3.5 text-sm font-extrabold text-white transition hover:bg-[#043f45] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          type="button"
          onClick={() => onSelect(option)}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            swap_horiz
          </span>
          Đổi sang vé này — không thanh toán lại
        </button>
      </div>
    </article>
  )
}

function DecisionDialog({ mode, option, recoveryCase, busy, onClose, onConfirm }) {
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!mode) return undefined
    previousFocusRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector('button')?.focus()
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus?.()
    }
  }, [mode])

  if (!mode) return null
  const isAccept = mode === 'accept'

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = dialogRef.current?.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      aria-describedby="recovery-dialog-description"
      aria-labelledby="recovery-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7"
        ref={dialogRef}
      >
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isAccept ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'}`}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {isAccept ? 'published_with_changes' : 'payments'}
          </span>
        </div>
        <h2 className="mt-4 text-2xl font-black text-slate-900" id="recovery-dialog-title">
          {isAccept ? 'Xác nhận đổi vé?' : 'Nhận hoàn tiền 100%?'}
        </h2>
        {isAccept ? (
          <>
            <p className="mt-2 leading-7 text-slate-600" id="recovery-dialog-description">
              VietTicket sẽ giữ chỗ tại <strong>{option.attractionTitle}</strong>,
              cấp booking và QR hoàn toàn mới. QR cũ tiếp tục bị vô hiệu.
            </p>
            <div className="mt-5">
              <FinancialSummary creditAmount={recoveryCase.creditAmount} option={option} />
            </div>
          </>
        ) : (
          <p className="mt-2 leading-7 text-slate-600" id="recovery-dialog-description">
            Bạn sẽ không nhận vé thay thế. Toàn bộ{' '}
            <strong>{formatCurrency(recoveryCase.creditAmount)}</strong> được hoàn
            về phương thức thanh toán gốc. Thời gian ngân hàng xử lý có thể khác nhau.
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            Quay lại
          </button>
          <button
            className={`rounded-xl px-5 py-3 text-sm font-extrabold text-white transition disabled:cursor-wait disabled:opacity-60 ${isAccept ? 'bg-[#07545b] hover:bg-[#043f45]' : 'bg-amber-700 hover:bg-amber-800'}`}
            disabled={busy}
            type="button"
            onClick={onConfirm}
          >
            {busy
              ? isAccept
                ? 'Đang kiểm tra tồn kho…'
                : 'Đang ghi nhận hoàn tiền…'
              : isAccept
                ? 'Xác nhận đổi vé'
                : 'Xác nhận hoàn 100%'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecoveryDetail({ recoveryCase, loading, refreshing, onReload }) {
  const [dialogMode, setDialogMode] = useState(null)
  const [selectedOption, setSelectedOption] = useState(null)
  const [busy, setBusy] = useState(false)
  const countdown = useCountdown(recoveryCase?.expiresAt, recoveryCase?.status === 'OPEN')
  const statusMeta = STATUS_META[recoveryCase?.status] || STATUS_META.OPEN
  const refundStage = getRecoveryRefundStage(recoveryCase)
  const handledExpiryRef = useRef(null)

  useEffect(() => {
    if (
      recoveryCase?.status !== 'OPEN'
      || !countdown.expired
      || handledExpiryRef.current === recoveryCase.id
    ) {
      return undefined
    }
    handledExpiryRef.current = recoveryCase.id
    const timer = window.setTimeout(() => void onReload(), 0)
    return () => window.clearTimeout(timer)
  }, [countdown.expired, onReload, recoveryCase?.id, recoveryCase?.status])

  useEffect(() => {
    const shouldPoll = recoveryCase?.status === 'REFUND_PENDING'
      || (
        recoveryCase?.status === 'REPLACED'
        && Number(recoveryCase.refundAmount || 0) > 0
        && refundStage !== 'CONFIRMED'
      )
    if (!shouldPoll) return undefined
    const timer = window.setInterval(() => void onReload(null, { quiet: true }), 15000)
    return () => window.clearInterval(timer)
  }, [onReload, recoveryCase?.refundAmount, recoveryCase?.status, refundStage])

  const showAccept = (option) => {
    setSelectedOption(option)
    setDialogMode('accept')
  }

  const confirmDecision = async () => {
    setBusy(true)
    try {
      const updated = dialogMode === 'accept'
        ? await acceptRecoveryOption(recoveryCase.id, selectedOption)
        : await declineRecoveryCase(recoveryCase.id)
      toast.success(
        dialogMode === 'accept'
          ? 'Đổi vé thành công — QR mới đã sẵn sàng.'
          : 'Đã ghi nhận hoàn tiền 100%.',
      )
      setDialogMode(null)
      setSelectedOption(null)
      await onReload(updated)
    } catch (error) {
      toast.error(error.message)
      setDialogMode(null)
      setSelectedOption(null)
      await onReload()
    } finally {
      setBusy(false)
    }
  }

  if (loading || !recoveryCase) {
    return (
      <div className="flex min-h-[52vh] items-center justify-center" role="status">
        <span className="material-symbols-outlined animate-spin text-4xl text-teal-700">
          progress_activity
        </span>
        <span className="sr-only">Đang tải yêu cầu cứu chuyến</span>
      </div>
    )
  }

  const isOpen = recoveryCase.status === 'OPEN'
  const resolutionContent = getRecoveryResolutionContent(recoveryCase)
  const copyReplacementCode = async () => {
    try {
      await navigator.clipboard.writeText(
        formatBookingReference(recoveryCase.replacementBookingId),
      )
      toast.success('Đã sao chép mã booking mới.')
    } catch {
      toast.info(`Mã booking: ${formatBookingReference(recoveryCase.replacementBookingId)}`)
    }
  }
  return (
    <>
      <section className="bg-gradient-to-br from-[#063f45] via-[#07545b] to-[#0b7378] text-white">
        <div className="container py-10 sm:py-14">
          <Link className="inline-flex items-center gap-1 text-sm font-bold text-teal-100 hover:text-white" to="/rescue">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
            Trung tâm cứu chuyến
          </Link>
          <div className="mt-6 grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.2em] text-teal-50 ring-1 ring-white/20">
                <span className="material-symbols-outlined text-[17px]" aria-hidden="true">shield</span>
                VietTicket Rescue
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight sm:text-5xl">
                Vé bị hủy. Kế hoạch của bạn chưa cần phải hủy.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-teal-50/90 sm:text-lg">
                Chúng tôi chỉ hiển thị phương án còn chỗ thật, cùng ngày và không
                vượt số tiền bạn đã trả. Bạn quyết định — hệ thống không tự đổi vé.
              </p>
              <ol className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-teal-50/90">
                <li className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">1</span>
                  Xem sự cố
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">2</span>
                  Chọn đổi hoặc hoàn
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">3</span>
                  Nhận xác nhận mới
                </li>
              </ol>
            </div>
            {isOpen && (
              <div className="rounded-2xl bg-white/10 p-5 text-center ring-1 ring-white/20 backdrop-blur">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-100">
                  Bắt đầu xử lý hoàn 100% sau
                </p>
                <p className="mt-2 font-mono text-4xl font-black tracking-wider">
                  {countdown.label}
                </p>
                <p className="mt-2 text-xs font-semibold text-teal-100">
                  Hạn chọn: {formatDateTime(recoveryCase.expiresAt)}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <main className={`bg-[#f7faf9] ${isOpen ? 'pb-24 lg:pb-0' : ''}`}>
        <div className="container py-8 sm:py-12">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-rose-600">
                      Hoạt động bị gián đoạn
                    </p>
                    <h2 className="mt-1 text-2xl font-black text-slate-900">
                      {recoveryCase.original.attractionTitle}
                    </h2>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold ${statusMeta.color}`}>
                    <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                      {statusMeta.icon}
                    </span>
                    {statusMeta.label}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                  <p><strong className="block text-slate-900">Ngày đi</strong>{formatDate(recoveryCase.original.visitDate)}</p>
                  <p><strong className="block text-slate-900">Khung giờ</strong>{recoveryCase.original.timeSlotLabel || 'Vé cả ngày'}</p>
                  <p><strong className="block text-slate-900">Số khách</strong>{recoveryCase.original.quantity} người</p>
                </div>
                <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
                  <strong>Lý do từ đối tác:</strong> {recoveryCase.reason}
                </div>
              </section>

              {isOpen ? (
                <section className="mt-8 scroll-mt-24" id="recovery-options">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-teal-700">
                        Tồn kho được kiểm tra trực tiếp
                      </p>
                      <h2 className="mt-1 text-3xl font-black text-slate-900">
                        Chọn phương án giữ trọn ngày vui
                      </h2>
                    </div>
                    <button
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-teal-400 hover:text-teal-800"
                      disabled={refreshing}
                      type="button"
                      onClick={() => onReload()}
                    >
                      <span
                        className={`material-symbols-outlined text-[19px] ${refreshing ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      >
                        refresh
                      </span>
                      {refreshing ? 'Đang cập nhật…' : 'Kiểm tra lại chỗ'}
                    </button>
                  </div>
                  <div className="mt-6 grid gap-4 rounded-3xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-amber-800">
                        Hai lựa chọn đều được bảo đảm
                      </p>
                      <h3 className="mt-1 text-lg font-black text-slate-900">
                        Đổi vé không trả thêm hoặc nhận hoàn 100%
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        Nếu chưa thấy phương án phù hợp, bạn có thể bắt đầu hoàn toàn bộ{' '}
                        <strong>{formatCurrency(recoveryCase.creditAmount)}</strong> ngay.
                      </p>
                    </div>
                    <button
                      className="w-full shrink-0 rounded-xl border border-amber-400 bg-white px-5 py-3 text-sm font-extrabold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      disabled={busy || countdown.expired}
                      type="button"
                      onClick={() => setDialogMode('decline')}
                    >
                      Nhận hoàn tiền 100%
                    </button>
                  </div>
                  {recoveryCase.options?.length > 0 ? (
                    <div className={`mt-6 grid gap-6 ${
                      recoveryCase.options.length > 1 ? 'xl:grid-cols-2' : 'max-w-2xl'
                    }`}>
                      {recoveryCase.options.map((option) => (
                        <RecoveryOptionCard
                          creditAmount={recoveryCase.creditAmount}
                          disabled={busy || countdown.expired}
                          key={`${option.ticketProductId}:${option.timeSlotId || 'day'}`}
                          option={option}
                          onSelect={showAccept}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
                      <span className="material-symbols-outlined text-5xl text-slate-400" aria-hidden="true">
                        event_busy
                      </span>
                      <h3 className="mt-3 text-xl font-black text-slate-900">
                        {recoveryCase.optionsUnavailable
                          ? 'Phương án đang được cập nhật'
                          : 'Hiện chưa còn phương án đủ điều kiện'}
                      </h3>
                      <p className="mx-auto mt-2 max-w-lg leading-7 text-slate-600">
                        {recoveryCase.optionsUnavailable
                          ? 'Tồn kho hoặc lịch hoạt động có thể vừa thay đổi. Hãy thử kiểm tra lại sau ít phút; bạn vẫn giữ nguyên cửa sổ Rescue và quyền nhận hoàn 100%.'
                          : 'Hệ thống đang bảo toàn quyền hoàn 100% của bạn.'}
                      </p>
                    </div>
                  )}
                </section>
              ) : (
                <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                  {recoveryCase.status === 'REPLACED' ? (
                    <>
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                        <span className="material-symbols-outlined text-3xl" aria-hidden="true">verified</span>
                      </div>
                      <h2 className="mt-4 text-3xl font-black text-slate-900">Kế hoạch đã được cứu thành công</h2>
                      <p className="mt-2 leading-7 text-slate-600">
                        Booking và QR mới đã được cấp cho{' '}
                        <strong>{recoveryCase.replacementBooking?.attractionTitle}</strong>.
                        QR của booking cũ không còn hiệu lực.
                      </p>
                      <dl className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="font-semibold text-slate-500">Mã booking mới</dt>
                          <dd className="mt-1 font-black text-slate-900">
                            {formatBookingReference(recoveryCase.replacementBookingId)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-500">Ngày và khung giờ</dt>
                          <dd className="mt-1 font-bold text-slate-900">
                            {formatDate(recoveryCase.replacementBooking?.visitDate)}
                            {' · '}
                            {recoveryCase.replacementBooking?.timeSlotLabel || 'Vé cả ngày'}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-500">Số vé</dt>
                          <dd className="mt-1 font-bold text-slate-900">
                            {recoveryCase.replacementBooking?.ticketCount || recoveryCase.original.quantity} vé
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-500">Địa chỉ</dt>
                          <dd className="mt-1 font-bold text-slate-900">
                            {recoveryCase.selectedOption?.address || recoveryCase.selectedOption?.city}
                          </dd>
                        </div>
                      </dl>
                      {recoveryCase.refundAmount > 0 && (
                        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                          <strong>{formatCurrency(recoveryCase.refundAmount)} tiền chênh lệch</strong>
                          {' '}đã được chuyển sang quy trình hoàn về phương thức thanh toán gốc.
                          Bạn không phải trả bất kỳ phí đổi vé nào.
                          <RefundProgress compact recoveryCase={recoveryCase} />
                        </div>
                      )}
                      <div className="mt-5 flex flex-wrap gap-3">
                        <Link
                          className="rounded-xl bg-[#07545b] px-5 py-3 text-sm font-extrabold text-white"
                          to={`/tickets/${recoveryCase.replacementBookingId}`}
                        >
                          Mở e-ticket mới
                        </Link>
                        <Link className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700" to="/my-tickets">
                          Xem vé của tôi
                        </Link>
                        <button
                          className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700"
                          type="button"
                          onClick={copyReplacementCode}
                        >
                          Sao chép mã booking
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                        resolutionContent.tone === 'completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-sky-100 text-sky-700'
                      }`}>
                        <span className="material-symbols-outlined text-3xl" aria-hidden="true">
                          {resolutionContent.icon}
                        </span>
                      </div>
                      <h2 className="mt-4 text-3xl font-black text-slate-900">
                        {resolutionContent.title}
                      </h2>
                      <p className="mt-2 leading-7 text-slate-600">
                        <strong>{formatCurrency(resolutionContent.amount)}</strong>.{' '}
                        {resolutionContent.description}
                      </p>
                      {recoveryCase.status === 'REFUNDED' && recoveryCase.completedAt && (
                        <p className="mt-3 text-sm font-semibold text-slate-500">
                          Cập nhật lúc {formatDateTime(recoveryCase.completedAt)}
                        </p>
                      )}
                      <RefundProgress recoveryCase={recoveryCase} />
                      <div className="mt-5 flex flex-wrap gap-3">
                        <Link
                          className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700"
                          to={`/support?bookingId=${encodeURIComponent(recoveryCase.originalBookingId)}`}
                        >
                          Cần trợ giúp về khoản hoàn
                        </Link>
                        <Link
                          className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700"
                          to="/my-tickets"
                        >
                          Xem vé của tôi
                        </Link>
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>

            <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-3xl border border-teal-100 bg-white p-6 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-100 text-teal-800">
                  <span className="material-symbols-outlined" aria-hidden="true">verified_user</span>
                </div>
                <h2 className="mt-4 text-xl font-black text-slate-900">Cam kết Rescue</h2>
                <ul className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
                  <li className="flex gap-2"><span aria-hidden="true" className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Không tự đổi khi chưa có sự đồng ý của bạn.</li>
                  <li className="flex gap-2"><span aria-hidden="true" className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Không yêu cầu thanh toán lại cho các lựa chọn hiển thị.</li>
                  <li className="flex gap-2"><span aria-hidden="true" className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Kiểm tra lại kho ngay lúc bạn xác nhận.</li>
                  <li className="flex gap-2"><span aria-hidden="true" className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Luôn có quyền hoàn 100% nếu không đổi vé.</li>
                </ul>
              </div>
              <div className="rounded-3xl bg-slate-900 p-6 text-white">
                <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-teal-300">Khoản bảo toàn</p>
                <p className="mt-2 text-3xl font-black">{formatCurrency(recoveryCase.creditAmount)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Đây là số tiền tối đa dùng để đổi vé. Phần chưa dùng sẽ được hoàn lại.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
                </div>
                <h2 className="mt-4 text-lg font-black text-slate-900">Cần người hỗ trợ?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Yêu cầu hỗ trợ sẽ tự gắn booking để nhân viên nắm đúng sự cố của bạn.
                </p>
                <Link
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-teal-500 hover:text-teal-800"
                  to={`/support?bookingId=${encodeURIComponent(recoveryCase.originalBookingId)}`}
                >
                  Liên hệ hỗ trợ
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    arrow_forward
                  </span>
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </main>
      {isOpen && (
        <div className="fixed inset-x-3 bottom-3 z-[80] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.24)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-20">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                Còn lại
              </p>
              <p className="font-mono text-lg font-black text-slate-900">{countdown.label}</p>
            </div>
            <a
              className="flex-1 rounded-xl border border-teal-700 px-3 py-2.5 text-center text-xs font-extrabold text-teal-800"
              href="#recovery-options"
            >
              Xem vé
            </a>
            <button
              className="flex-1 rounded-xl bg-amber-700 px-3 py-2.5 text-xs font-extrabold text-white disabled:opacity-50"
              disabled={busy || countdown.expired}
              type="button"
              onClick={() => setDialogMode('decline')}
            >
              Hoàn 100%
            </button>
          </div>
        </div>
      )}
      <DecisionDialog
        busy={busy}
        mode={dialogMode}
        option={selectedOption}
        recoveryCase={recoveryCase}
        onClose={() => {
          if (!busy) {
            setDialogMode(null)
            setSelectedOption(null)
          }
        }}
        onConfirm={confirmDecision}
      />
    </>
  )
}

function RecoveryCaseList({ cases, loading }) {
  if (loading) {
    return <div className="py-20 text-center text-slate-500">Đang tải lịch sử cứu chuyến…</div>
  }
  if (cases.length === 0) {
    return (
      <div className="overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-[#ecfffb] via-white to-[#f0f7ff] p-7 text-center sm:p-10">
          <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-teal-100 text-teal-800">
            <span className="absolute inset-0 animate-ping rounded-3xl bg-teal-200 opacity-20" aria-hidden="true" />
            <span className="material-symbols-outlined relative text-5xl" aria-hidden="true">shield</span>
          </div>
          <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-700">
            Trạng thái bảo vệ · Bình thường
          </p>
          <h2 className="mt-2 text-3xl font-black text-slate-900">Mọi kế hoạch đang an toàn</h2>
          <p className="mx-auto mt-3 max-w-2xl leading-7 text-slate-600">
            Không có booking nào bị gián đoạn. Rescue vẫn theo dõi các thay đổi từ
            đối tác và chỉ mở một hồ sơ xử lý khi quyền lợi của bạn thực sự bị ảnh hưởng.
          </p>
        </div>

        <div className="grid gap-px bg-slate-200 md:grid-cols-3">
          {[
            {
              icon: 'notification_important',
              step: '01',
              title: 'Phát hiện gián đoạn',
              text: 'Đối tác hủy lịch hoặc dịch vụ không thể tiếp tục theo booking đã xác nhận.',
            },
            {
              icon: 'inventory_2',
              step: '02',
              title: 'Khóa phương án còn chỗ',
              text: 'Hệ thống đối chiếu ngày, số khách, tồn kho và khoản tiền bạn đã trả.',
            },
            {
              icon: 'touch_app',
              step: '03',
              title: 'Bạn quyết định',
              text: 'Chọn vé thay thế phù hợp hoặc nhận hoàn 100% về phương thức thanh toán gốc.',
            },
          ].map((item) => (
            <article className="bg-white p-6" key={item.step}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                  <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
                </span>
                <span className="text-xs font-black text-slate-300">{item.step}</span>
              </div>
              <h3 className="mt-4 font-black text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
            </article>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-100 p-6 sm:flex-row">
          <p className="text-sm font-semibold text-slate-600">
            Rescue không phải bảo hiểm và không tự đổi vé khi chưa có sự đồng ý của bạn.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link className="inline-flex rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700" to="/my-tickets">
              Xem vé của tôi
            </Link>
            <Link className="inline-flex rounded-xl bg-[#07545b] px-5 py-3 text-sm font-bold text-white" to="/journey">
              Trung tâm hành trình
            </Link>
          </div>
        </div>
      </div>
    )
  }
  const orderedCases = sortRecoveryCases(cases)
  return (
    <div className="grid gap-5">
      {orderedCases.map((recoveryCase) => {
        const meta = STATUS_META[recoveryCase.status] || STATUS_META.OPEN
        return (
          <Link
            className={`group grid gap-5 rounded-3xl bg-white p-5 shadow-sm transition hover:shadow-lg sm:grid-cols-[1fr_auto] sm:items-center sm:p-6 ${
              recoveryCase.status === 'OPEN'
                ? 'border-2 border-amber-300 hover:border-amber-400'
                : 'border border-slate-200 hover:border-teal-300'
            }`}
            key={recoveryCase.id}
            to={`/rescue/${recoveryCase.id}`}
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-extrabold ${meta.color}`}>
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{meta.icon}</span>
                  {meta.label}
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {formatBookingReference(recoveryCase.originalBookingId)}
                </span>
              </div>
              <h2 className="mt-3 text-xl font-black text-slate-900 group-hover:text-teal-800">
                {recoveryCase.original.attractionTitle}
                {recoveryCase.status === 'REPLACED' && recoveryCase.replacementBooking?.attractionTitle
                  ? ` → ${recoveryCase.replacementBooking.attractionTitle}`
                  : ''}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {formatDate(recoveryCase.original.visitDate)} · {recoveryCase.original.quantity} khách
              </p>
              {recoveryCase.status === 'OPEN' && (
                <p className="mt-2 text-sm font-bold text-amber-800">
                  Chọn trước {formatDateTime(recoveryCase.expiresAt)}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-5 sm:block sm:text-right">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Khoản bảo toàn</p>
                <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(recoveryCase.creditAmount)}</p>
              </div>
              <span className="material-symbols-outlined text-teal-700" aria-hidden="true">arrow_forward</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function RecoveryLoadError({ message, onRetry }) {
  return (
    <div
      className="mx-auto my-10 max-w-2xl rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm"
      role="alert"
    >
      <span className="material-symbols-outlined text-5xl text-rose-600" aria-hidden="true">
        cloud_off
      </span>
      <h2 className="mt-3 text-2xl font-black text-slate-900">
        Chưa thể tải thông tin Rescue
      </h2>
      <p className="mx-auto mt-2 max-w-lg leading-7 text-slate-600">
        {message || 'Kết nối đang gián đoạn. Quyền đổi vé hoặc hoàn tiền của bạn vẫn được giữ.'}
      </p>
      <button
        className="mt-5 rounded-xl bg-[#07545b] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#043f45]"
        type="button"
        onClick={() => onRetry()}
      >
        Thử tải lại
      </button>
    </div>
  )
}

function RecoveryCenterPage() {
  const { id } = useParams()
  const socket = useSocket()
  const [cases, setCases] = useState([])
  const [recoveryCase, setRecoveryCase] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const requestSequenceRef = useRef(0)

  const load = useCallback(async (
    optimisticCase = null,
    { initial = false, quiet = false } = {},
  ) => {
    const requestSequence = requestSequenceRef.current + 1
    requestSequenceRef.current = requestSequence
    if (optimisticCase && id) setRecoveryCase(optimisticCase)
    if (initial) {
      setLoading(true)
      setLoadError(null)
    } else if (!quiet) {
      setRefreshing(true)
    }
    try {
      if (id) {
        const nextCase = await getRecoveryCase(id)
        if (requestSequence === requestSequenceRef.current) {
          setRecoveryCase(nextCase)
          setLoadError(null)
        }
      } else {
        const nextCases = await listRecoveryCases()
        if (requestSequence === requestSequenceRef.current) {
          setCases(sortRecoveryCases(nextCases))
          setLoadError(null)
        }
      }
    } catch (error) {
      if (requestSequence === requestSequenceRef.current) {
        setLoadError(error)
        if (!quiet) toast.error(error.message)
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (id) setRecoveryCase(null)
      else setCases([])
      void load(null, { initial: true })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestSequenceRef.current += 1
    }
  }, [id, load])

  useEffect(() => {
    const refresh = (event) => {
      if (!id || event.recoveryCaseId === id) void load(null, { quiet: true })
    }
    socket.on('RECOVERY_CASE_CREATED', refresh)
    socket.on('RECOVERY_CASE_UPDATED', refresh)
    return () => {
      socket.off('RECOVERY_CASE_CREATED', refresh)
      socket.off('RECOVERY_CASE_UPDATED', refresh)
    }
  }, [id, load, socket])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void load(null, { quiet: true })
      }
    }
    window.addEventListener('online', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('online', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load])

  const visibleRecoveryCase = id && String(recoveryCase?.id) === String(id)
    ? recoveryCase
    : null
  const pageTitle = useMemo(
    () => visibleRecoveryCase?.original?.attractionTitle
      ? `Cứu chuyến ${visibleRecoveryCase.original.attractionTitle}`
      : 'VietTicket Rescue',
    [visibleRecoveryCase],
  )

  return (
    <>
      <Seo
        title={`${pageTitle} | VietTicket Travel`}
        description="Đổi vé thay thế còn chỗ hoặc nhận hoàn tiền 100% khi nhà cung cấp hủy hoạt động."
        noIndex
      />
      <Header activeLink="VietTicket Rescue" />
      {id ? (
        loadError && !visibleRecoveryCase ? (
          <main className="min-h-[70vh] bg-[#f7faf9] px-4 py-8">
            <RecoveryLoadError
              message={loadError.message}
              onRetry={() => load(null, { initial: true })}
            />
          </main>
        ) : (
          <>
            {loadError && visibleRecoveryCase && (
              <div className="border-y border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-900">
                Chưa thể lấy dữ liệu mới nhất. Bạn vẫn đang xem lần tải thành công gần nhất.
              </div>
            )}
            <RecoveryDetail
              loading={loading || !visibleRecoveryCase}
              refreshing={refreshing}
              recoveryCase={visibleRecoveryCase}
              onReload={load}
            />
          </>
        )
      ) : (
        <main className="min-h-[70vh] bg-[#f7faf9]">
          <section className="bg-[#063f45] text-white">
            <div className="container py-10 sm:py-14">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-teal-200">VietTicket Rescue</p>
              <h1 className="mt-3 text-4xl font-black sm:text-5xl">Trung tâm cứu chuyến</h1>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-teal-50/90">
                Nơi xử lý minh bạch mọi booking bị gián đoạn: đổi vé có tồn kho thật
                hoặc hoàn 100% về phương thức thanh toán gốc.
              </p>
            </div>
          </section>
          <div className="container max-w-4xl py-8 sm:py-12">
            {loadError && cases.length === 0 ? (
              <RecoveryLoadError
                message={loadError.message}
                onRetry={() => load(null, { initial: true })}
              />
            ) : (
              <>
                {loadError && (
                  <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                    Chưa thể cập nhật danh sách. Dữ liệu bên dưới là lần tải gần nhất.
                  </div>
                )}
                <RecoveryCaseList cases={cases} loading={loading} />
              </>
            )}
          </div>
        </main>
      )}
      <Footer />
    </>
  )
}

export default RecoveryCenterPage
