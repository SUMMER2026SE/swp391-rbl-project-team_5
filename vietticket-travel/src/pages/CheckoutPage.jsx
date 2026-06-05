import { useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import { appDownloadButtons, footerLinks } from '../data/landingData.js'

const checkoutNavLinks = [
  { label: 'Trang chủ', href: '/' },
  { label: 'Đặt vé', href: '/attractions', active: true },
]

const PAYMENT_METHODS = [
  { id: 'vnpay', label: 'Ví VNPay', icon: 'credit_card' },
  { id: 'card', label: 'Thẻ tín dụng / Ghi nợ', icon: 'payments' },
  { id: 'onsite', label: 'Thanh toán khi đến nơi', icon: 'store' },
]

function CheckoutPage() {
  const { reservationId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [selectedPayment, setSelectedPayment] = useState('vnpay')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [note, setNote] = useState('')

  const bookingState = location.state || {}
  
  const attractionTitle = bookingState.attractionTitle || 'Sun World Bà Nà Hills'
  const ticketName = bookingState.ticketName || 'Vé tham quan'
  const dateValue = bookingState.date || '2026-06-08'
  const timeSlotLabel = bookingState.timeSlotLabel || '09:00 – 17:00'
  
  const adultCount = bookingState.adultCount !== undefined ? bookingState.adultCount : 2
  const childCount = bookingState.childCount !== undefined ? bookingState.childCount : 1
  
  const adultPrice = bookingState.adultPrice !== undefined ? bookingState.adultPrice : 450000
  const childPrice = bookingState.childPrice !== undefined ? bookingState.childPrice : 315000
  
  const adultTotal = adultCount * adultPrice
  const childTotal = childCount * childPrice
  const totalPrice = adultTotal + childTotal

  const displayReservationId = reservationId || 'VT-XXXXXX'

  const formatDateString = (dStr) => {
    if (!dStr) return 'Chủ nhật, 08/06/2026'
    if (dStr.includes(',')) return dStr
    try {
      const date = new Date(dStr)
      const options = { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }
      let formatted = date.toLocaleDateString('vi-VN', options)
      return formatted.charAt(0).toUpperCase() + formatted.slice(1)
    } catch {
      return dStr
    }
  }
  
  const formattedDate = formatDateString(dateValue)

  const formatCurrency = (val) => {
    return `${new Intl.NumberFormat('vi-VN').format(val)} VND`
  }

  const handleConfirm = () => {
    setIsSubmitting(true)
    setTimeout(() => {
      navigate('/booking-success', {
        state: {
          reservationId: displayReservationId,
          attractionTitle,
          date: formattedDate,
        }
      })
    }, 1500)
  }

  return (
    <>
      <Header links={checkoutNavLinks} />

      <main className="min-h-screen bg-[#f9f9fc] py-8 px-5 md:px-12">
        <div className="mx-auto max-w-[1280px] grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* ── LEFT COLUMN: Order Summary ── */}
          <div className="lg:col-span-7 flex flex-col gap-6">

            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb">
              <ol className="flex items-center gap-1.5 text-sm text-gray-500 flex-wrap">
                <li>
                  <a href="/" className="hover:text-[#006068] transition-colors duration-150">
                    Trang chủ
                  </a>
                </li>
                <li>
                  <span className="material-symbols-outlined text-base leading-none select-none">
                    chevron_right
                  </span>
                </li>
                <li>
                  <a href="/attractions" className="hover:text-[#006068] transition-colors duration-150">
                    Đặt vé
                  </a>
                </li>
                <li>
                  <span className="material-symbols-outlined text-base leading-none select-none">
                    chevron_right
                  </span>
                </li>
                <li>
                  <span className="font-semibold text-[#006068]">Xác nhận thanh toán</span>
                </li>
              </ol>
            </nav>

            {/* Page Title */}
            <h1
              className="text-3xl md:text-4xl font-bold text-[#006068]"
              style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
            >
              Xác nhận đặt vé
            </h1>

            {/* Order Info Card */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 flex flex-col gap-4">
              <h2
                className="text-lg font-semibold text-gray-800 mb-1"
                style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
              >
                Chi tiết đặt chỗ
              </h2>

              <div className="divide-y divide-gray-100">
                {/* Tên địa điểm */}
                <div className="flex items-start gap-3 py-3">
                  <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0">
                    location_on
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Tên địa điểm</p>
                    <p className="font-semibold text-gray-800">{attractionTitle}</p>
                  </div>
                </div>

                {/* Ngày tham quan */}
                <div className="flex items-start gap-3 py-3">
                  <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0">
                    calendar_month
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Ngày tham quan</p>
                    <p className="font-semibold text-gray-800">{formattedDate}</p>
                  </div>
                </div>

                {/* Khung giờ */}
                <div className="flex items-start gap-3 py-3">
                  <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0">
                    schedule
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Khung giờ</p>
                    <p className="font-semibold text-gray-800">{timeSlotLabel}</p>
                  </div>
                </div>

                {/* Loại vé */}
                <div className="flex items-start gap-3 py-3">
                  <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0">
                    confirmation_number
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Loại vé</p>
                    <p className="font-semibold text-gray-800">
                      {ticketName} (Người lớn x{adultCount}{childCount > 0 ? `, Trẻ em x${childCount}` : ''})
                    </p>
                  </div>
                </div>

                {/* Mã đặt chỗ */}
                <div className="flex items-start gap-3 py-3">
                  <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0">
                    tag
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Mã đặt chỗ</p>
                    <p className="font-mono font-bold text-[#006068] tracking-wider text-base">
                      {displayReservationId}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Contact Info Card */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
              <h2
                className="text-lg font-semibold text-gray-800 mb-5"
                style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
              >
                Thông tin liên hệ
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-600" htmlFor="fullName">
                    Họ tên
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px] pointer-events-none">
                      person
                    </span>
                    <input
                      id="fullName"
                      type="text"
                      defaultValue="Hoàng Anh"
                      readOnly
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 font-medium text-sm cursor-not-allowed focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-600" htmlFor="email">
                    Email
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px] pointer-events-none">
                      mail
                    </span>
                    <input
                      id="email"
                      type="email"
                      defaultValue="user@example.com"
                      readOnly
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 font-medium text-sm cursor-not-allowed focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Note Card */}
            <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
              <h2
                className="text-lg font-semibold text-gray-800 mb-4"
                style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
              >
                Ghi chú
              </h2>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-3 text-gray-400 text-[20px] pointer-events-none">
                  edit_note
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Nhập yêu cầu đặc biệt (nếu có)..."
                  rows={4}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#006068]/30 focus:border-[#006068] transition-all duration-150 placeholder:text-gray-400"
                />
              </div>
            </section>
          </div>

          {/* ── RIGHT COLUMN: Payment Panel (sticky) ── */}
          <div className="lg:col-span-5 lg:sticky lg:top-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 flex flex-col gap-6">

              {/* Payment Method */}
              <div>
                <h2
                  className="text-lg font-semibold text-gray-800 mb-4"
                  style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
                >
                  Phương thức thanh toán
                </h2>
                <div className="flex flex-col gap-3">
                  {PAYMENT_METHODS.map((method) => {
                    const isSelected = selectedPayment === method.id
                    return (
                      <label
                        key={method.id}
                        htmlFor={`pay-${method.id}`}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-150 ${
                          isSelected
                            ? 'border-[#006068] bg-[#006068]/5'
                            : 'border-gray-200 bg-white hover:border-[#006068]/40'
                        }`}
                      >
                        <input
                          id={`pay-${method.id}`}
                          type="radio"
                          name="paymentMethod"
                          value={method.id}
                          checked={isSelected}
                          onChange={() => setSelectedPayment(method.id)}
                          className="accent-[#006068] w-4 h-4 shrink-0"
                        />
                        <span
                          className={`material-symbols-outlined text-[22px] shrink-0 ${
                            isSelected ? 'text-[#006068]' : 'text-gray-400'
                          }`}
                        >
                          {method.icon}
                        </span>
                        <span
                          className={`text-sm font-medium ${
                            isSelected ? 'text-[#006068]' : 'text-gray-700'
                          }`}
                        >
                          {method.label}
                        </span>
                        {isSelected && (
                          <span className="ml-auto material-symbols-outlined text-[#006068] text-[20px]">
                            check_circle
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Price Summary */}
              <div className="border-t border-gray-100 pt-5 flex flex-col gap-3">
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Vé người lớn (x{adultCount})</span>
                  <span className="font-medium text-gray-800">{formatCurrency(adultTotal)}</span>
                </div>
                {childCount > 0 && (
                  <div className="flex justify-between items-center text-sm text-gray-600">
                    <span>Vé trẻ em (x{childCount})</span>
                    <span className="font-medium text-gray-800">{formatCurrency(childTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <span>Phí dịch vụ</span>
                  <span className="font-medium text-green-600">0 VND</span>
                </div>
                <hr className="border-gray-200 my-1" />
                <div className="flex justify-between items-center">
                  <span
                    className="text-base font-bold text-gray-800"
                    style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
                  >
                    Tổng cộng
                  </span>
                  <span
                    className="text-xl font-extrabold text-[#006068]"
                    style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
                  >
                    {formatCurrency(totalPrice)}
                  </span>
                </div>
              </div>

              {/* CTA Button */}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 bg-[#feb700] hover:bg-[#e5a600] active:bg-[#cc9400] text-gray-900 font-bold text-base py-4 px-6 rounded-2xl transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
                style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
              >
                {isSubmitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[20px]">
                      progress_activity
                    </span>
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    Xác nhận &amp; Thanh toán
                    <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                  </>
                )}
              </button>

              {/* Fine print */}
              <p className="text-center text-xs text-gray-500 -mt-2">
                Không mất phí đặt vé&nbsp;•&nbsp;Hủy miễn phí 24h trước
              </p>
            </div>
          </div>

        </div>
      </main>

      <Footer links={footerLinks} appButtons={appDownloadButtons} />
    </>
  )
}

export default CheckoutPage
