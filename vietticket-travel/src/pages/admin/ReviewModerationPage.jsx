import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import reviewService from '../../services/reviewService.js'
import '../../styles/admin.css'

const PAGE_SIZE = 10

export default function ReviewModerationPage() {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState('')
  const [moderationTarget, setModerationTarget] = useState(null)
  const [moderationReason, setModerationReason] = useState('')

  // Filters
  const [searchText, setSearchText] = useState('')
  const [filterRating, setFilterRating] = useState('all')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [stats, setStats] = useState({ visible: 0, hidden: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    document.title = 'Kiểm duyệt Đánh giá | VietTicket Admin'
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      reviewService.getAdminReviews({
        page,
        limit: PAGE_SIZE,
        search: searchText.trim(),
        rating: filterRating,
      })
      .then((result) => {
        if (active) {
          setReviews(result.data || [])
          setPagination(result.pagination || {
            total: (result.data || []).length,
            totalPages: 1,
          })
          setStats(result.stats || { visible: 0, hidden: 0 })
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message || 'Không thể tải danh sách đánh giá. Vui lòng thử lại.')
          setLoading(false)
        }
      })
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [filterRating, page, reloadKey, searchText])

  const handleToggleHide = async () => {
    if (!moderationTarget) return
    const reason = moderationReason.trim()
    if (reason.length < 10) {
      toast.warning('Vui lòng nhập lý do kiểm duyệt tối thiểu 10 ký tự.')
      return
    }
    const nextHiddenStatus = !moderationTarget.isHidden
    setActionId(moderationTarget.id)
    try {
      await reviewService.moderateReview(moderationTarget.id, nextHiddenStatus, reason)
      toast.success(
        nextHiddenStatus
          ? 'Đã ẩn đánh giá vi phạm thành công!'
          : 'Đã hiển thị lại đánh giá thành công!'
      )
      setModerationTarget(null)
      setModerationReason('')
      setReloadKey((value) => value + 1)
    } catch (err) {
      toast.error(err?.message || 'Không thể thực hiện kiểm duyệt. Vui lòng thử lại.')
    } finally {
      setActionId('')
    }
  }

  const handleResetFilters = () => {
    setSearchText('')
    setFilterRating('all')
    setPage(1)
  }

  const filteredReviews = reviews

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return isNaN(date.getTime()) ? dateStr : date.toLocaleDateString('vi-VN')
  }

  const activeCount = Number(stats.visible || 0)
  const hiddenCount = Number(stats.hidden || 0)

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
            onChange={(e) => {
              setSearchText(e.target.value)
              setPage(1)
            }}
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
            onChange={(e) => {
              setFilterRating(e.target.value)
              setPage(1)
            }}
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

              {!loading && error && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 40, color: 'var(--adm-outline)' }}>cloud_off</span>
                    <div style={{ marginTop: 8, color: 'var(--adm-outline)', fontWeight: 600 }}>{error}</div>
                    <button
                      type="button"
                      onClick={() => setReloadKey((value) => value + 1)}
                      style={{
                        marginTop: 16,
                        padding: '8px 20px',
                        borderRadius: 8,
                        background: 'var(--adm-primary-dark)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Thử lại
                    </button>
                  </td>
                </tr>
              )}

              {!loading && !error && filteredReviews.length === 0 && (
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
                          onClick={() => {
                            setModerationTarget(review)
                            setModerationReason('')
                          }}
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
                          onClick={() => {
                            setModerationTarget(review)
                            setModerationReason('')
                          }}
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
        <div className="admin-pagination">
          <p className="admin-pagination__info">
            Hiển thị <strong>{reviews.length}</strong> / <strong>{pagination.total}</strong> đánh giá
          </p>
          <div className="admin-pagination__controls">
            <button
              className="admin-pagination__btn"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            <button className="admin-pagination__btn active" disabled type="button">
              {page}/{pagination.totalPages}
            </button>
            <button
              className="admin-pagination__btn"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
              type="button"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {moderationTarget && (
        <div
          className="admin-modal-overlay"
          onClick={actionId ? undefined : () => setModerationTarget(null)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-moderation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="review-moderation-title" className="admin-modal__title">
              {moderationTarget.isHidden ? 'Hiển thị lại đánh giá' : 'Ẩn đánh giá vi phạm'}
            </h3>
            <p className="admin-modal__body">
              Ghi rõ căn cứ xử lý để khách hàng, đối tác và giảng viên có thể truy vết quyết định kiểm duyệt.
            </p>
            <label className="admin-field">
              <span>Lý do kiểm duyệt</span>
              <textarea
                value={moderationReason}
                onChange={(event) => setModerationReason(event.target.value)}
                maxLength={500}
                disabled={Boolean(actionId)}
                placeholder={
                  moderationTarget.isHidden
                    ? 'Ví dụ: Đã xác minh nội dung không vi phạm và khôi phục hiển thị.'
                    : 'Ví dụ: Nội dung chứa thông tin cá nhân và ngôn từ xúc phạm.'
                }
              />
            </label>
            <div className="admin-modal__actions">
              <button
                className="admin-modal__cancel"
                type="button"
                disabled={Boolean(actionId)}
                onClick={() => setModerationTarget(null)}
              >
                Hủy
              </button>
              <button
                className="admin-modal__confirm"
                type="button"
                disabled={Boolean(actionId) || moderationReason.trim().length < 10}
                onClick={() => void handleToggleHide()}
              >
                {actionId ? 'Đang xử lý…' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
