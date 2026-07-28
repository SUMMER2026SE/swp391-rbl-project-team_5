import { useCallback, useEffect, useMemo, useState } from 'react'
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

const STATUS_META = {
  OPEN: { label: 'Đang chờ bạn chọn', color: 'bg-amber-100 text-amber-800', icon: 'timer' },
  REPLACED: { label: 'Đã cứu chuyến', color: 'bg-emerald-100 text-emerald-800', icon: 'verified' },
  REFUND_PENDING: { label: 'Đang hoàn tiền', color: 'bg-sky-100 text-sky-800', icon: 'payments' },
  REFUNDED: { label: 'Đã hoàn tiền', color: 'bg-slate-100 text-slate-700', icon: 'task_alt' },
}

function useCountdown(expiresAt, active) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [active])
  const remaining = Math.max(0, new Date(expiresAt || 0).getTime() - now)
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return {
    expired: remaining <= 0,
    label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  }
}

function FinancialSummary({ creditAmount, option }) {
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
        <span className="font-semibold text-slate-700">Bạn được hoàn chênh lệch</span>
        <strong className="text-base text-emerald-700">
          {formatCurrency(option.refundAmount)}
        </strong>
      </div>
    </div>
  )
}

function RecoveryOptionCard({ option, creditAmount, onSelect, disabled }) {
  const [imageFailed, setImageFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
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
          {Math.round(option.matchScore)}% phù hợp
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
          <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">
            <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
              star
            </span>
            {option.averageRating.toFixed(1)}
          </div>
        </div>
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
            {option.district ? `${option.district}, ` : ''}{option.city}
            {option.distanceKm != null ? ` · ${option.distanceKm} km từ điểm cũ` : ''}
          </p>
        </div>
        <ul className="mt-4 space-y-2">
          {option.recommendationReasons.map((reason) => (
            <li className="flex items-start gap-2 text-sm text-slate-700" key={reason}>
              <span className="material-symbols-outlined mt-0.5 text-[17px] text-emerald-600" aria-hidden="true">
                check_circle
              </span>
              {reason}
            </li>
          ))}
        </ul>
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
  if (!mode) return null
  const isAccept = mode === 'accept'
  return (
    <div
      aria-labelledby="recovery-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7">
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
            <p className="mt-2 leading-7 text-slate-600">
              VietTicket sẽ giữ chỗ tại <strong>{option.attractionTitle}</strong>,
              cấp booking và QR hoàn toàn mới. QR cũ tiếp tục bị vô hiệu.
            </p>
            <div className="mt-5">
              <FinancialSummary creditAmount={recoveryCase.creditAmount} option={option} />
            </div>
          </>
        ) : (
          <p className="mt-2 leading-7 text-slate-600">
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
            {busy ? 'Đang kiểm tra tồn kho…' : isAccept ? 'Xác nhận đổi vé' : 'Xác nhận hoàn 100%'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecoveryDetail({ recoveryCase, loading, onReload }) {
  const [dialogMode, setDialogMode] = useState(null)
  const [selectedOption, setSelectedOption] = useState(null)
  const [busy, setBusy] = useState(false)
  const countdown = useCountdown(recoveryCase?.expiresAt, recoveryCase?.status === 'OPEN')
  const statusMeta = STATUS_META[recoveryCase?.status] || STATUS_META.OPEN

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
            </div>
            {isOpen && (
              <div className="rounded-2xl bg-white/10 p-5 text-center ring-1 ring-white/20 backdrop-blur">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-100">
                  Tự động hoàn 100% sau
                </p>
                <p className="mt-2 font-mono text-4xl font-black tracking-wider">
                  {countdown.label}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <main className="bg-[#f7faf9]">
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
                <section className="mt-8">
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
                      type="button"
                      onClick={() => onReload()}
                    >
                      <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
                        refresh
                      </span>
                      Kiểm tra lại chỗ
                    </button>
                  </div>
                  {recoveryCase.options?.length > 0 ? (
                    <div className="mt-6 grid gap-6 xl:grid-cols-2">
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
                        Các phương án vừa hết chỗ
                      </h3>
                      <p className="mx-auto mt-2 max-w-lg leading-7 text-slate-600">
                        Tồn kho có thể thay đổi nhanh. Bạn có thể kiểm tra lại hoặc
                        nhận hoàn tiền 100% ngay bên dưới.
                      </p>
                    </div>
                  )}
                  <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:p-6">
                    <div>
                      <h3 className="font-extrabold text-slate-900">Không phương án nào phù hợp?</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Quyền hoàn 100% luôn được giữ, không phụ thuộc chính sách hủy của vé.
                      </p>
                    </div>
                    <button
                      className="w-full shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-extrabold text-amber-900 transition hover:bg-amber-100 sm:w-auto"
                      disabled={busy}
                      type="button"
                      onClick={() => setDialogMode('decline')}
                    >
                      Nhận hoàn tiền 100%
                    </button>
                  </div>
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
                      {recoveryCase.refundAmount > 0 && (
                        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                          <strong>{formatCurrency(recoveryCase.refundAmount)} tiền chênh lệch</strong>
                          {' '}đã được chuyển sang quy trình hoàn về phương thức thanh toán gốc.
                          Bạn không phải trả bất kỳ phí đổi vé nào.
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
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                        <span className="material-symbols-outlined text-3xl" aria-hidden="true">payments</span>
                      </div>
                      <h2 className="mt-4 text-3xl font-black text-slate-900">Hoàn tiền 100% đang được xử lý</h2>
                      <p className="mt-2 leading-7 text-slate-600">
                        {formatCurrency(recoveryCase.refundAmount || recoveryCase.creditAmount)}
                        {' '}được hoàn về phương thức thanh toán gốc. Không có phí hủy.
                      </p>
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
                  <li className="flex gap-2"><span className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Không tự đổi khi chưa có sự đồng ý của bạn.</li>
                  <li className="flex gap-2"><span className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Không yêu cầu thanh toán lại cho các lựa chọn hiển thị.</li>
                  <li className="flex gap-2"><span className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Kiểm tra lại kho ngay lúc bạn xác nhận.</li>
                  <li className="flex gap-2"><span className="material-symbols-outlined text-[19px] text-emerald-600">check_circle</span>Luôn có quyền hoàn 100% nếu không đổi vé.</li>
                </ul>
              </div>
              <div className="rounded-3xl bg-slate-900 p-6 text-white">
                <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-teal-300">Khoản bảo toàn</p>
                <p className="mt-2 text-3xl font-black">{formatCurrency(recoveryCase.creditAmount)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Đây là số tiền tối đa dùng để đổi vé. Phần chưa dùng sẽ được hoàn lại.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
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
  return (
    <div className="grid gap-5">
      {cases.map((recoveryCase) => {
        const meta = STATUS_META[recoveryCase.status] || STATUS_META.OPEN
        return (
          <Link
            className="group grid gap-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-lg sm:grid-cols-[1fr_auto] sm:items-center sm:p-6"
            key={recoveryCase.id}
            to={`/rescue/${recoveryCase.id}`}
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-extrabold ${meta.color}`}>
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{meta.icon}</span>
                  {meta.label}
                </span>
                <span className="text-xs font-bold text-slate-400">
                  Booking #{recoveryCase.originalBookingId.slice(-8).toUpperCase()}
                </span>
              </div>
              <h2 className="mt-3 text-xl font-black text-slate-900 group-hover:text-teal-800">
                {recoveryCase.original.attractionTitle}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {formatDate(recoveryCase.original.visitDate)} · {recoveryCase.original.quantity} khách
              </p>
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

function RecoveryCenterPage() {
  const { id } = useParams()
  const socket = useSocket()
  const [cases, setCases] = useState([])
  const [recoveryCase, setRecoveryCase] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (optimisticCase = null) => {
    if (optimisticCase && id) setRecoveryCase(optimisticCase)
    setLoading(true)
    try {
      if (id) {
        setRecoveryCase(await getRecoveryCase(id))
      } else {
        setCases(await listRecoveryCases())
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const refresh = (event) => {
      if (!id || event.recoveryCaseId === id) void load()
    }
    socket.on('RECOVERY_CASE_CREATED', refresh)
    socket.on('RECOVERY_CASE_UPDATED', refresh)
    return () => {
      socket.off('RECOVERY_CASE_CREATED', refresh)
      socket.off('RECOVERY_CASE_UPDATED', refresh)
    }
  }, [id, load, socket])

  const pageTitle = useMemo(
    () => recoveryCase?.original?.attractionTitle
      ? `Cứu chuyến ${recoveryCase.original.attractionTitle}`
      : 'VietTicket Rescue',
    [recoveryCase],
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
        <RecoveryDetail loading={loading} recoveryCase={recoveryCase} onReload={load} />
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
            <RecoveryCaseList cases={cases} loading={loading} />
          </div>
        </main>
      )}
      <Footer />
    </>
  )
}

export default RecoveryCenterPage
