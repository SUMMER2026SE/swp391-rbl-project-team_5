import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import useSocket from '../context/useSocket.js'
import bookingService from '../services/bookingService.js'
import { formatBookingReference } from '../utils/bookingReference.js'
import {
  getTicketInstanceStatus,
  getTicketInstanceStatusMeta,
  hasUsableTicketInstances,
  isTicketInstanceUsable,
} from '../utils/ticketInstanceStatus.js'

const fallbackImage =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1400&q=85'

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

const parseTimeSlot = (timeSlotLabel) => {
  const match = String(timeSlotLabel || '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (!match) return null
  return {
    startHour: Number(match[1]),
    startMinute: Number(match[2]),
    endHour: Number(match[3]),
    endMinute: Number(match[4]),
  }
}

const toCalendarStamp = (dateValue, timeSlotLabel, edge) => {
  if (!dateValue) return ''
  const [year, month, day] = String(dateValue).split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return ''

  const slot = parseTimeSlot(timeSlotLabel)
  const hour = edge === 'end' ? slot?.endHour ?? 23 : slot?.startHour ?? 8
  const minute = edge === 'end' ? slot?.endMinute ?? 59 : slot?.startMinute ?? 0
  const date = new Date(year, month - 1, day, hour, minute, 0)
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

const escapeCalendarText = (value) =>
  String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
    .replaceAll('\n', '\\n')

const getMapsUrl = (booking) => {
  const query = [booking.attractionTitle, booking.attractionLocation].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

function ETicketPage() {
  const { bookingId } = useParams()
  const socket = useSocket()
  const [booking, setBooking] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true

    bookingService
      .getBookingDetails(bookingId)
      .then((data) => {
        if (active) setBooking(data)
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [bookingId])

  useEffect(() => {
    function handleBookingStatusUpdated(payload) {
      if (String(payload.bookingId ?? '') !== String(bookingId ?? '')) return

      const status = String(payload.status || '').toLowerCase()
      const shortCode = formatBookingReference(bookingId)

      let message = payload.message
      if (!message) {
        if (status === 'confirmed' || status === 'completed') {
          message = `Đặt vé ${shortCode} của bạn đã được phê duyệt thành công!`
        } else if (status === 'pending_partner') {
          message = `Đơn hàng ${shortCode} đã thanh toán thành công và đang chờ đối tác phê duyệt.`
        } else {
          message = `Rất tiếc, yêu cầu đặt vé ${shortCode} đã bị từ chối.`
        }
      }

      if (status === 'confirmed' || status === 'completed') toast.success(message)
      else if (status === 'pending_partner') toast.info(message)
      else toast.error(message)

      setBooking((current) => (current ? { ...current, status } : current))

      void bookingService
        .getBookingDetails(bookingId)
        .then((data) => {
          setBooking(data)
          setErrorMessage('')
        })
        .catch(() => {
          // Keep the event status visible; a manual reload still uses the REST fallback.
        })
    }

    socket.on('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    return () => {
      socket.off('BOOKING_STATUS_UPDATED', handleBookingStatusUpdated)
    }
  }, [bookingId, socket])

  if (isLoading) {
    return (
      <>
        <div className="print:hidden"><Header activeLink="My Tickets" /></div>
        <main className="flex min-h-[65vh] items-center justify-center bg-surface px-5 py-16">
          <p className="font-semibold text-primary">Đang tải vé điện tử...</p>
        </main>
        <div className="print:hidden"><Footer /></div>
      </>
    )
  }

  if (!booking) {
    return (
      <>
        <div className="print:hidden"><Header activeLink="My Tickets" /></div>
        <main className="flex min-h-[65vh] items-center justify-center bg-surface px-5 py-16">
          <div className="max-w-lg text-center">
            <span className="material-symbols-outlined text-6xl text-primary" aria-hidden="true">
              confirmation_number
            </span>
            <h1 className="mt-4 text-3xl font-bold text-primary">Không tìm thấy vé</h1>
            <p className="mt-3 text-on-surface-variant">
              {errorMessage || 'Mã đặt chỗ không tồn tại hoặc bạn không có quyền truy cập.'}
            </p>
            <Link className="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-bold text-white" to="/my-tickets">
              Về vé của tôi
            </Link>
          </div>
        </main>
        <div className="print:hidden"><Footer /></div>
      </>
    )
  }

  const ticketInstances = Array.isArray(booking.ticketInstances) ? booking.ticketInstances : []
  const hasUsableQr = hasUsableTicketInstances(ticketInstances)
  const canShowQr =
    ['confirmed', 'completed'].includes(booking.status) &&
    hasUsableQr
  const primaryUsableTicket = ticketInstances.find(isTicketInstanceUsable)
  const qrUnavailableCopy = (() => {
    if (booking.status === 'pending_partner') {
      return {
        title: 'Vé đang chờ đối tác duyệt',
        description: 'Mã QR sẽ xuất hiện sau khi đơn đặt vé được xác nhận.',
        icon: 'hourglass_top',
      }
    }

    if (ticketInstances.length > 0 && !hasUsableQr) {
      const statuses = ticketInstances.map(getTicketInstanceStatus)
      if (statuses.every((status) => status === 'used')) {
        return {
          title: 'Vé đã được sử dụng',
          description: 'Mã QR đã được khóa sau khi check-in để tránh sử dụng lại.',
          icon: 'check_circle',
        }
      }
      if (statuses.every((status) => status === 'refunded')) {
        return {
          title: 'Vé đã hoàn tiền',
          description: 'Mã QR không còn hiệu lực sau khi yêu cầu hoàn tiền được xử lý.',
          icon: 'price_check',
        }
      }
      return {
        title: 'Vé không còn hiệu lực',
        description: 'Mã QR chỉ hiển thị cho các vé còn hiệu lực và chưa sử dụng.',
        icon: 'block',
      }
    }

    return {
      title: 'Mã QR chưa khả dụng',
      description: 'Mã QR sẽ xuất hiện sau khi đơn đặt vé được xác nhận.',
      icon: 'hourglass_top',
    }
  })()
  const ticketInstructions = canShowQr
    ? [
        { icon: 'qr_code_scanner', text: 'Xuất trình mã QR tại cổng soát vé.' },
        { icon: 'schedule', text: 'Có mặt trước khung giờ ít nhất 15 phút.' },
        { icon: 'badge', text: 'Mang theo giấy tờ tùy thân khi được yêu cầu.' },
        { icon: 'signal_wifi_off', text: 'Bạn có thể lưu hoặc in vé để dùng ngoại tuyến.' },
      ]
    : [
        { icon: qrUnavailableCopy.icon, text: qrUnavailableCopy.description },
        { icon: 'confirmation_number', text: 'Theo dõi trạng thái đơn trong mục Vé của tôi.' },
        { icon: 'support_agent', text: 'Liên hệ hỗ trợ nếu bạn đã thanh toán nhưng vé chưa được cập nhật.' },
        { icon: 'shield', text: 'Không chia sẻ thông tin đơn đặt chỗ công khai.' },
      ]
  const quantityText = `${booking.quantity || 1} vé`
  const mapsUrl = getMapsUrl(booking)

  const handleAddToCalendar = () => {
    const start = toCalendarStamp(booking.visitDate, booking.timeSlotLabel, 'start')
    const end = toCalendarStamp(booking.visitDate, booking.timeSlotLabel, 'end')
    if (!start || !end) {
      toast.info('Chưa đủ thông tin ngày giờ để thêm vào lịch.')
      return
    }

    const title = `VietTicket - ${booking.attractionTitle}`
    const description = [
      `Mã đặt chỗ: ${formatBookingReference(booking.id)}`,
      `Vé: ${booking.ticketName || 'Vé tham quan'}`,
      `Số lượng: ${quantityText}`,
      'Có mặt trước giờ tham quan ít nhất 15 phút.',
    ].join('\\n')
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VietTicket Travel//ETicket//VI',
      'BEGIN:VEVENT',
      `UID:${booking.id}@vietticket.travel`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeCalendarText(title)}`,
      `LOCATION:${escapeCalendarText(booking.attractionLocation)}`,
      `DESCRIPTION:${escapeCalendarText(description)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vietticket-${formatBookingReference(booking.id).toLowerCase()}.ics`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    toast.success('Đã tạo file lịch cho chuyến đi.')
  }

  const handleCopyBookingCode = async () => {
    try {
      await navigator.clipboard.writeText(booking.id)
      toast.success('Đã sao chép mã đặt chỗ.')
    } catch {
      toast.error('Không thể sao chép tự động. Vui lòng sao chép mã trên vé.')
    }
  }

  return (
    <>
      <div className="print:hidden"><Header activeLink="My Tickets" /></div>
      <main className="min-h-screen bg-surface px-5 py-10 md:px-12">
        <div className="mx-auto max-w-5xl">
          <div className="print:hidden mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-secondary">
                Vé điện tử
              </p>
              <h1 className="mt-1 text-3xl font-bold text-primary md:text-4xl">
                Sẵn sàng cho chuyến đi
              </h1>
            </div>
            <div className="flex gap-3">
              <Link
                className="rounded-xl border border-primary px-5 py-3 font-bold text-primary"
                to="/my-tickets"
              >
                Vé của tôi
              </Link>
              <button
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-white shadow-md"
                onClick={() => window.print()}
                type="button"
              >
                <span className="material-symbols-outlined" aria-hidden="true">download</span>
                {canShowQr ? 'In / Lưu PDF' : 'In thông tin vé'}
              </button>
            </div>
          </div>

          {!canShowQr && ticketInstances.length > 0 && !hasUsableQr && (
            <div className="print:hidden mb-6 rounded-2xl border border-tertiary-fixed-dim bg-tertiary-fixed/30 p-5 text-on-tertiary-fixed-variant">
              <p className="font-bold">{qrUnavailableCopy.title}</p>
              <p className="mt-1 text-sm">{qrUnavailableCopy.description}</p>
            </div>
          )}

          {!canShowQr && !(ticketInstances.length > 0 && !hasUsableQr) && (
            <div className="print:hidden mb-6 rounded-2xl border border-tertiary-fixed-dim bg-tertiary-fixed/30 p-5 text-on-tertiary-fixed-variant">
              <p className="font-bold">
                {booking.status === 'pending_partner'
                  ? 'Vé đang chờ đối tác duyệt'
                  : 'Mã QR chưa khả dụng'}
              </p>
              <p className="mt-1 text-sm">
                Mã QR sẽ xuất hiện sau khi đơn đặt vé được xác nhận.
              </p>
            </div>
          )}

          <article className="ticket-print-area mx-auto max-w-4xl overflow-hidden rounded-[28px] bg-white shadow-[0_20px_60px_rgba(0,71,77,0.16)]">
            <section
              className="relative min-h-[360px] overflow-hidden bg-primary p-8 text-white md:p-12"
              style={{
                backgroundImage: `linear-gradient(105deg, rgba(0,71,77,.97) 15%, rgba(0,71,77,.72) 60%, rgba(0,71,77,.28)), url("${booking.attractionImage || fallbackImage}")`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
              }}
            >
              <div className="relative z-10 flex min-h-[280px] flex-col justify-between">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">
                      VietTicket Travel
                    </p>
                    <h2 className="mt-3 max-w-2xl text-3xl font-bold text-white md:text-5xl">
                      {booking.attractionTitle}
                    </h2>
                    <p className="mt-3 flex items-center gap-2 text-white/85">
                      <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
                      {booking.attractionLocation}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold backdrop-blur-md">
                    {booking.ticketName}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
                  <TicketInfo label="Khách hàng" value={booking.customer?.fullName || 'Khách hàng'} />
                  <TicketInfo label="Ngày đi" value={formatDate(booking.visitDate)} />
                  <TicketInfo label="Khung giờ" value={booking.timeSlotLabel} />
                  <TicketInfo label="Số lượng" value={quantityText} />
                </div>
              </div>
            </section>

            <div className="ticket-divider relative border-t-2 border-dashed border-outline-variant" />

            <section
              className={`p-8 md:p-12 ${
                canShowQr && ticketInstances.length > 1
                  ? ''
                  : ' grid items-center gap-8 md:grid-cols-[1fr_auto]'
              }`}
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant">
                  Mã đặt chỗ
                </p>
                <p
                  className="mt-2 font-mono text-3xl font-bold tracking-widest text-primary"
                  title={booking.id}
                >
                  {formatBookingReference(booking.id)}
                </p>
                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  {ticketInstructions.map((instruction) => (
                    <Instruction
                      icon={instruction.icon}
                      key={`${instruction.icon}-${instruction.text}`}
                      text={instruction.text}
                    />
                  ))}
                </div>
              </div>

              {/* 1 vé hoặc chưa xác nhận → giữ layout cũ (QR bên phải) */}
              {(!canShowQr || ticketInstances.length === 1) && (
                <div className="justify-self-center rounded-2xl border border-outline-variant/40 bg-white p-5 shadow-inner">
                  {canShowQr && primaryUsableTicket ? (
                    <QRCodeSVG
                      bgColor="#ffffff"
                      fgColor="#000000"
                      level="H"
                      marginSize={1}
                      size={210}
                      title={`Vé ${formatBookingReference(booking.id)}`}
                      value={`VIETTICKET:${primaryUsableTicket.qrCodeToken}`}
                    />
                  ) : (
                    <div className="flex h-[210px] w-[210px] flex-col items-center justify-center bg-surface-container-low text-center text-on-surface-variant">
                      <span className="material-symbols-outlined text-5xl" aria-hidden="true">
                        {qrUnavailableCopy.icon}
                      </span>
                      <span className="mt-3 text-sm font-bold">{qrUnavailableCopy.title}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Nhiều vé → hiển thị tất cả QR theo grid */}
              {canShowQr && ticketInstances.length > 1 && (
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {ticketInstances.map((ticket, index) => (
                    <QRTicketCard key={ticket.id} index={index} ticket={ticket} />
                  ))}
                </div>
              )}
            </section>
          </article>

          <section className="print:hidden mx-auto mt-6 max-w-4xl rounded-2xl border border-outline-variant/30 bg-white p-5 shadow-[0_8px_30px_rgba(0,71,77,0.08)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-normal text-secondary">
                  Tiện ích chuyến đi
                </p>
                <h2 className="mt-1 text-xl font-bold text-primary">
                  Chuẩn bị nhanh trước khi check-in
                </h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:justify-end">
                <a
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/5"
                  href={mapsUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    map
                  </span>
                  Mở bản đồ
                </a>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/5"
                  onClick={handleAddToCalendar}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    event
                  </span>
                  Thêm vào lịch
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface-variant transition hover:bg-surface-container"
                  onClick={handleCopyBookingCode}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    content_copy
                  </span>
                  Sao chép mã
                </button>
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                  to={`/support?bookingId=${booking.id}`}
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    support_agent
                  </span>
                  Cần hỗ trợ
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
      <div className="print:hidden"><Footer /></div>
    </>
  )
}

function QRTicketCard({ index, ticket }) {
  const isUsed = ticket.status === 'used'
  const isExpired = ticket.status === 'expired' || ticket.status === 'refunded'
  const statusLabel = isUsed
    ? 'Đã sử dụng'
    : isExpired
      ? 'Đã hết hạn'
      : 'Chưa sử dụng'
  const statusColor = isUsed
    ? 'text-on-surface-variant bg-surface-container'
    : isExpired
      ? 'text-error bg-error/10'
      : 'text-primary bg-primary/10'
  const isUsable = isTicketInstanceUsable(ticket)
  const statusMeta = getTicketInstanceStatusMeta(ticket)
  const displayStatusLabel = statusMeta.label || statusLabel
  const displayStatusColor = statusMeta.className || statusColor

  return (
    <div
      className={`flex flex-col items-center rounded-2xl border p-5 text-center transition ${
        !isUsable
          ? 'border-outline-variant/30 bg-surface-container/40 opacity-70'
          : 'border-outline-variant/40 bg-white shadow-sm'
      }`}
    >
      <p className="mb-3 text-sm font-bold text-on-surface-variant">Vé #{index + 1}</p>
      <div className={!isUsable ? 'opacity-80 grayscale' : ''}>
        {isUsable ? (
        <QRCodeSVG
          bgColor="#ffffff"
          fgColor="#000000"
          level="H"
          marginSize={1}
          size={160}
          title={`Vé số ${index + 1}`}
          value={`VIETTICKET:${ticket.qrCodeToken}`}
        />
        ) : (
          <div className="flex h-[160px] w-[160px] flex-col items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl" aria-hidden="true">
              {statusMeta.icon}
            </span>
            <span className="mt-2 text-xs font-bold">{statusMeta.label}</span>
          </div>
        )}
      </div>
      <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold ${displayStatusColor}`}>
        {displayStatusLabel}
      </span>
    </div>
  )
}

function TicketInfo({ label, value }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-white/65">{label}</p>
      <p className="mt-1 font-bold text-white">{value}</p>
    </div>
  )
}

function Instruction({ icon, text }) {
  return (
    <div className="flex gap-3 text-sm text-on-surface-variant">
      <span className="material-symbols-outlined text-primary" aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

export default ETicketPage
