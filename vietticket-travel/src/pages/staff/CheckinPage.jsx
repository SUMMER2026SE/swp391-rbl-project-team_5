import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import QrCameraScanner from '../../components/staff/QrCameraScanner.jsx'
import {
  checkInTicket,
  listOperationalBookings,
  listTodayBookings,
  lookupCheckinTarget,
  reissueTicket,
} from '../../services/staffApi.js'
import {
  formatBookingReference,
  formatTicketReference,
} from '../../utils/bookingReference.js'

const REISSUE_REASON_OPTIONS = [
  { value: 'LOST_BY_CUSTOMER', label: 'Khách làm mất vé' },
  { value: 'DAMAGED_QR', label: 'Mã QR bị lỗi/không đọc được' },
  { value: 'CONTACT_CHANGED', label: 'Khách đổi thông tin liên hệ' },
  { value: 'OPERATIONAL_ERROR', label: 'Lỗi vận hành tại cổng' },
  { value: 'OTHER', label: 'Lý do khác' },
]

// Trang check-in tại cổng cho nhân viên:
// - Ô nhập nhận mã từ máy quét QR (máy quét gõ chuỗi + Enter như bàn phím)
//   hoặc nhân viên nhập tay mã vé khách đọc.
// - Tra cứu trước, hiển thị thông tin đơn, rồi mới bấm check-in.
// - Danh sách đơn của hôm nay để đối chiếu khách walk-in.

const TICKET_STATUS_META = {
  VALID: { label: 'Chưa sử dụng', className: 'bg-primary-fixed-dim/20 text-primary' },
  USED: { label: 'Đã check-in', className: 'bg-surface-container text-on-surface-variant' },
  EXPIRED: { label: 'Đã thu hồi', className: 'bg-error/10 text-error' },
  REFUNDED: { label: 'Đã hoàn tiền', className: 'bg-error/10 text-error' },
}

// Kết quả tra cứu: thông tin đơn + danh sách TẤT CẢ vé để soát lần lượt.
// Dùng chung cho cả khi quét QR một vé lẫn khi tra bằng mã đặt chỗ.
function BookingCheckinCard({ result, onCheckinTicket, onCheckinAll, checkingTicketId, isCheckingAll }) {
  const tickets = Array.isArray(result.tickets) ? result.tickets : []
  const summary = result.summary || { total: tickets.length, valid: 0, used: 0, checkable: 0 }
  const anyCheckable = summary.checkable > 0
  const busy = Boolean(checkingTicketId) || isCheckingAll

  return (
    <div
      className={`rounded-xl border-2 p-5 ${
        anyCheckable ? 'border-primary bg-primary-fixed-dim/10' : 'border-error bg-error-container/20'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`material-symbols-outlined text-4xl ${anyCheckable ? 'text-primary' : 'text-error'}`}
          aria-hidden="true"
        >
          {anyCheckable ? 'verified' : 'block'}
        </span>
        <div className="min-w-0">
          <p className={`text-lg font-bold ${anyCheckable ? 'text-primary' : 'text-error'}`}>
            {anyCheckable
              ? `Còn ${summary.checkable}/${summary.total} vé có thể check-in`
              : 'Không có vé nào đủ điều kiện check-in'}
          </p>
          <p className="text-sm text-on-surface-variant">
            {result.matchType === 'BOOKING'
              ? 'Tra theo mã đặt chỗ — chọn từng vé để cho khách vào cổng.'
              : 'Quét theo mã QR — vé được quét đã được đánh dấu bên dưới.'}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <InfoRow label="Mã đơn" value={formatBookingReference(result.bookingId)} mono />
        <InfoRow label="Khách hàng" value={result.customer} />
        <InfoRow label="Số điện thoại" value={result.phone || '—'} />
        <InfoRow label="Địa điểm" value={result.attraction} />
        <InfoRow label="Loại vé" value={result.ticketName} />
        <InfoRow label="Tổng vé trong đơn" value={summary.total} />
        <InfoRow label="Ngày tham quan" value={result.visitDate} />
        <InfoRow label="Khung giờ" value={result.timeSlot || 'Cả ngày'} />
        <InfoRow label="Trạng thái đơn" value={result.bookingStatus} />
        <InfoRow label="Đã vào cổng" value={`${summary.used}/${summary.total}`} />
      </dl>

      {summary.checkable > 1 && (
        <button
          type="button"
          onClick={onCheckinAll}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          <span className="material-symbols-outlined" aria-hidden="true">group_add</span>
          {isCheckingAll
            ? 'Đang check-in cả nhóm…'
            : `Check-in tất cả ${summary.checkable} vé còn lại`}
        </button>
      )}

      <ul className="mt-5 space-y-2">
        {tickets.map((ticket) => {
          const meta = TICKET_STATUS_META[ticket.status] || {
            label: ticket.status,
            className: 'bg-surface-container text-on-surface-variant',
          }
          const isBusy = checkingTicketId === ticket.ticketId
          return (
            <li
              key={ticket.ticketId}
              className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                ticket.isMatched
                  ? 'border-primary bg-primary/5'
                  : 'border-outline-variant bg-surface-container-lowest'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-on-surface">
                  Vé #{ticket.index}
                  <span className="ml-2 font-mono text-xs font-semibold text-on-surface-variant">
                    {formatTicketReference(ticket.ticketId)}
                  </span>
                  {ticket.isMatched && (
                    <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-on-primary">
                      VỪA QUÉT
                    </span>
                  )}
                </p>
                {!ticket.canCheckIn && ticket.blockReason && (
                  <p className="mt-1 text-xs font-semibold text-error">{ticket.blockReason}</p>
                )}
              </div>

              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>
                {meta.label}
              </span>

              {ticket.canCheckIn && (
                <button
                  type="button"
                  onClick={() => onCheckinTicket(ticket)}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    how_to_reg
                  </span>
                  {isBusy ? 'Đang check-in…' : 'Check-in'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-3 border-b border-outline-variant/40 py-1.5">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className={`text-right font-semibold text-on-surface ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

export default function CheckinPage() {
  const [tokenInput, setTokenInput] = useState('')
  const [lookupResult, setLookupResult] = useState(null)
  const [lastCheckin, setLastCheckin] = useState(null)
  const [isLooking, setIsLooking] = useState(false)
  const [checkingTicketId, setCheckingTicketId] = useState('')
  const [isCheckingAll, setIsCheckingAll] = useState(false)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [todayBookings, setTodayBookings] = useState([])
  const [todayMeta, setTodayMeta] = useState({ date: '', total: 0, checkedIn: 0 })
  const [todaySearch, setTodaySearch] = useState('')
  const [operationalBookings, setOperationalBookings] = useState([])
  const [operationalSearch, setOperationalSearch] = useState('')
  const [isLoadingOperational, setIsLoadingOperational] = useState(false)
  const [reissueTarget, setReissueTarget] = useState(null)
  const [reissueReasonCode, setReissueReasonCode] = useState('LOST_BY_CUSTOMER')
  const [reissueReason, setReissueReason] = useState('')
  const [isReissuing, setIsReissuing] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    document.title = 'Check-in vé | VietTicket Staff'
    inputRef.current?.focus()
  }, [])

  const fetchToday = useCallback(async () => {
    try {
      const response = await listTodayBookings()
      setTodayBookings(response.data || [])
      setTodayMeta(response.meta || { date: '', total: 0, checkedIn: 0 })
    } catch (error) {
      toast.error(error.message || 'Không tải được danh sách đơn hôm nay.')
    }
  }, [])

  const fetchOperational = useCallback(async (search = '') => {
    setIsLoadingOperational(true)
    try {
      const response = await listOperationalBookings({ search: search.trim() || undefined })
      setOperationalBookings(response.data || [])
    } catch (error) {
      toast.error(error.message || 'Không tải được danh sách đơn có thể cấp lại vé.')
    } finally {
      setIsLoadingOperational(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchToday(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchToday])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchOperational(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchOperational])

  // Tra cứu bằng mã QR, mã vé hoặc mã đặt chỗ VT-XXXX (backend tự nhận dạng).
  const runLookup = useCallback(async (rawValue, { silent = false } = {}) => {
    const query = String(rawValue || '').trim()
    if (!query) return null
    setIsLooking(true)
    try {
      const response = await lookupCheckinTarget(query)
      setLookupResult(response.data)
      return response.data
    } catch (error) {
      setLookupResult(null)
      if (!silent) toast.error(error.message || 'Không tìm thấy vé.')
      return null
    } finally {
      setIsLooking(false)
    }
  }, [])

  async function handleLookup(event) {
    event?.preventDefault()
    if (!tokenInput.trim()) return
    setLastCheckin(null)
    await runLookup(tokenInput)
    inputRef.current?.select()
  }

  // Mã quét được từ camera: điền vào ô nhập rồi tra cứu ngay.
  async function handleScanned(value) {
    setIsScannerOpen(false)
    setTokenInput(value)
    setLastCheckin(null)
    await runLookup(value)
  }

  // Làm mới kết quả sau khi check-in để hiển thị trạng thái mới nhất.
  async function refreshLookup() {
    const key = lookupResult?.bookingId || tokenInput
    if (key) await runLookup(key, { silent: true })
  }

  async function handleCheckinTicket(ticket) {
    if (!ticket?.canCheckIn || checkingTicketId) return
    setCheckingTicketId(ticket.ticketId)
    try {
      const response = await checkInTicket(ticket.token)
      setLastCheckin(response.data)
      toast.success(response.message || 'Check-in thành công.')
    } catch (error) {
      toast.error(error.message || 'Check-in thất bại.')
    } finally {
      setCheckingTicketId('')
      // Luôn tra cứu lại: kể cả khi lỗi (ví dụ vé vừa bị quét ở cổng khác).
      await refreshLookup()
      void fetchToday()
      void fetchOperational(operationalSearch)
    }
  }

  // Check-in cả nhóm: lần lượt từng vé, không dừng khi một vé lỗi.
  async function handleCheckinAll() {
    const targets = (lookupResult?.tickets || []).filter((item) => item.canCheckIn)
    if (targets.length === 0 || isCheckingAll) return

    setIsCheckingAll(true)
    let succeeded = 0
    const failures = []
    try {
      for (const target of targets) {
        try {
          // Tuần tự để tránh tranh chấp tồn kho/trạng thái ở cổng.
          const response = await checkInTicket(target.token)
          succeeded += 1
          setLastCheckin(response.data)
        } catch (error) {
          failures.push(`Vé #${target.index}: ${error.message || 'lỗi không xác định'}`)
        }
      }
    } finally {
      setIsCheckingAll(false)
      await refreshLookup()
      void fetchToday()
      void fetchOperational(operationalSearch)
    }

    if (succeeded > 0) toast.success(`Đã check-in ${succeeded} vé.`)
    if (failures.length > 0) toast.error(`Không check-in được ${failures.length} vé. ${failures[0]}`)
  }

  async function handleReissue() {
    if (!reissueTarget) return
    const reason = reissueReason.trim()
    if (reason.length < 5) {
      toast.warning('Vui lòng mô tả lý do cấp lại vé, tối thiểu 5 ký tự.')
      return
    }

    setIsReissuing(true)
    try {
      const response = await reissueTicket(
        reissueTarget.bookingId,
        reissueReasonCode,
        reason,
      )
      const count = Number(response.data?.reissuedCount || 0)
      toast.success(
        response.data?.emailDelivered === false
          ? `Đã cấp lại ${count} vé. Email chưa gửi được; vui lòng hướng dẫn khách mở vé trong tài khoản.`
          : `Đã cấp lại ${count} vé và gửi thông báo cho khách.`,
      )
      setReissueTarget(null)
      setReissueReason('')
      setReissueReasonCode('LOST_BY_CUSTOMER')
      void fetchToday()
      void fetchOperational(operationalSearch)
    } catch (error) {
      toast.error(error.message || 'Không thể cấp lại vé.')
    } finally {
      setIsReissuing(false)
    }
  }

  const filteredToday = todayBookings.filter((b) => {
    const query = todaySearch.trim().toLowerCase()
    if (!query) return true
    return [b.bookingId, b.customer, b.attraction, b.phone]
      .some((value) => String(value || '').toLowerCase().includes(query))
  })

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm...">
      <div className="mx-auto max-w-5xl p-4 sm:p-8">
        <div className="mb-5">
          <h2 className="mb-1 text-2xl font-bold text-on-surface sm:text-3xl">Check-in vé</h2>
          <p className="max-w-2xl text-sm text-on-surface-variant">
            Quét mã QR trên vé điện tử của khách hoặc nhập tay mã vé để xác nhận vào cổng.
          </p>
        </div>

        {/* Ô quét / nhập mã */}
        <form
          onSubmit={handleLookup}
          className="mb-6 rounded-xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-bold text-on-surface" htmlFor="staff-checkin-token">
              Mã QR / mã vé
            </label>
            <span className="inline-flex w-fit rounded-full bg-primary-fixed-dim/20 px-3 py-1 text-xs font-semibold text-primary">
              Sẵn sàng nhận dữ liệu từ máy quét QR
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative min-w-0">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[22px] text-on-surface-variant">
                qr_code_scanner
              </span>
              <input
                id="staff-checkin-token"
                aria-describedby="staff-checkin-token-hint"
                ref={inputRef}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Quét QR, nhập mã vé hoặc mã đặt chỗ VT-…"
                autoComplete="off"
                className="h-14 w-full rounded-xl border border-outline-variant bg-surface pl-11 pr-4 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-primary px-5 text-sm font-bold text-primary transition hover:bg-primary/5 active:scale-[0.99]"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                photo_camera
              </span>
              Quét bằng camera
            </button>
            <button
              type="submit"
              disabled={isLooking || !tokenInput.trim()}
              className="flex h-14 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-on-primary shadow-sm transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">search</span>
              {isLooking ? 'Đang tra cứu…' : 'Tra cứu vé'}
            </button>
          </div>

          <p id="staff-checkin-token-hint" className="mt-3 text-xs text-on-surface-variant">
            Chấp nhận: mã QR trên vé, mã vé nhập tay, hoặc <strong>mã đặt chỗ dạng VT-XXXXXXXXXXXX</strong> in
            trên vé của khách. Tra bằng mã đặt chỗ sẽ hiện toàn bộ vé trong đơn để soát cho cả nhóm.
          </p>
        </form>

        {/* Kết quả tra cứu */}
        {lookupResult && (
          <div className="mb-6">
            <BookingCheckinCard
              result={lookupResult}
              onCheckinTicket={handleCheckinTicket}
              onCheckinAll={handleCheckinAll}
              checkingTicketId={checkingTicketId}
              isCheckingAll={isCheckingAll}
            />
          </div>
        )}

        {/* Xác nhận check-in gần nhất */}
        {lastCheckin && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border-2 border-primary bg-primary-fixed-dim/15 p-5">
            <span className="material-symbols-outlined text-4xl text-primary" aria-hidden="true">
              task_alt
            </span>
            <div>
              <p className="text-lg font-bold text-primary">
                Đã check-in {lastCheckin.checkedInCount} vé — {lastCheckin.customer}
              </p>
              <p className="text-sm text-on-surface-variant">
                {lastCheckin.attraction} · {lastCheckin.ticketName} ·{' '}
                {lastCheckin.timeSlot || 'Cả ngày'}
              </p>
            </div>
          </div>
        )}

        <section className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <div className="border-b border-outline-variant bg-surface-container-low px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-base font-semibold text-on-surface">Tra cứu và cấp lại vé</h4>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Tìm đơn đã xác nhận từ hôm nay đến 30 ngày tới trong các địa điểm được phân công.
                </p>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void fetchOperational(operationalSearch)
                }}
              >
                <input
                  value={operationalSearch}
                  onChange={(event) => setOperationalSearch(event.target.value)}
                  type="search"
                  placeholder="Mã đơn, tên hoặc SĐT"
                  className="min-w-0 rounded-full border border-outline-variant bg-surface px-4 py-2 text-sm outline-none focus:border-primary sm:w-64"
                />
                <button
                  type="submit"
                  disabled={isLoadingOperational}
                  className="rounded-full border-0 bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
                >
                  {isLoadingOperational ? 'Đang tìm…' : 'Tìm'}
                </button>
              </form>
            </div>
          </div>
          <div className="divide-y divide-outline-variant/40">
            {operationalBookings.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
                {isLoadingOperational ? 'Đang tải danh sách…' : 'Không có đơn phù hợp để cấp lại vé.'}
              </p>
            ) : (
              operationalBookings.map((booking) => (
                <div key={booking.bookingId} className="grid gap-3 px-5 py-4 lg:grid-cols-[150px_1fr_180px_auto] lg:items-center">
                  <div>
                    <p className="font-mono text-xs font-bold text-primary">{formatBookingReference(booking.bookingId)}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {String(booking.visitDate || '').split('-').reverse().join('/')}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{booking.customer}</p>
                    <p className="truncate text-xs text-on-surface-variant">{booking.attraction} · {booking.ticketName}</p>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    {booking.validCount}/{booking.quantity} vé còn hiệu lực
                  </p>
                  <button
                    type="button"
                    disabled={booking.validCount < 1}
                    onClick={() => {
                      setReissueTarget(booking)
                      setReissueReason('')
                      setReissueReasonCode('LOST_BY_CUSTOMER')
                    }}
                    className="flex items-center justify-center gap-1 rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">autorenew</span>
                    Cấp lại vé
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Danh sách đơn hôm nay */}
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
          <div className="flex flex-col gap-3 border-b border-outline-variant bg-surface-container-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h4 className="text-base font-semibold text-on-surface">
                Đơn hôm nay {todayMeta.date && `(${todayMeta.date})`}
              </h4>
              <span className="rounded-full bg-primary-fixed-dim/20 px-2.5 py-1 text-xs font-bold text-primary">
                {todayMeta.checkedIn}/{todayMeta.total} đã check-in
              </span>
              <button
                type="button"
                onClick={() => void fetchToday()}
                className="flex items-center gap-1 rounded-lg border border-outline-variant px-2.5 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface"
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">refresh</span>
                Làm mới
              </button>
            </div>
            <input
              value={todaySearch}
              onChange={(e) => setTodaySearch(e.target.value)}
              type="search"
              placeholder="Tìm theo tên, mã đơn, SĐT…"
              className="rounded-full border border-outline-variant bg-surface px-4 py-2 text-sm outline-none focus:border-primary sm:w-64"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold text-on-surface-variant">
                  <th className="px-5 py-3">Mã đơn</th>
                  <th className="px-5 py-3">Khách hàng</th>
                  <th className="px-5 py-3">Địa điểm / Vé</th>
                  <th className="px-5 py-3">Khung giờ</th>
                  <th className="px-5 py-3">SL</th>
                  <th className="px-5 py-3">Trạng thái / thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredToday.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-on-surface-variant">
                      {todayBookings.length === 0
                        ? 'Chưa có đơn nào cho hôm nay.'
                        : 'Không tìm thấy đơn phù hợp.'}
                    </td>
                  </tr>
                ) : (
                  filteredToday.map((b) => (
                    <tr key={b.bookingId} className="border-b border-outline-variant/40 hover:bg-surface">
                      <td className="px-5 py-3 font-mono text-xs font-semibold text-primary">
                        {formatBookingReference(b.bookingId)}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-on-surface">{b.customer}</p>
                        <p className="text-xs text-on-surface-variant">{b.phone || '—'}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-on-surface">{b.attraction}</p>
                        <p className="text-xs text-on-surface-variant">{b.ticketName}</p>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-on-surface-variant">
                        {b.timeSlot || 'Cả ngày'}
                      </td>
                      <td className="px-5 py-3 text-on-surface">{b.quantity}</td>
                      <td className="px-5 py-3 space-y-2">
                        {b.checkedIn ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary-fixed-dim/20 px-2.5 py-1 text-xs font-bold text-primary">
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
                            Đã vào cổng
                          </span>
                        ) : b.usedCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary-fixed-dim/20 px-2.5 py-1 text-xs font-bold text-primary">
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">group</span>
                            Đã vào {b.usedCount}/{b.quantity}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-fixed/30 px-2.5 py-1 text-xs font-bold text-secondary">
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">schedule</span>
                            Chưa đến
                          </span>
                        )}
                        {b.bookingStatus === 'CONFIRMED' && b.validCount > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {/* Phương án dự phòng khi khách không xuất trình được mã QR. */}
                            <button
                              type="button"
                              onClick={() => {
                                setTokenInput(formatBookingReference(b.bookingId))
                                setLastCheckin(null)
                                void runLookup(b.bookingId)
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-on-primary hover:opacity-90"
                            >
                              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">how_to_reg</span>
                              Check-in
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReissueTarget(b)
                                setReissueReason('')
                                setReissueReasonCode('LOST_BY_CUSTOMER')
                              }}
                              className="flex items-center gap-1 rounded-lg border border-primary px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/5"
                            >
                              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">autorenew</span>
                              Cấp lại vé
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {isScannerOpen && (
          <QrCameraScanner
            onDetected={(value) => void handleScanned(value)}
            onClose={() => setIsScannerOpen(false)}
          />
        )}

        {reissueTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={isReissuing ? undefined : () => setReissueTarget(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="reissue-title"
              className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="reissue-title" className="text-xl font-bold text-on-surface">
                Cấp lại vé điện tử
              </h3>
              <p className="mt-2 text-sm text-on-surface-variant">
                Đơn <strong>{formatBookingReference(reissueTarget.bookingId)}</strong> ·{' '}
                {reissueTarget.customer}. Toàn bộ mã QR còn hiệu lực sẽ bị thu hồi và thay bằng mã mới.
              </p>

              <label className="mt-5 block text-sm font-semibold text-on-surface">
                Nhóm lý do
                <select
                  value={reissueReasonCode}
                  onChange={(event) => setReissueReasonCode(event.target.value)}
                  disabled={isReissuing}
                  className="mt-2 w-full rounded-xl border border-outline-variant bg-white px-3 py-2.5 outline-none focus:border-primary"
                >
                  {REISSUE_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="mt-4 block text-sm font-semibold text-on-surface">
                Mô tả sự việc
                <textarea
                  value={reissueReason}
                  onChange={(event) => setReissueReason(event.target.value)}
                  maxLength={500}
                  rows={4}
                  disabled={isReissuing}
                  placeholder="Ví dụ: Khách báo mất điện thoại và đã xác minh họ tên, số điện thoại, mã đơn tại quầy."
                  className="mt-2 w-full resize-none rounded-xl border border-outline-variant px-3 py-2.5 outline-none focus:border-primary"
                />
              </label>
              <p className="mt-1 text-right text-xs text-on-surface-variant">
                {reissueReason.length}/500
              </p>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={isReissuing}
                  onClick={() => setReissueTarget(null)}
                  className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={isReissuing || reissueReason.trim().length < 5}
                  onClick={() => void handleReissue()}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
                >
                  {isReissuing ? 'Đang cấp lại…' : 'Xác nhận cấp lại'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
