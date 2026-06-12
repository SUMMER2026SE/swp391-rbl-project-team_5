import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import bookingService from '../services/bookingService.js'
import { apiRequest } from '../services/api.js'

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

const getSlotId = (slot) => slot.timeSlotId || slot.id

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
  ADULT: { label: 'Vé người lớn', ageLabel: 'Áp dụng theo điều kiện của gói vé' },
  CHILD: { label: 'Vé trẻ em', ageLabel: 'Vui lòng kiểm tra giới hạn độ tuổi trong mô tả' },
  FAMILY: { label: 'Vé gia đình', ageLabel: 'Một vé tương ứng với một gói gia đình' },
  GROUP: { label: 'Vé nhóm', ageLabel: 'Một vé tương ứng với một gói nhóm' },
}

export default function BookingModal({
  isOpen,
  onClose,
  ticketProduct,
  attractionId,
}) {
  const navigate = useNavigate()
  const todayStr = toDateInputValue(new Date())
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [selectedTimeSlotId, setSelectedTimeSlotId] = useState('')
  const [timeSlots, setTimeSlots] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear())

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

  // Chính sách hoàn tiền của loại vé (hiển thị TRƯỚC khi khách thanh toán).
  const refundPolicyText = (() => {
    const policy = ticketProduct?.refundPolicy
    if (policy === 'FREE_CANCELLATION') return 'Hoàn tiền 100% nếu hủy trước ngày tham quan.'
    if (policy === 'REFUND_WITH_FEE') {
      const rate = Number(ticketProduct?.refundFeeRate || 0)
      return `Hoàn tiền trước ngày tham quan, phí hủy ${Math.round(rate * 100)}%.`
    }
    if (policy === 'NON_REFUNDABLE') return 'Vé không hỗ trợ hoàn / hủy sau khi thanh toán.'
    return null
  })()

  const renderCalendarCells = () => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay()
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

    const cells = []
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`filler-${i}`} className="h-10 opacity-0 pointer-events-none" />)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(currentYear, currentMonth, d)
      cellDate.setHours(0, 0, 0, 0)
      const isPast = cellDate < today
      const isToday = cellDate.getTime() === today.getTime()

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
    const realToday = new Date()
    return currentYear < realToday.getFullYear() ||
      (currentYear === realToday.getFullYear() && currentMonth <= realToday.getMonth())
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

    const fetchAvailability = async () => {
      setIsLoadingSlots(true)
      setErrorMessage('')

      try {
        const result = await apiRequest(
          `/tickets/${ticketId}/availability?date=${selectedDate}`,
        )
        const slots = Array.isArray(result.data) ? result.data : []
        setTimeSlots(slots)

        const availableSlot = slots.find((slot) => !isSlotUnavailable(slot))
        setSelectedTimeSlotId(availableSlot ? getSlotId(availableSlot) : '')
        if (availableSlot) {
          setQuantity((current) =>
            clampQuantityToLimit(current, availableSlot.availableTickets))
        }
      } catch (error) {
        console.error('Lỗi lấy thông tin khung giờ trống:', error)
        setTimeSlots([])
        setSelectedTimeSlotId('')
        setErrorMessage(error.message)
      } finally {
        setIsLoadingSlots(false)
      }
    }

    fetchAvailability()
  }, [isOpen, selectedDate, ticketId])

  const handleSelectSlot = (slot) => {
    setSelectedTimeSlotId(getSlotId(slot))
    setErrorMessage('')
    setQuantity((current) => clampQuantityToLimit(current, slot?.availableTickets))
  }

  const handleQtyChange = (delta) => {
    setQuantity((current) => {
      const next = Math.max(1, current + delta)
      if (delta > 0 && maxQuantity !== null && next > maxQuantity) {
        setErrorMessage(`Khung giờ này chỉ còn ${maxQuantity} vé.`)
        return current
      }

      setErrorMessage('')
      return next
    })
  }

  const handleCheckout = async () => {
    setErrorMessage('')

    if (!ticketId) {
      setErrorMessage('Không tìm thấy loại vé cần đặt. Vui lòng thử lại.')
      return
    }

    if (!selectedTimeSlotId) {
      setErrorMessage('Vui lòng chọn khung giờ tham quan trước khi tiếp tục.')
      return
    }

    if (maxQuantity !== null && quantity > maxQuantity) {
      setErrorMessage(`Khung giờ này chỉ còn ${maxQuantity} vé. Vui lòng giảm số lượng.`)
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const result = await apiRequest(`/tickets/${ticketId}/reserve`, {
        method: 'POST',
        body: {
          attractionId,
          date: selectedDate,
          timeSlotId: selectedSlot?.timeSlotId || null,
          quantity,
        },
      })
      bookingService.reserveTicket(result.data?.reservationId || result.data?.id)
      onClose()
      navigate(`/checkout/${result.data?.reservationId || result.data?.id}`)
    } catch (error) {
      console.error('Lỗi khi giữ vé:', error)
      setErrorMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <React.Fragment>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center overflow-y-auto bg-[#1a1c1e]/55 p-4 backdrop-blur-sm"
        onMouseDown={onClose}
        role="presentation"
      >
        <section
          aria-modal="true"
          className="my-6 w-full max-w-[560px] overflow-hidden rounded-[32px] border border-white/30 bg-white/90 shadow-[0_24px_70px_rgba(0,96,104,0.22)] backdrop-blur-xl"
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
        >
          <header className="flex items-center justify-between border-b border-[#bdc9ca]/40 px-8 py-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-normal text-[#006068]">
                {ticketProduct?.name || 'Vé tham quan'}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-[#1a1c1e]">Đặt vé tham quan</h1>
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

          <div className="max-h-[70vh] overflow-y-auto px-8 py-6">
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div className="h-20 animate-pulse rounded-2xl bg-[#e2e2e5]" key={index} />
                  ))}
                </div>
              ) : timeSlots.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                  {errorMessage || 'Chưa có khung giờ khả dụng cho ngày này.'}
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
                ageLabel={ticketTypeMeta.ageLabel}
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

          <footer className="border-t border-[#bdc9ca]/40 bg-white/70 p-8">
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

            {errorMessage && (
              <div className="mb-4 flex items-start gap-2 rounded-2xl border border-[#ba1a1a]/20 bg-[#ffedea] px-4 py-3 text-sm font-semibold text-[#ba1a1a]">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px]" aria-hidden="true">error</span>
                {errorMessage}
              </div>
            )}

            <button
              className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#006068] to-[#007b85] text-lg font-bold text-white shadow-lg shadow-[#006068]/20 transition hover:scale-[1.01] hover:shadow-[#006068]/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isSubmitting || !ticketId}
              onClick={handleCheckout}
              type="button"
            >
              {isSubmitting ? 'Đang giữ vé...' : 'Tiếp tục thanh toán'}
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1" aria-hidden="true">
                arrow_forward
              </span>
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
