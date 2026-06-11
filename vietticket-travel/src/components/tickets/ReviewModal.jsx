import { useState } from 'react'
import { toast } from 'react-toastify'
import reviewService from '../../services/reviewService.js'

function ReviewModal({ booking, onClose, onSuccess }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.warning('Vui lòng chọn số sao đánh giá!')
      return
    }

    setIsSubmitting(true)
    try {
      await reviewService.createReview({
        bookingId: booking.bookingId || booking.id,
        rating,
        comment,
      })
      toast.success('Gửi đánh giá thành công! Cảm ơn phản hồi của bạn.')
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Lỗi khi gửi đánh giá:', error)
      toast.error(error.message || 'Gửi đánh giá thất bại. Vui lòng thử lại.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const starValues = [1, 2, 3, 4, 5]
  const RATING_LABELS = {
    1: 'Rất tệ',
    2: 'Không hài lòng',
    3: 'Bình thường',
    4: 'Hài lòng',
    5: 'Tuyệt vời',
  }
  const COMMENT_MAX_LENGTH = 2000
  const displayedRating = hoverRating || rating

  const handleClose = () => {
    if (!isSubmitting) onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal Card */}
      <div 
        className="relative z-10 w-full max-w-lg rounded-3xl bg-white/75 backdrop-blur-md border border-white/20 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300"
        style={{ fontFamily: "'Be Vietnam Pro', 'Plus Jakarta Sans', sans-serif" }}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#bec8ca]/20 flex justify-between items-center bg-white/40">
          <h2 className="text-xl font-bold text-[#00474d]">Đánh giá trải nghiệm</h2>
          <button
            className="material-symbols-outlined text-[#3f484a] hover:text-[#ba1a1a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Đóng"
            type="button"
          >
            close
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          <div className="text-center">
            <p className="text-[#3f484a] text-sm font-medium mb-1">Bạn cảm thấy chuyến đi thế nào?</p>
            <h3 className="text-lg font-bold text-[#00474d] mb-4">
              {booking.attractionTitle || 'Điểm tham quan'}
            </h3>
            
            {/* Stars selection */}
            <div className="flex justify-center gap-2 py-4">
              {starValues.map((val) => {
                const isActive = val <= (hoverRating || rating)
                return (
                  <button
                    key={val}
                    className="hover:scale-125 transition-transform duration-200 cursor-pointer focus:outline-none"
                    onClick={() => setRating(val)}
                    onMouseEnter={() => setHoverRating(val)}
                    onMouseLeave={() => setHoverRating(0)}
                    type="button"
                  >
                    <span 
                      className={`material-symbols-outlined text-4xl transition-colors ${
                        isActive ? 'text-[#feb700]' : 'text-[#bec8ca]'
                      }`}
                      style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      star
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Rating label feedback */}
            <p
              className={`text-sm font-bold h-5 transition-opacity ${
                displayedRating ? 'opacity-100 text-[#feb700]' : 'opacity-0'
              }`}
              aria-live="polite"
            >
              {displayedRating ? RATING_LABELS[displayedRating] : ''}
            </p>
          </div>

          {/* Comment input */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-[#3f484a] px-1 block" htmlFor="review-comment">
              Nhận xét của bạn
            </label>
            <textarea
              id="review-comment"
              className="w-full h-32 p-4 rounded-2xl border border-[#bec8ca] bg-white/60 focus:ring-2 focus:ring-[#00474d] focus:border-[#00474d] transition-all resize-none text-sm leading-6"
              placeholder="Hãy chia sẻ những điều bạn tâm đắc nhất về chuyến đi..."
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
              maxLength={COMMENT_MAX_LENGTH}
            />
            <p className="text-right text-[11px] text-[#6f797a] px-1">
              {comment.length}/{COMMENT_MAX_LENGTH} ký tự
            </p>
          </div>

          {/* Submit button */}
          <button 
            className="w-full bg-[#00474d] text-white py-4 rounded-2xl font-bold shadow-lg hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? 'Đang gửi...' : 'Gửi đánh giá'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReviewModal
