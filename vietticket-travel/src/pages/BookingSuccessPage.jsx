import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

function BookingSuccessPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const bookingState = location.state || {}

  // Generate a stable random booking code once on mount or read from state
  const [bookingCode] = useState(
    () => bookingState.reservationId || 'VT-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
  )

  const attractionTitle = bookingState.attractionTitle || 'Sun World Bà Nà Hills'
  const dateValue = bookingState.date || 'Chủ nhật, 08/06/2026'

  return (
    <div className="min-h-screen bg-[#f9f9fc] flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-lg mx-auto bg-white rounded-3xl shadow-lg p-8 md:p-10 text-center">

        {/* Animated Checkmark */}
        <div className="w-24 h-24 rounded-full bg-[#006068] flex items-center justify-center mx-auto mb-6 animate-bounce">
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: '48px', fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
        </div>

        {/* Title */}
        <h1
          className="text-3xl md:text-4xl font-extrabold text-[#006068] mb-3"
          style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
        >
          Đặt vé thành công!
        </h1>

        {/* Subtitle */}
        <p className="text-gray-500 text-base leading-relaxed mb-6" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Cảm ơn bạn đã tin tưởng VietTicket Travel. Thông tin vé đã được gửi qua email.
        </p>

        {/* Summary Box */}
        <div className="bg-[#f9f9fc] rounded-2xl p-6 text-left mt-2 border border-gray-100">
          <div className="flex flex-col gap-4">
            {/* Booking Code */}
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0 text-[22px]">
                tag
              </span>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Mã đặt chỗ</p>
                <p
                  className="font-mono font-bold text-[#006068] text-lg tracking-widest"
                >
                  {bookingCode}
                </p>
              </div>
            </div>

            {/* Location */}
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0 text-[22px]">
                location_on
              </span>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Địa điểm</p>
                <p className="font-semibold text-gray-800 text-sm">
                  {attractionTitle}
                </p>
              </div>
            </div>

            {/* Date */}
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[#006068] mt-0.5 shrink-0 text-[22px]">
                calendar_month
              </span>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Ngày</p>
                <p className="font-semibold text-gray-800 text-sm">
                  {dateValue}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-8">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="flex-1 flex items-center justify-center gap-2 bg-[#006068] hover:bg-[#004d54] active:bg-[#003a3f] text-white font-bold text-sm py-3.5 px-6 rounded-2xl transition-all duration-200 shadow-md hover:shadow-lg"
            style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
          >
            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            Xem lịch sử đặt vé
          </button>

          <button
            type="button"
            onClick={() => navigate('/attractions')}
            className="flex-1 flex items-center justify-center gap-2 border-2 border-[#006068] text-[#006068] hover:bg-[#006068]/5 active:bg-[#006068]/10 font-bold text-sm py-3.5 px-6 rounded-2xl transition-all duration-200"
            style={{ fontFamily: "'Be Vietnam Pro', sans-serif" }}
          >
            <span className="material-symbols-outlined text-[18px]">explore</span>
            Khám phá thêm
          </button>
        </div>

        {/* Brand footer note */}
        <p className="mt-6 text-xs text-gray-400">
          © 2026 VietTicket Travel – Hành trình của bạn, chúng tôi đồng hành.
        </p>
      </div>
    </div>
  )
}

export default BookingSuccessPage
