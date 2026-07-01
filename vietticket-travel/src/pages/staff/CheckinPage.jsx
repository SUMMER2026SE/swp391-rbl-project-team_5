import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import { listTodayBookings, lookupTicketByQr, checkInTicket } from '../../services/staffApi.js'

// Trang check-in tại cổng cho nhân viên:
// - Ô nhập nhận mã từ máy quét QR (máy quét gõ chuỗi + Enter như bàn phím)
//   hoặc nhân viên nhập tay mã vé khách đọc.
// - Tra cứu trước, hiển thị thông tin đơn, rồi mới bấm check-in.
// - Danh sách đơn của hôm nay để đối chiếu khách walk-in.

function TicketResultCard({ ticket, onCheckin, isChecking }) {
  const ok = ticket.canCheckIn
  return (
    <div
      className={`rounded-xl border-2 p-5 ${
        ok ? 'border-primary bg-primary-fixed-dim/10' : 'border-error bg-error-container/20'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`material-symbols-outlined text-4xl ${ok ? 'text-primary' : 'text-error'}`}
          aria-hidden="true"
        >
          {ok ? 'verified' : 'block'}
        </span>
        <div>
          <p className={`text-lg font-bold ${ok ? 'text-primary' : 'text-error'}`}>
            {ok ? 'Vé hợp lệ — sẵn sàng check-in' : 'Không thể check-in'}
          </p>
          {!ok && <p className="text-sm font-semibold text-error">{ticket.blockReason}</p>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <InfoRow label="Mã đơn" value={ticket.bookingId.slice(0, 8).toUpperCase()} mono />
        <InfoRow label="Khách hàng" value={ticket.customer} />
        <InfoRow label="Số điện thoại" value={ticket.phone || '—'} />
        <InfoRow label="Địa điểm" value={ticket.attraction} />
        <InfoRow label="Loại vé" value={`${ticket.ticketName} × ${ticket.quantity}`} />
        <InfoRow label="Ngày tham quan" value={ticket.visitDate} />
        <InfoRow label="Khung giờ" value={ticket.timeSlot || 'Cả ngày'} />
        <InfoRow label="Trạng thái vé" value={ticket.ticketStatus} />
      </dl>

      {ok && (
        <button
          type="button"
          onClick={onCheckin}
          disabled={isChecking}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          <span className="material-symbols-outlined" aria-hidden="true">how_to_reg</span>
          {isChecking ? 'Đang check-in…' : `Check-in ${ticket.quantity} khách`}
        </button>
      )}
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
  const [ticket, setTicket] = useState(null)
  const [lastCheckin, setLastCheckin] = useState(null)
  const [isLooking, setIsLooking] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [todayBookings, setTodayBookings] = useState([])
  const [todayMeta, setTodayMeta] = useState({ date: '', total: 0, checkedIn: 0 })
  const [todaySearch, setTodaySearch] = useState('')
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

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchToday(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchToday])

  async function handleLookup(event) {
    event?.preventDefault()
    const token = tokenInput.trim()
    if (!token) return
    setIsLooking(true)
    setTicket(null)
    setLastCheckin(null)
    try {
      const response = await lookupTicketByQr(token)
      setTicket({ ...response.data, token })
    } catch (error) {
      toast.error(error.message || 'Không tìm thấy vé.')
    } finally {
      setIsLooking(false)
      inputRef.current?.select()
    }
  }

  async function handleCheckin() {
    if (!ticket?.canCheckIn) return
    setIsChecking(true)
    try {
      const response = await checkInTicket(ticket.token)
      setLastCheckin(response.data)
      setTicket(null)
      setTokenInput('')
      toast.success(response.message || 'Check-in thành công.')
      void fetchToday()
      inputRef.current?.focus()
    } catch (error) {
      toast.error(error.message || 'Check-in thất bại.')
      // Tra cứu lại để hiển thị trạng thái mới nhất (ví dụ vé vừa bị quét nơi khác)
      void handleLookup()
    } finally {
      setIsChecking(false)
    }
  }

  const filteredToday = todayBookings.filter((b) => {
    const query = todaySearch.trim().toLowerCase()
    if (!query) return true
    return [b.bookingId, b.customer, b.attraction, b.phone || '']
      .some((value) => value.toLowerCase().includes(query))
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
              Mã QR / QR token
            </label>
            <span className="inline-flex w-fit rounded-full bg-primary-fixed-dim/20 px-3 py-1 text-xs font-semibold text-primary">
              Hỗ trợ VIETTICKET:&lt;token&gt; hoặc qrCodeToken
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_188px]">
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
                placeholder="Dán VIETTICKET:<token> hoặc qrCodeToken..."
                autoComplete="off"
                className="h-14 w-full rounded-xl border border-outline-variant bg-surface pl-11 pr-4 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
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
            Khi test thủ công, copy qrCodeToken của vé rồi dán vào ô trên.
          </p>
        </form>

        {/* Kết quả tra cứu */}
        {ticket && (
          <div className="mb-6">
            <TicketResultCard ticket={ticket} onCheckin={handleCheckin} isChecking={isChecking} />
          </div>
        )}

        {/* Xác nhận check-in gần nhất */}
        {lastCheckin && !ticket && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border-2 border-primary bg-primary-fixed-dim/15 p-5">
            <span className="material-symbols-outlined text-4xl text-primary" aria-hidden="true">
              task_alt
            </span>
            <div>
              <p className="text-lg font-bold text-primary">
                Đã check-in {lastCheckin.checkedInCount} khách — {lastCheckin.customer}
              </p>
              <p className="text-sm text-on-surface-variant">
                {lastCheckin.attraction} · {lastCheckin.ticketName} ·{' '}
                {lastCheckin.timeSlot || 'Cả ngày'}
              </p>
            </div>
          </div>
        )}

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
                  <th className="px-5 py-3">Check-in</th>
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
                        {b.bookingId.slice(0, 8).toUpperCase()}
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
                      <td className="px-5 py-3">
                        {b.checkedIn ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary-fixed-dim/20 px-2.5 py-1 text-xs font-bold text-primary">
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
                            Đã vào cổng
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-fixed/30 px-2.5 py-1 text-xs font-bold text-secondary">
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">schedule</span>
                            Chưa đến
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
