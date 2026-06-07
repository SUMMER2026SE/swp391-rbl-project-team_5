const BOOKING_STORAGE_KEY = 'vietticket_bookings'
const RESERVATION_DURATION_MS = 10 * 60 * 1000

const VOUCHERS = {
  GIAM20: {
    label: 'Giảm 20.000 VND',
    calculateDiscount: () => 20000,
  },
  VIETTICKET10: {
    label: 'Giảm 10%',
    calculateDiscount: (subtotal) => subtotal * 0.1,
  },
}

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getStorage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const readBookings = () => {
  const storage = getStorage()

  if (!storage) {
    return []
  }

  try {
    const parsed = JSON.parse(storage.getItem(BOOKING_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn('Không thể đọc dữ liệu đặt vé từ localStorage.', error)
    return []
  }
}

const writeBookings = (bookings) => {
  const storage = getStorage()

  if (!storage) {
    return
  }

  storage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(bookings))
  window.dispatchEvent(new CustomEvent('vietticket:bookings-updated'))
}

const createBookingId = () => {
  const randomPart =
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 6)
      : Math.random().toString(36).slice(2, 8)

  return `VT-${randomPart.toUpperCase()}`
}

const updateBooking = (bookingId, updater) => {
  const bookings = readBookings()
  const bookingIndex = bookings.findIndex((booking) => booking.id === bookingId)

  if (bookingIndex === -1) {
    return null
  }

  const updatedBooking = {
    ...updater(bookings[bookingIndex]),
    updatedAt: new Date().toISOString(),
  }

  bookings[bookingIndex] = updatedBooking
  writeBookings(bookings)
  return updatedBooking
}

export const reserveTicket = (payload = {}) => {
  const now = Date.now()
  const adultCount = Math.max(0, toSafeNumber(payload.adultCount))
  const childCount = Math.max(0, toSafeNumber(payload.childCount))
  const adultPrice = Math.max(0, toSafeNumber(payload.adultPrice))
  const childPrice = Math.max(0, toSafeNumber(payload.childPrice))
  const calculatedSubtotal = adultCount * adultPrice + childCount * childPrice
  const subtotal = Math.max(0, toSafeNumber(payload.subtotal, calculatedSubtotal))
  const bookingId = payload.bookingId || createBookingId()

  const booking = {
    id: bookingId,
    bookingId,
    attractionId: payload.attractionId || '',
    attractionTitle: payload.attractionTitle || 'Điểm tham quan',
    attractionLocation: payload.attractionLocation || 'Việt Nam',
    attractionImage: payload.attractionImage || '',
    ticketId: payload.ticketId || '',
    ticketName: payload.ticketName || 'Vé tham quan',
    visitDate: payload.visitDate || payload.date || '',
    timeSlotId: payload.timeSlotId || '',
    timeSlotLabel: payload.timeSlotLabel || 'Theo khung giờ đã chọn',
    adultCount,
    childCount,
    quantity: adultCount + childCount,
    adultPrice,
    childPrice,
    subtotal,
    discountAmount: 0,
    totalAmount: subtotal,
    voucherCode: '',
    voucherLabel: '',
    customer: {
      fullName: payload.customer?.fullName || 'Khách hàng VietTicket',
      email: payload.customer?.email || '',
      phone: payload.customer?.phone || '',
    },
    note: payload.note || '',
    status: 'unpaid',
    paymentStatus: 'unpaid',
    paymentMethod: '',
    requiresPartnerApproval: Boolean(
      payload.requiresPartnerApproval || payload.approvalRequired,
    ),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RESERVATION_DURATION_MS).toISOString(),
  }

  writeBookings([booking, ...readBookings().filter((item) => item.id !== bookingId)])
  return booking
}

export const getBookings = () =>
  readBookings().sort(
    (first, second) => new Date(second.createdAt) - new Date(first.createdAt),
  )

export const getBookingDetails = (bookingId) =>
  readBookings().find((booking) => booking.id === bookingId) || null

export const applyVoucher = (bookingId, voucherCode) => {
  const normalizedCode = String(voucherCode || '').trim().toUpperCase()
  const voucher = VOUCHERS[normalizedCode]
  const currentBooking = getBookingDetails(bookingId)

  if (!currentBooking) {
    return { success: false, message: 'Không tìm thấy đơn đặt vé.', booking: null }
  }

  if (!voucher) {
    return {
      success: false,
      message: 'Mã ưu đãi không hợp lệ hoặc đã hết hạn.',
      booking: currentBooking,
    }
  }

  const subtotal = Math.max(0, toSafeNumber(currentBooking.subtotal))
  const discountAmount = Math.min(
    subtotal,
    Math.round(voucher.calculateDiscount(subtotal)),
  )
  const booking = updateBooking(bookingId, (item) => ({
    ...item,
    voucherCode: normalizedCode,
    voucherLabel: voucher.label,
    discountAmount,
    totalAmount: Math.max(0, subtotal - discountAmount),
  }))

  return {
    success: true,
    message: `Áp dụng ${normalizedCode} thành công.`,
    booking,
  }
}

export const updateNote = (bookingId, note) =>
  updateBooking(bookingId, (booking) => ({ ...booking, note }))

export const processPayment = (bookingId, paymentMethod) =>
  updateBooking(bookingId, (booking) => ({
    ...booking,
    paymentMethod,
    paymentStatus: 'processing',
  }))

export const confirmPayment = (bookingId, status) =>
  updateBooking(bookingId, (booking) => {
    if (status === 'failed') {
      return {
        ...booking,
        status: 'unpaid',
        paymentStatus: 'failed',
      }
    }

    const finalStatus =
      status === 'pending_partner' || booking.requiresPartnerApproval
        ? 'pending_partner'
        : 'confirmed'

    return {
      ...booking,
      status: finalStatus,
      paymentStatus: 'paid',
      paidAt: new Date().toISOString(),
    }
  })

const bookingService = {
  reserveTicket,
  getBookings,
  getBookingDetails,
  applyVoucher,
  updateNote,
  processPayment,
  confirmPayment,
}

export default bookingService
