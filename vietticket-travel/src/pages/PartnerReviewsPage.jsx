import { useEffect, useState, useMemo } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import reviewService from '../services/reviewService.js'

// Mock Data for Fallback
const MOCK_STATS = {
  averageRating: 4.8,
  totalReviews: 1248,
  unrepliedReviews: 24,
}

const MOCK_REVIEWS = [
  {
    id: 'rev-1',
    rating: 5,
    comment: 'Trải nghiệm leo Fansipan thật tuyệt vời. Dịch vụ cáp treo rất nhanh chóng và an toàn. Nhân viên tại VietTicket hỗ trợ đặt vé rất nhiệt tình và chu đáo. Nhất định sẽ quay lại!',
    replyComment: null,
    repliedAt: null,
    createdAt: '2026-06-10T11:40:00Z',
    updatedAt: '2026-06-10T11:40:00Z',
    user: {
      fullName: 'Nguyễn Thu Hà',
      profile: { avatarUrl: null },
    },
    attraction: {
      title: 'Sun World Fansipan Legend',
    },
  },
  {
    id: 'rev-2',
    rating: 4,
    comment: 'Khu vui chơi rất rộng và nhiều trò chơi hấp dẫn. Tuy nhiên thời gian xếp hàng hơi lâu vào cuối tuần. Mong VietTicket có thêm tính năng đặt trước giờ chơi cho từng trò.',
    replyComment: 'Chào anh Tuấn, cảm ơn anh đã góp ý chân thành. VietTicket đang làm việc với đối tác VinWonders để tối ưu hóa quy trình đặt chỗ. Rất mong được phục vụ anh tốt hơn trong lần tới!',
    repliedAt: '2026-06-09T23:45:00Z',
    createdAt: '2026-06-09T11:45:00Z',
    updatedAt: '2026-06-09T23:45:00Z',
    user: {
      fullName: 'Lê Minh Tuấn',
      profile: { avatarUrl: null },
    },
    attraction: {
      title: 'VinWonders Nha Trang',
    },
  },
  {
    id: 'rev-3',
    rating: 5,
    comment: 'Cảm ơn VietTicket đã giúp gia đình tôi có một chuyến đi Đà Nẵng trọn vẹn. Khách sạn view biển cực đẹp, xe đưa đón đúng giờ. Rất hài lòng với dịch vụ hỗ trợ khách hàng 24/7.',
    replyComment: 'VietTicket Travel xin chào anh Hải. Thật vinh dự khi được gia đình mình tin tưởng lựa chọn. Những lời khen của anh là động lực lớn để đội ngũ chúng tôi không ngừng cải thiện chất lượng dịch vụ. Hẹn gặp lại gia đình mình trong tương lai gần!',
    repliedAt: '2026-06-03T10:00:00Z',
    createdAt: '2026-06-03T09:00:00Z',
    updatedAt: '2026-06-03T10:00:00Z',
    user: {
      fullName: 'Lê Minh Hải',
      profile: { avatarUrl: null },
    },
    attraction: {
      title: 'Cầu Vàng Đà Nẵng',
    },
  },
]

export default function PartnerReviewsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState(MOCK_STATS)
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
  const [filterTab, setFilterTab] = useState('all') // 'all', 'unanswered', 'answered'
  const [sortBy, setSortBy] = useState('newest') // 'newest', 'highest', 'lowest'
  const [replyTexts, setReplyTexts] = useState({}) 
  const [editingReviewId, setEditingReviewId] = useState(null)
  const [now] = useState(() => Date.now())

  const fetchReviewsData = async (showLoading = false) => {
    if (showLoading) setIsLoading(true)
    try {
      const fetchedStats = await reviewService.getPartnerReviewStats()
      const fetchedReviews = await reviewService.getPartnerReviews()
      setStats(fetchedStats)
      setReviews(fetchedReviews)
    } catch (error) {
      console.warn('Lỗi kết nối API, sử dụng dữ liệu mô phỏng:', error)
      setStats(MOCK_STATS)
      setReviews(MOCK_REVIEWS)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    document.title = 'Quản lý Đánh giá Đối tác | VietTicket'
    let active = true
    reviewService.getPartnerReviewStats()
      .then((fetchedStats) => {
        if (active) setStats(fetchedStats)
      })
      .catch((err) => console.error(err))
    
    reviewService.getPartnerReviews()
      .then((fetchedReviews) => {
        if (active) {
          setReviews(fetchedReviews)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        console.warn('Lỗi kết nối API, sử dụng dữ liệu mô phỏng:', err)
        if (active) {
          setStats(MOCK_STATS)
          setReviews(MOCK_REVIEWS)
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const handleReplySubmit = async (reviewId) => {
    const text = replyTexts[reviewId]?.trim()
    if (!text) {
      toast.warning('Nội dung phản hồi không được để trống!')
      return
    }

    try {
      await reviewService.replyReview(reviewId, text)
      toast.success('Gửi phản hồi thành công!')
      setEditingReviewId(null)
      setReplyTexts((prev) => ({ ...prev, [reviewId]: '' }))
      fetchReviewsData(true)
    } catch (error) {
      console.error('Lỗi khi gửi phản hồi:', error)
      if (!error.status) {
        // Mock mode local state update
        setReviews((current) =>
          current.map((r) =>
            r.id === reviewId
              ? {
                  ...r,
                  replyComment: text,
                  repliedAt: new Date().toISOString(),
                }
              : r,
          ),
        )
        setStats((prev) => ({
          ...prev,
          unrepliedReviews: Math.max(0, prev.unrepliedReviews - 1),
        }))
        setEditingReviewId(null)
        setReplyTexts((prev) => ({ ...prev, [reviewId]: '' }))
        toast.success('Gửi phản hồi thành công (Chế độ mô phỏng)!')
      } else {
        toast.error(error.message || 'Không thể gửi phản hồi. Vui lòng thử lại.')
      }
    }
  }

  const toggleReply = (review) => {
    if (editingReviewId === review.id) {
      setEditingReviewId(null)
      setReplyTexts((prev) => ({ ...prev, [review.id]: '' }))
    } else {
      setEditingReviewId(review.id)
      setReplyTexts((prev) => ({ ...prev, [review.id]: review.replyComment || '' }))
    }
  }

  // Filter & Sort Logic
  const filteredAndSortedReviews = useMemo(() => {
    let result = [...reviews]

    // Filtering
    if (filterTab === 'unanswered') {
      result = result.filter((r) => !r.replyComment)
    } else if (filterTab === 'answered') {
      result = result.filter((r) => !!r.replyComment)
    }

    // Sorting
    if (sortBy === 'newest') {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } else if (sortBy === 'highest') {
      result.sort((a, b) => b.rating - a.rating)
    } else if (sortBy === 'lowest') {
      result.sort((a, b) => a.rating - b.rating)
    }

    return result
  }, [reviews, filterTab, sortBy])

  const getInitials = (name) => {
    if (!name) return 'KH'
    return name
      .split(/\s+/)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }



  const getRatingText = (rating) => {
    switch (rating) {
      case 5: return '5.0 tuyệt vời'
      case 4: return '4.0 khá tốt'
      case 3: return '3.0 trung bình'
      case 2: return '2.0 kém'
      case 1: return '1.0 rất kém'
      default: return `${rating.toFixed(1)}`
    }
  }

  return (
    <PartnerLayout pageTitle="Quản lý Đánh giá Đối tác">
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">
            progress_activity
          </span>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in duration-300">
          
          {/* Summary Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Avg Rating Card */}
            <div className="bg-white p-6 rounded-xl border border-[#bec8ca]/20 shadow-[0px_4px_20px_rgba(0,96,104,0.04)] hover:shadow-[0px_12px_32px_rgba(0,96,104,0.08)] flex items-center gap-6 group transition-all duration-300">
              <div className="w-16 h-16 bg-[#ffdea8] flex items-center justify-center rounded-2xl group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[#7c5800] text-4xl" style={{ fontVariationSettings: '"FILL" 1' }}>star</span>
              </div>
              <div>
                <p className="text-sm text-[#3f484a] mb-1 font-semibold">Đánh giá Trung bình</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-[#00474d]">{stats.averageRating.toFixed(1)}</span>
                  <span className="text-[#7c5800] font-bold text-sm">/ 5.0</span>
                </div>
              </div>
            </div>

            {/* Total Reviews Card */}
            <div className="bg-white p-6 rounded-xl border border-[#bec8ca]/20 shadow-[0px_4px_20px_rgba(0,96,104,0.04)] hover:shadow-[0px_12px_32px_rgba(0,96,104,0.08)] flex items-center gap-6 group transition-all duration-300">
              <div className="w-16 h-16 bg-[#a6eff8] flex items-center justify-center rounded-2xl group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[#004f56] text-4xl" style={{ fontVariationSettings: '"FILL" 1' }}>rate_review</span>
              </div>
              <div>
                <p className="text-sm text-[#3f484a] mb-1 font-semibold">Tổng số Đánh giá</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-[#00474d]">{stats.totalReviews.toLocaleString('vi-VN')}</span>
                  <span className="text-[#006068] font-bold text-xs">+12% tháng này</span>
                </div>
              </div>
            </div>

            {/* Unanswered Card */}
            <div className="bg-white p-6 rounded-xl border-l-4 border-[#ba1a1a] shadow-[0px_4px_20px_rgba(0,96,104,0.04)] hover:shadow-[0px_12px_32px_rgba(0,96,104,0.08)] flex items-center gap-6 group transition-all duration-300">
              <div className="w-16 h-16 bg-[#ffdad6] flex items-center justify-center rounded-2xl group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[#93000a] text-4xl" style={{ fontVariationSettings: '"FILL" 1' }}>pending_actions</span>
              </div>
              <div>
                <p className="text-sm text-[#3f484a] mb-1 font-semibold">Đánh giá chưa phản hồi</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-[#ba1a1a]">{stats.unrepliedReviews}</span>
                  <span className="bg-[#ba1a1a] text-white text-[10px] px-2 py-0.5 rounded-full font-bold">CẦN XỬ LÝ</span>
                </div>
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex bg-[#f3f3f6] p-1 rounded-xl">
              <button 
                className={`px-6 py-2 rounded-lg font-semibold text-xs transition-all ${
                  filterTab === 'all' 
                    ? 'bg-[#00474d] text-white shadow-sm' 
                    : 'text-[#3f484a] hover:text-[#00474d]'
                }`}
                onClick={() => setFilterTab('all')}
              >
                Tất cả
              </button>
              <button 
                className={`px-6 py-2 rounded-lg font-semibold text-xs transition-all ${
                  filterTab === 'unanswered' 
                    ? 'bg-[#00474d] text-white shadow-sm' 
                    : 'text-[#3f484a] hover:text-[#00474d]'
                }`}
                onClick={() => setFilterTab('unanswered')}
              >
                Chưa trả lời
              </button>
              <button 
                className={`px-6 py-2 rounded-lg font-semibold text-xs transition-all ${
                  filterTab === 'answered' 
                    ? 'bg-[#00474d] text-white shadow-sm' 
                    : 'text-[#3f484a] hover:text-[#00474d]'
                }`}
                onClick={() => setFilterTab('answered')}
              >
                Đã trả lời
              </button>
            </div>

            <div className="flex gap-3">
              <select 
                className="bg-white border-[#bec8ca]/40 rounded-lg text-xs font-semibold focus:ring-[#00474d] focus:border-[#00474d] py-2 px-3"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="newest">Sắp xếp theo: Mới nhất</option>
                <option value="highest">Sắp xếp theo: Đánh giá cao nhất</option>
                <option value="lowest">Sắp xếp theo: Đánh giá thấp nhất</option>
              </select>
            </div>
          </div>

          {/* Reviews List */}
          <div className="space-y-6">
            {filteredAndSortedReviews.length === 0 ? (
              <div className="bg-white rounded-xl py-16 text-center border border-[#bec8ca]/20 shadow-sm text-[#6f797a]">
                <span className="material-symbols-outlined text-5xl mb-3 text-[#bec8ca]">forum</span>
                <p className="font-semibold text-sm">Không tìm thấy đánh giá nào.</p>
              </div>
            ) : (
              filteredAndSortedReviews.map((review) => {
                const isEditing = editingReviewId === review.id
                const hasReplied = !!review.replyComment
                return (
                  <div 
                    key={review.id}
                    className="bg-white rounded-xl border border-[#bec8ca]/15 hover:border-[#00474d]/30 shadow-[0px_4px_20px_rgba(0,96,104,0.02)] hover:shadow-[0px_12px_32px_rgba(0,96,104,0.06)] transition-all duration-300"
                  >
                    <div className="p-6 md:p-8 flex flex-col md:flex-row gap-8">
                      
                      {/* Customer Info & Attraction (Left Sidebar on desktop) */}
                      <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[#bec8ca]/20 pb-6 md:pb-0 md:pr-8">
                        <div className="flex items-center gap-3 mb-4">
                          {review.user?.profile?.avatarUrl ? (
                            <img
                              alt="Customer Avatar"
                              className="w-12 h-12 rounded-full object-cover border border-[#bec8ca]/20"
                              src={review.user.profile.avatarUrl}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-[#00474d]/10 text-[#00474d] flex items-center justify-center font-bold text-sm">
                              {getInitials(review.user?.fullName)}
                            </div>
                          )}
                          <div>
                            <h4 className="font-bold text-[#1a1c1e] text-sm">{review.user?.fullName}</h4>
                            <p className="text-[11px] text-[#3f484a] font-semibold">{formatReviewTime(review.createdAt, now)}</p>
                          </div>
                        </div>
                        <div className="bg-[#f3f3f6] p-3 rounded-lg">
                          <p className="text-[10px] font-bold text-[#3f484a] uppercase tracking-tighter mb-1">Địa điểm:</p>
                          <h5 className="text-xs text-[#00474d] font-bold line-clamp-1" title={review.attraction?.title}>
                            {review.attraction?.title}
                          </h5>
                        </div>
                      </div>

                      {/* Content & Actions (Right area) */}
                      <div className="flex-1 space-y-4">
                        
                        {/* Rating Stars Row */}
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span 
                              key={i}
                              className={`material-symbols-outlined text-sm ${i < review.rating ? 'text-[#feb700]' : 'text-[#bec8ca]'}`}
                              style={{ fontVariationSettings: i < review.rating ? '"FILL" 1' : '"FILL" 0' }}
                            >
                              star
                            </span>
                          ))}
                          <span className="ml-2 font-bold text-[#00474d] text-xs uppercase tracking-wider">{getRatingText(review.rating)}</span>
                        </div>

                        {/* Customer Comment */}
                        <p className="text-sm text-[#1a1c1e] leading-relaxed">
                          {review.comment || <span className="italic text-[#bec8ca]">Không có bình luận.</span>}
                        </p>

                        {/* Actions & Response Area */}
                        <div className="pt-2">
                          
                          {/* Write Response Button (If unanswered and not editing) */}
                          {!hasReplied && !isEditing && (
                            <button 
                              className="flex items-center gap-2 bg-[#00474d] text-white hover:bg-[#003d42] px-6 py-2.5 rounded-lg transition-all group shadow-sm active:scale-95 text-xs font-bold"
                              onClick={() => toggleReply(review)}
                              type="button"
                            >
                              <span className="material-symbols-outlined group-hover:rotate-12 transition-transform text-sm">edit_note</span>
                              Viết Phản hồi
                            </button>
                          )}

                          {/* Existing Response Box (If answered and not editing) */}
                          {hasReplied && !isEditing && (
                            <div className="bg-[#a6eff8]/10 border-l-4 border-[#00474d] p-6 rounded-r-xl space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-[#00474d] text-[18px]">reply</span>
                                  <span className="text-xs font-bold text-[#00474d]">Phản hồi từ Đối tác</span>
                                  <span className="text-[10px] text-[#3f484a] font-bold ml-2">• {formatReviewTime(review.repliedAt || review.updatedAt, now)}</span>
                                </div>
                                <button 
                                  className="text-[#00474d] hover:underline text-xs font-bold flex items-center gap-1"
                                  onClick={() => toggleReply(review)}
                                  type="button"
                                >
                                  <span className="material-symbols-outlined text-xs">edit</span> Chỉnh sửa
                                </button>
                              </div>
                              <p className="text-xs text-[#3f484a] italic">
                                "{review.replyComment}"
                              </p>
                            </div>
                          )}

                          {/* Inline Reply Form (If editing / writing response) */}
                          {isEditing && (
                            <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300 bg-[#f3f3f6] p-4 rounded-xl space-y-3">
                              <textarea 
                                className="w-full bg-white border border-[#bec8ca]/40 rounded-xl p-4 text-xs focus:ring-[#00474d] focus:border-[#00474d] placeholder:text-[#bec8ca] h-28 leading-5" 
                                placeholder="Nhập câu trả lời của bạn tại đây..."
                                value={replyTexts[review.id] || ''}
                                onChange={(e) => setReplyTexts(prev => ({ ...prev, [review.id]: e.target.value }))}
                              />
                              <div className="flex justify-end gap-3">
                                <button 
                                  className="px-5 py-2 text-[#3f484a] hover:bg-[#bec8ca]/20 font-bold rounded-lg text-xs"
                                  onClick={() => toggleReply(review)}
                                  type="button"
                                >
                                  Hủy
                                </button>
                                <button 
                                  className="px-6 py-2 bg-[#00474d] text-white hover:bg-[#003d42] font-bold rounded-lg shadow-md hover:shadow-lg transition-all text-xs"
                                  onClick={() => handleReplySubmit(review.id)}
                                  type="button"
                                >
                                  {hasReplied ? 'Cập nhật' : 'Gửi phản hồi'}
                                </button>
                              </div>
                            </div>
                          )}

                        </div>
                      </div>

                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

const formatReviewTime = (dateStr, referenceTime) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const diffMs = (referenceTime || Date.now()) - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHours <= 0) return 'Vừa xong'
    return `${diffHours} giờ trước`
  }
  if (diffDays === 1) return '1 ngày trước'
  if (diffDays < 7) return `${diffDays} ngày trước`
  return date.toLocaleDateString('vi-VN')
}
