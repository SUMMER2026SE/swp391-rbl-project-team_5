import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import bookingService from '../services/bookingService.js'
import { checkAvailability, reserveTickets } from '../services/attractionApi.js'
import { useAuth } from '../context/useAuth.js'
import { AI_BOOKING_SOURCE, isDateInputValue } from '../utils/aiBookingPrefill.js'
import { markItineraryQueueItemReserved } from '../utils/aiItineraryBookingQueue.js'
import { normalizeInitialQuantity } from '../utils/bookingQuantity.js'
import { getTicketEligibilityLabel } from '../utils/ticketType.js'

const formatCurrency = (value) => {
  const amount = Number(value)

  if (!Number.isFinite(amount)) {
    return '0 VND'
  }

  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

const toDateInputValue = (date) => {
  const timezoneOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - timezoneOffset).toISOString().split('T')[0]
}

const parseDateInputValue = (value) => {
  if (!isDateInputValue(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  return new Date(year, month - 1, day)
}

const isDateInputOnOrAfter = (value, minValue) => {
  const date = parseDateInputValue(value)
  const minDate = parseDateInputValue(minValue)
  return Boolean(date && minDate && date >= minDate)
}

const getSlotId = (slot) => String(slot.timeSlotId ?? slot.id ?? '')

const getCalendarDate = (dateValue) => {
  if (!isDateInputValue(dateValue)) {
    return new Date()
  }

  const [year, month] = dateValue.split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return new Date()
  }

  return new Date(year, month - 1, 1)
}

const getSlotLabel = (slot) => {
  if (slot.label) {
    return slot.label
  }

  if (slot.startTime && slot.endTime) {
    return `${slot.startTime} - ${slot.endTime}`
  }

  return 'Khung giờ tham quan'
}

const isSlotUnavailable = (slot) =>
  slot.availableTickets === 0 ||
  slot.available === false ||
  ['UNAVAILABLE', 'SOLD_OUT', 'DISABLED'].includes(slot.status)

const clampQuantityToLimit = (quantity, availableTickets) => {
  const limit = typeof availableTickets === 'number' ? availableTickets : null
  if (limit === null) return quantity
  return Math.max(1, Math.min(quantity, limit))
}

const TICKET_TYPE_META = {
  ADULT: { label: 'Vé người lớn' },
  CHILD: { label: 'Vé trẻ em' },
  STUDENT: { label: 'Vé học sinh / sinh viên' },
  FAMILY: { label: 'Vé gia đình' },
  GROUP: { label: 'Vé nhóm' },
}

export default function BookingModal({
  isOpen,
  onClose,
  requiresManualApproval = false,
  ticketProduct,
  initialDate = '',
  attractionId,
  aiQueueId = '',
  aiQueueItemId = '',
  initialQuantity = 1,
  initialTimeSlotId = '',
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isAuthLoading } = useAuth()
  const [todayStr] = useState(() => toDateInputValue(new Date()))
  const [todayDate] = useState(() => {
    const date = parseDateInputValue(todayStr) || new Date()
    date.setHours(0, 0, 0, 0)
    return date
  })
  const normalizedInitialDate =
    isDateInputOnOrAfter(initialDate, todayStr) ? initialDate : todayStr
  const normalizedInitialQuantity = normalizeInitialQuantity(initialQuantity)
  const [selectedDate, setSelectedDate] = useState(normalizedInitialDate)
  const [selectedTimeSlotId, setSelectedTimeSlotId] = useState('')
  const [timeSlots, setTimeSlots] = useState([])
  const [quantity, setQuantity] = useState(() => normalizedInitialQuantity)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [actionError, setActionError] = useState('')

  const [currentMonth, setCurrentMonth] = useState(() => getCalendarDate(normalizedInitialDate).getMonth())
  const [currentYear, setCurrentYear] = useState(() => getCalendarDate(normalizedInitialDate).getFullYear())

  const MONTH_NAMES_VI = [
    'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
    'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
    'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'
  ]

  const unitPrice = Number(ticketProduct?.sellingPrice || ticketProduct?.price || 0)
  const totalPrice = quantity * unitPrice
  const ticketTypeMeta =
    TICKET_TYPE_META[String(ticketProduct?.type || 'ADULT').toUpperCase()]
    || TICKET_TYPE_META.ADULT
  const ticketId = ticketProduct?.id

  // Số vé còn lại của khung giờ đang chọn — dùng để chặn chọn quá số lượng.
  const selectedSlot = timeSlots.find((slot) => getSlotId(slot) === selectedTimeSlotId)
  const maxQuantity =
    typeof selectedSlot?.availableTickets === 'number' ? selectedSlot.availableTickets : null
  const checkoutDisabled =
    isSubmitting || isAuthLoading || isLoadingSlots || !ticketId || !selectedTimeSlotId
  const checkoutButtonText = (() => {
    if (isSubmitting) return 'Đang giữ vé...'
    if (isAuthLoading) return 'Đang kiểm tra đăng nhập...'
    if (isLoadingSlots) return 'Đang kiểm tra vé...'
    if (!selectedTimeSlotId) return 'Chọn khung giờ để tiếp tục'
    return 'Tiếp tục thanh toán'
  })()

  // Chính sách hoàn tiền của loại vé (hiển thị TRƯỚC khi khách thanh toán).
  const refundPolicyText = (() => {
    const policy = ticketProduct?.refundPolicy
    if (policy === 'FREE_CANCELLATION') return 'Hoàn tiền 100% nếu hủy trước ngày tham quan.'
    if (policy === 'REFUND_WITH_FEE') {
      const rate = Number(ticketProduct?.refundFeeRate || 0)
      if (rate > 0) {
        return `Hoàn tiền trước ngày tham quan, phí hủy ${Math.round(rate * 100)}%.`
      }
      return 'Có hỗ trợ hoàn tiền một phần theo chính sách của đối tác.'
    }
    if (policy === 'NON_REFUNDABLE') return 'Vé không hỗ trợ hoàn / hủy sau khi thanh toán.'
    return null
  })()

  const confirmationPolicyText = requiresManualApproval
    ? 'Sau khi thanh toán, đơn sẽ chờ đối tác xác nhận trước khi phát hành vé QR.'
    : 'Vé QR được phát hành tự động sau khi thanh toán thành công.'

  const renderCalendarCells = () => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay()
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

    const cells = []
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`filler-${i}`} className="h-10 opacity-0 pointer-events-none" />)
    }

    const todayTime = todayDate.getTime()

    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(currentYear, currentMonth, d)
      cellDate.setHours(0, 0, 0, 0)
      const cellTime = cellDate.getTime()
      const isPast = cellTime < todayTime
      const isToday = cellTime === todayTime

      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const isSelected = selectedDate === dateStr

      cells.push(
        <button
          key={`day-${d}`}
          onClick={() => setSelectedDate(dateStr)}
          disabled={isPast}
          type="button"
          className={`h-10 flex items-center justify-center rounded-xl text-sm font-semibold transition active:scale-90 ${
            isPast
              ? 'opacity-30 cursor-not-allowed text-gray-400'
              : isSelected
                ? 'bg-[#006068] text-white shadow-md shadow-[#006068]/20 font-bold'
                : isToday
                  ? 'border-2 border-[#006068] text-[#006068] font-bold'
                  : 'text-[#1a1c1e] hover:bg-gray-100'
          }`}
        >
          {d}
        </button>
      )
    }
    return cells
  }

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(y => y - 1)
    } else {
      setCurrentMonth(m => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(y => y + 1)
    } else {
      setCurrentMonth(m => m + 1)
    }
  }

  const isPrevMonthDisabled = () => {
    return currentYear < todayDate.getFullYear() ||
      (currentYear === todayDate.getFullYear() && currentMonth <= todayDate.getMonth())
  }

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || !ticketId) {
      return
    }

    // Huỷ request cũ khi người dùng đổi ngày liên tục -> tránh race condition
    // khiến response cũ (đến muộn) ghi đè khung giờ của ngày mới.
    const controller = new AbortController()

    const fetchAvailability = async () => {
      setIsLoadingSlots(true)
      setFetchError('')
      setActionError('')

      try {
        const result = await checkAvailability(ticketId, selectedDate, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const slots = Array.isArray(result.data) ? result.data : []
        setTimeSlots(slots)
        setFetchError('')

        const preferredSlot = initialTimeSlotId
          ? slots.find(
              (slot) =>
                getSlotId(slot) === String(initialTimeSlotId) &&
                !isSlotUnavailable(slot),
            )
          : null
        const availableSlot = preferredSlot || slots.find((slot) => !isSlotUnavailable(slot))
        setSelectedTimeSlotId(availableSlot ? getSlotId(availableSlot) : '')
        if (availableSlot) {
          setQuantity((current) =>
            clampQuantityToLimit(current, availableSlot.availableTickets))
        }
      } catch (error) {
        // Bỏ qua lỗi do chính mình huỷ request (đổi ngày/đóng modal).
        if (controller.signal.aborted || error.name === 'AbortError') return
        console.error('Lỗi lấy thông tin khung giờ trống:', error)
        setTimeSlots([])
        setSelectedTimeSlotId('')
        setFetchError(error.message)
      } finally {
        if (!controller.signal.aborted) setIsLoadingSlots(false)
      }
    }

    fetchAvailability()

    return () => {
      controller.abort()
    }
  }, [initialTimeSlotId, isOpen, selectedDate, ticketId])

  const handleSelectSlot = (slot) => {
    setSelectedTimeSlotId(getSlotId(slot))
    setActionError('')
    setQuantity((current) => clampQuantityToLimit(current, slot?.availableTickets))
  }

  const handleQtyChange = (delta) => {
    setQuantity((current) => {
      const next = Math.max(1, current + delta)
      if (delta > 0 && maxQuantity !== null && next > maxQuantity) {
        setActionError(`Khung giờ này chỉ còn ${maxQuantity} vé.`)
        return current
      }

      setActionError('')
      return next
    })
  }

  const handleCheckout = async () => {
    setActionError('')

    if (isAuthLoading) {
      return
    }

    if (!isAuthenticated) {
      const redirectParams = new URLSearchParams(location.search)
      redirectParams.set('bookNow', '1')
      redirectParams.set('ticketId', ticketId || '')
      redirectParams.set('qty', String(quantity))
      redirectParams.set('date', selectedDate)
      if (selectedTimeSlotId) {
        redirectParams.set('timeSlotId', selectedTimeSlotId)
      }
      if (aiQueueId && aiQueueItemId) {
        redirectParams.set('source', AI_BOOKING_SOURCE)
        redirectParams.set('aiQueueId', aiQueueId)
        redirectParams.set('aiQueueItemId', aiQueueItemId)
      }

      onClose()
      navigate('/login', {
        state: {
          from: {
            pathname: location.pathname,
            search: `?${redirectParams.toString()}`,
          },
        },
      })
      return
    }

    if (isLoadingSlots) {
      return
    }

    if (!ticketId) {
      setActionError('Không tìm thấy loại vé cần đặt. Vui lòng thử lại.')
      return
    }

    if (!selectedTimeSlotId) {
      setActionError('Vui lòng chọn khung giờ tham quan trước khi tiếp tục.')
      return
    }

    if (maxQuantity !== null && quantity > maxQuantity) {
      setActionError(`Khung giờ này chỉ còn ${maxQuantity} vé. Vui lòng giảm số lượng.`)
      return
    }

    setIsSubmitting(true)
    setActionError('')

    try {
      const result = await reserveTickets(ticketId, {
        attractionId,
        date: selectedDate,
        timeSlotId: selectedSlot?.timeSlotId || null,
        quantity,
      })
      const reservationId = result.data?.reservationId || result.data?.id
      bookingService.reserveTicket(reservationId)
      if (aiQueueId && aiQueueItemId) {
        markItineraryQueueItemReserved({
          itemId: aiQueueItemId,
          queueId: aiQueueId,
          reservationId,
        })
      }
      const checkoutParams = new URLSearchParams()
      if (aiQueueId && aiQueueItemId) {
        checkoutParams.set('aiQueueId', aiQueueId)
        checkoutParams.set('aiQueueItemId', aiQueueItemId)
      }
      onClose()
      navigate(
        `/checkout/${reservationId}${
          checkoutParams.toString() ? `?${checkoutParams.toString()}` : ''
        }`,
      )
    } catch (error) {
      console.error('Lỗi khi giữ vé:', error)
      if (error.status === 401 || error.status === 403) {
        onClose()
        navigate('/login', { state: { from: location } })
        return
      }
      setActionError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOverlayMouseDown = (event) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <React.Fragment>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center overflow-y-auto bg-[#1a1c1e]/55 p-4 backdrop-blur-sm"
        onMouseDown={handleOverlayMouseDown}
        role="presentation"
      >
        <section
          aria-labelledby="booking-modal-title"
          aria-modal="true"
          className="my-6 flex max-h-[calc(100dvh-2rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-[32px] border border-white/30 bg-white/90 shadow-[0_24px_70px_rgba(0,96,104,0.22)] backdrop-blur-xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-[#bdc9ca]/40 px-8 py-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-normal text-[#006068]">
                {ticketProduct?.name || 'Vé tham quan'}
              </p>
              <h1 id="booking-modal-title" className="mt-1 text-2xl font-bold text-[#1a1c1e]">Đặt vé tham quan</h1>
            </div>
            <button
              aria-label="Đóng modal đặt vé"
              className="flex h-10 w-10 items-center justify-center rounded-full text-[#3e494a] transition hover:bg-[#e2e2e5] active:scale-90"
              onClick={onClose}
              type="button"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <section className="mb-8">
              <div className="mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#006068]" aria-hidden="true">
                  calendar_today
                </span>
                <h2 className="text-sm font-bold uppercase tracking-normal text-[#1a1c1e]">
                  Chọn ngày tham quan
                </h2>
              </div>
              
              {/* Full Month Calendar Picker */}
              <div className="rounded-2xl bg-[#f8fafb] border border-[#bdc9ca]/40 p-4 shadow-sm">
                
                {/* Month navigation header */}
                <div className="flex items-center justify-between mb-4 border-b border-[#bdc9ca]/20 pb-3">
                  <button
                    onClick={handlePrevMonth}
                    disabled={isPrevMonthDisabled()}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#e2e2e5] transition disabled:opacity-30 disabled:cursor-not-allowed"
                    type="button"
                    aria-label="Tháng trước"
                  >
                    <span className="material-symbols-outlined text-[#3e494a]" style={{ fontSize: '20px' }}>chevron_left</span>
                  </button>

                  <span className="font-bold text-sm text-[#1a1c1e] select-none uppercase tracking-wide">
                    {MONTH_NAMES_VI[currentMonth]}, {currentYear}
                  </span>

                  <button
                    onClick={handleNextMonth}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#e2e2e5] transition"
                    type="button"
                    aria-label="Tháng sau"
                  >
                    <span className="material-symbols-outlined text-[#3e494a]" style={{ fontSize: '20px' }}>chevron_right</span>
                  </button>
                </div>

                {/* Day-of-week labels */}
                <div className="grid grid-cols-7 mb-2 text-center text-xs font-bold text-[#6e797a]">
                  <div>CN</div>
                  <div>T2</div>
                  <div>T3</div>
                  <div>T4</div>
                  <div>T5</div>
                  <div>T6</div>
                  <div>T7</div>
                </div>

                {/* Days grid */}
                <div className="grid grid-cols-7 gap-1 text-center justify-items-center">
                  {renderCalendarCells()}
                </div>
              </div>
            </section>

            <section className="mb-8">
              <div className="mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#006068]" aria-hidden="true">
                  schedule
                </span>
                <h2 className="text-sm font-bold uppercase tracking-normal text-[#1a1c1e]">
                  Chọn khung giờ
                </h2>
              </div>

              {isLoadingSlots ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 max-h-48 overflow-y-auto pr-1">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div className="h-20 animate-pulse rounded-2xl bg-[#e2e2e5]" key={index} />
                  ))}
                </div>
              ) : timeSlots.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 max-h-48 overflow-y-auto pr-1">
                  {timeSlots.map((slot) => {
                    const slotId = getSlotId(slot)
                    const disabled = isSlotUnavailable(slot)
                    const isSelected = selectedTimeSlotId === slotId

                    return (
                      <button
                        className={`flex flex-col rounded-2xl border p-4 text-left transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-55 ${
                          isSelected
                            ? 'border-2 border-[#006068] bg-[#006068]/5 text-[#006068]'
                            : 'border-[#bdc9ca] bg-white text-[#1a1c1e] hover:border-[#006068]/60'
                        }`}
                        disabled={disabled}
                        key={slotId}
                        onClick={() => handleSelectSlot(slot)}
                        type="button"
                      >
                        <span className="text-sm font-bold">{getSlotLabel(slot)}</span>
                        <span className={`text-xs font-semibold ${disabled ? 'text-[#ba1a1a]' : 'text-[#3e494a]'}`}>
                          {disabled
                            ? 'Hết vé'
                            : typeof slot.availableTickets === 'number'
                              ? `Còn ${slot.availableTickets} vé`
                              : 'Sẵn sàng'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#bdc9ca] bg-[#f3f3f6] p-5 text-sm font-semibold text-[#3e494a]">
                  {fetchError || 'Chưa có khung giờ khả dụng cho ngày này.'}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#006068]" aria-hidden="true">
                  confirmation_number
                </span>
                <h2 className="text-sm font-bold uppercase tracking-normal text-[#1a1c1e]">
                  Số lượng vé
                </h2>
              </div>

              <TicketCountRow
                ageLabel={getTicketEligibilityLabel(ticketProduct)}
                count={quantity}
                disableIncrement={maxQuantity !== null && quantity >= maxQuantity}
                label={ticketTypeMeta.label}
                minValue={1}
                onChange={handleQtyChange}
                price={unitPrice}
              />
              {maxQuantity !== null && (
                <p className="text-xs font-semibold text-[#6e797a]">
                  Khung giờ đang chọn còn {maxQuantity} vé.
                </p>
              )}
            </section>
          </div>

          <footer className="shrink-0 border-t border-[#bdc9ca]/40 bg-white/70 p-8">
            {/* Bảng giá chi tiết để khách biết mình trả tiền cho gì */}
            <div className="mb-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-[#3e494a]">
                <span>{ticketTypeMeta.label} × {quantity}</span>
                <span className="font-semibold">{formatCurrency(totalPrice)}</span>
              </div>
            </div>

            <div className="mb-4 flex items-end justify-between gap-4 border-t border-dashed border-[#bdc9ca]/60 pt-4">
              <div>
                <span className="text-sm font-semibold text-[#3e494a]">Tổng cộng</span>
                <div className="text-3xl font-bold text-[#006068]">{formatCurrency(totalPrice)}</div>
              </div>
              <span className="text-right text-xs font-semibold text-[#6e797a]">
                Đã bao gồm VAT & phí dịch vụ
              </span>
            </div>

            {refundPolicyText && (
              <div className="mb-4 flex items-start gap-2 rounded-2xl bg-[#f3f3f6] px-4 py-3 text-xs font-semibold text-[#3e494a]">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-[#006068]" aria-hidden="true">
                  policy
                </span>
                {refundPolicyText}
              </div>
            )}

            <div className="mb-4 flex items-start gap-2 rounded-2xl bg-[#e0f4f5] px-4 py-3 text-xs font-semibold text-[#00474d]">
              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px]" aria-hidden="true">
                verified
              </span>
              {confirmationPolicyText}
            </div>

            {actionError && (
              <div className="mb-4 flex items-start gap-2 rounded-2xl border border-[#ba1a1a]/20 bg-[#ffedea] px-4 py-3 text-sm font-semibold text-[#ba1a1a]">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px]" aria-hidden="true">error</span>
                {actionError}
              </div>
            )}

            <button
              className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#006068] to-[#007b85] text-lg font-bold text-white shadow-lg shadow-[#006068]/20 transition hover:scale-[1.01] hover:shadow-[#006068]/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={checkoutDisabled}
              onClick={handleCheckout}
              type="button"
            >
              {isSubmitting ? (
                <span className="material-symbols-outlined animate-spin text-[22px]" aria-hidden="true">
                  progress_activity
                </span>
              ) : null}
              {checkoutButtonText}
              {!isSubmitting && (
                <span className="material-symbols-outlined transition-transform group-hover:translate-x-1" aria-hidden="true">
                  arrow_forward
                </span>
              )}
            </button>
          </footer>
        </section>
      </div>
    </React.Fragment>
  )
}

function TicketCountRow({ ageLabel, count, disableIncrement = false, label, minValue, onChange, price }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-[#f3f3f6] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-bold text-[#1a1c1e]">{label}</h3>
        <p className="text-xs font-semibold text-[#3e494a]">{ageLabel}</p>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <p className="text-sm font-bold text-[#006068]">{formatCurrency(price)}</p>
        <div className="flex items-center rounded-full border border-[#bdc9ca]/40 bg-[#e2e2e5] p-1">
          <button
            aria-label={`Giảm ${label}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm transition hover:text-[#006068] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={count <= minValue}
            onClick={() => onChange(-1)}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              remove
            </span>
          </button>
          <span className="w-10 text-center text-lg font-bold">{count}</span>
          <button
            aria-label={`Tăng ${label}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm transition hover:text-[#006068] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={disableIncrement}
            onClick={() => onChange(1)}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              add
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
