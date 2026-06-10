import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import reviewService from '../../services/reviewService.js'
import '../../styles/admin.css'

const MOCK_ADMIN_REVIEWS = [
  {
    id: 'rev-101',
    rating: 5,
    comment: 'Chuyến đi Bà Nà Hills rất tuyệt vời. Cảnh đẹp và khí hậu mát mẻ.',
    isHidden: false,
    createdAt: '2026-06-10T09:00:00Z',
    user: {
      fullName: 'Nguyễn Văn Hải',
      email: 'hai.nv@gmail.com',
    },
    attraction: {
      title: 'Sun World Ba Na Hills',
    },
  },
  {
    id: 'rev-102',
    rating: 1,
    comment: 'Dịch vụ vô cùng kém chất lượng! Mua vé ảo, lừa đảo khách du lịch tiền bạc bẩn thỉu. Hãy cẩn thận!',
    isHidden: false,
    createdAt: '2026-06-09T15:20:00Z',
    user: {
      fullName: 'Trần Minh Tâm',
      email: 'tam.tm@yahoo.com',
    },
    attraction: {
      title: 'Du thuyền Vịnh Hạ Long 5 Sao',
    },
  },
  {
    id: 'rev-103',
    rating: 2,
    comment: 'Quá đông đúc và chen lấn. Hướng dẫn viên không quản lý được đoàn. Dịch vụ chèo thuyền hoa đăng đắt đỏ.',
    isHidden: true,
    createdAt: '2026-06-08T11:30:00Z',
    user: {
      fullName: 'Phan Khánh Linh',
      email: 'linhpk99@gmail.com',
    },
    attraction: {
      title: 'Tour Phố Cổ Hội An',
    },
  },
  {
    id: 'rev-104',
    rating: 4,
    comment: 'Thời tiết mát mẻ thích hợp cho nghỉ dưỡng. Cáp treo đi êm và phong cảnh Fansipan hùng vĩ.',
    isHidden: false,
    createdAt: '2026-06-07T08:10:00Z',
    user: {
      fullName: 'Vũ Quốc Anh',
      email: 'quocanh.vu@outlook.com',
    },
    attraction: {
      title: 'Cáp treo Fansipan Sapa',
    },
  },
]

export default function ReviewModerationPage() {
  const [reviews, setReviews] = useState(MOCK_ADMIN_REVIEWS)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState('')

  // Filters
  const [searchText, setSearchText] = useState('')
  const [filterRating, setFilterRating] = useState('all')

  const fetchReviews = async () => {
    setLoading(true)
    try {
      const data = await reviewService.getAdminReviews()
      setReviews(data)
    } catch (error) {
      console.warn('Lỗi kết nối API Admin, sử dụng dữ liệu mô phỏng:', error)
      setReviews(MOCK_ADMIN_REVIEWS)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    document.title = 'Kiểm duyệt Đánh giá | VietTicket Admin'
    fetchReviews()
  }, [])

  const handleToggleHide = async (review) => {
    const nextHiddenStatus = !review.isHidden
    setActionId(review.id)
    try {
      await reviewService.moderateReview(review.id, nextHiddenStatus)
      toast.success(
        nextHiddenStatus
          ? 'Đã ẩn đánh giá vi phạm thành công!'
          : 'Đã hiển thị lại đánh giá thành công!'
      )
      fetchReviews()
    } catch (error) {
      console.error('Lỗi khi kiểm duyệt đánh giá:', error)
      // Mock mode simulator
      if (!error.status) {
        setReviews((current) =>
          current.map((r) =>
            r.id === review.id ? { ...r, isHidden: nextHiddenStatus } : r
          )
        )
        toast.success(
          nextHiddenStatus
            ? 'Đã ẩn đánh giá vi phạm (Chế độ mô phỏng)!'
            : 'Đã hiển thị lại đánh giá (Chế độ mô phỏng)!'
        )
      } else {
        toast.error(error.message || 'Không thể thực hiện kiểm duyệt. Vui lòng thử lại.')
      }
    } finally {
      setActionId('')
    }
  }

  const handleResetFilters = () => {
    setSearchText('')
    setFilterRating('all')
  }

  // Filter logic
  const filteredReviews = reviews.filter((review) => {
    const commentMatch =
      !searchText ||
      (review.comment || '').toLowerCase().includes(searchText.toLowerCase()) ||
      (review.user?.fullName || '').toLowerCase().includes(searchText.toLowerCase()) ||
      (review.attraction?.title || '').toLowerCase().includes(searchText.toLowerCase())

    const ratingMatch =
      filterRating === 'all' || review.rating === parseInt(filterRating)

    return commentMatch && ratingMatch
  })

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return isNaN(date.getTime()) ? dateStr : date.toLocaleDateString('vi-VN')
  }

  const activeCount = reviews.filter((r) => !r.isHidden).length
  const hiddenCount = reviews.filter((r) => r.isHidden).length

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm đánh giá...">
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h2 style={{ color: 'var(--adm-primary-dark)' }}>Kiểm duyệt Đánh giá</h2>
          <p>Quản lý, hiển thị hoặc ẩn các đánh giá vi phạm chính sách cộng đồng.</p>
        </div>
        
        {/* Stat badges */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 8,
              background: 'rgba(0,71,77,0.1)',
              color: 'var(--adm-primary-dark)',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
              visibility
            </span>
            Hiển thị: {activeCount}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 8,
              background: 'var(--adm-error-container)',
              color: 'var(--adm-on-error-container)',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
              visibility_off
            </span>
            Đã ẩn: {hiddenCount}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="admin-filter-bar" style={{ display: 'flex', gap: 16, alignItems: 'end', marginBottom: 24 }}>
        <div className="admin-filter-group" style={{ flex: 1, minWidth: 260 }}>
          <label htmlFor="searchComment">Tìm kiếm đánh giá</label>
          <input
            id="searchComment"
            placeholder="Tìm theo từ khóa bình luận, tên khách, tên địa điểm..."
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              width: '100%',
              minHeight: 46,
              border: '1px solid rgba(190,200,202,0.5)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 14,
              outline: 0,
            }}
          />
        </div>

        <div className="admin-filter-group" style={{ minWidth: 160 }}>
          <label htmlFor="filterRating">Số sao đánh giá</label>
          <select
            id="filterRating"
            value={filterRating}
            onChange={(e) => setFilterRating(e.target.value)}
            style={{
              width: '100%',
              minHeight: 46,
              border: '1px solid rgba(190,200,202,0.5)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 14,
              outline: 0,
            }}
          >
            <option value="all">Tất cả số sao</option>
            <option value="5">5 sao</option>
            <option value="4">4 sao</option>
            <option value="3">3 sao</option>
            <option value="2">2 sao</option>
            <option value="1">1 sao</option>
          </select>
        </div>

        <button
          onClick={handleResetFilters}
          style={{
            height: 46,
            padding: '0 20px',
            background: 'transparent',
            border: '1px solid rgba(190,200,202,0.5)',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            color: 'var(--adm-on-surface-variant)',
          }}
          type="button"
        >
          Đặt lại
        </button>
      </div>

      {/* Main Table section */}
      <div className="admin-page-section">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Khách hàng</th>
                <th>Địa điểm</th>
                <th>Số sao</th>
                <th>Nội dung bình luận</th>
                <th>Ngày viết</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--adm-on-surface-variant)' }}>
                    <span className="material-symbols-outlined animate-spin" style={{ fontSize: 28 }}>
                      progress_activity
                    </span>
                    <div style={{ marginTop: 8 }}>Đang tải danh sách đánh giá...</div>
                  </td>
                </tr>
              )}

              {!loading && filteredReviews.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--adm-on-surface-variant)' }}>
                    Không tìm thấy đánh giá nào.
                  </td>
                </tr>
              )}

              {!loading &&
                filteredReviews.map((review) => (
                  <tr
                    key={review.id}
                    style={{
                      opacity: review.isHidden ? 0.7 : 1,
                      transition: 'opacity 200ms',
                    }}
                  >
                    {/* User Info */}
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{review.user?.fullName || 'Khách hàng'}</div>
                      <div style={{ fontSize: 11, color: 'var(--adm-on-surface-variant)', marginTop: 2 }}>
                        {review.user?.email}
                      </div>
                    </td>

                    {/* Attraction Info */}
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--adm-primary-dark)' }}>
                        {review.attraction?.title}
                      </div>
                    </td>

                    {/* Star count */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 18, color: 'var(--adm-secondary)', fontVariationSettings: "'FILL' 1" }}
                        >
                          star
                        </span>
                        <span style={{ fontWeight: 700 }}>{review.rating}</span>
                      </div>
                    </td>

                    {/* Review text */}
                    <td style={{ maxWidth: 280 }}>
                      <p 
                        style={{ 
                          fontSize: 13, 
                          color: 'var(--adm-on-surface-variant)', 
                          lineHeight: '20px', 
                          margin: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical'
                        }}
                        title={review.comment}
                      >
                        {review.comment || <span style={{ fontStyle: 'italic', color: '#bec8ca' }}>Không có nội dung</span>}
                      </p>
                    </td>

                    {/* Date */}
                    <td style={{ fontSize: 13, color: 'var(--adm-on-surface-variant)' }}>
                      {formatDate(review.createdAt)}
                    </td>

                    {/* Status badge */}
                    <td>
                      {!review.isHidden ? (
                        <span className="badge badge--active">
                          <span className="badge__dot" style={{ background: 'var(--adm-primary-dark)' }} />
                          Đang hiện
                        </span>
                      ) : (
                        <span className="badge badge--hidden">
                          <span className="badge__dot" style={{ background: 'var(--adm-outline)' }} />
                          Đã ẩn
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'right' }}>
                      {!review.isHidden ? (
                        <button
                          className="btn-warn"
                          disabled={actionId === review.id}
                          onClick={() => handleToggleHide(review)}
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'var(--adm-error-container)',
                            color: 'var(--adm-on-error-container)',
                            border: 'none',
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: 'pointer',
                            transition: 'opacity 200ms',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            visibility_off
                          </span>
                          Ẩn vi phạm
                        </button>
                      ) : (
                        <button
                          disabled={actionId === review.id}
                          onClick={() => handleToggleHide(review)}
                          type="button"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'rgba(0,71,77,0.1)',
                            color: 'var(--adm-primary-dark)',
                            border: 'none',
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: 'pointer',
                            transition: 'opacity 200ms',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            visibility
                          </span>
                          Hiển thị lại
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
