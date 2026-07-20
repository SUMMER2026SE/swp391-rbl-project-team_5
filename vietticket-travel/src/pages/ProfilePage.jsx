import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/auth/AccountLayout.jsx'
import { defaultUser } from '../context/authConstants.js'
import { useAuth } from '../context/useAuth.js'
import bookingService from '../services/bookingService.js'
import { getFavorites, getFavoriteItems } from '../services/favoriteApi.js'
import { formatBookingReference } from '../utils/bookingReference.js'
import { hasRole } from '../utils/userRoles.js'

const fallbackImage =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80'

const formatCurrency = (value) =>
  `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} VND`

const formatDate = (value) => {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

const formatBookingCode = formatBookingReference

const getGenderLabel = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (['male', 'nam'].includes(normalized)) return 'Nam'
  if (['female', 'nữ', 'nu'].includes(normalized)) return 'Nữ'
  if (['other', 'khác', 'khac'].includes(normalized)) return 'Khác'
  return 'Chưa cập nhật'
}

const getAttraction = (favorite) => favorite.attraction || favorite

const getAttractionImage = (attraction) => {
  if (!attraction) return fallbackImage
  if (attraction.primaryImage) return attraction.primaryImage
  if (attraction.imageUrl) return attraction.imageUrl
  if (Array.isArray(attraction.images) && attraction.images.length > 0) {
    const primary = attraction.images.find((image) => image.isPrimary)
    return primary?.imageUrl || attraction.images[0]?.imageUrl || fallbackImage
  }
  return fallbackImage
}

function ProfilePage() {
  const navigate = useNavigate()
  const { user, logout, getProfile } = useAuth()
  const [error, setError] = useState('')
  const currentUser = user || defaultUser
  const isOperationalUser = hasRole(currentUser, 'ADMIN')
    || hasRole(currentUser, 'STAFF')
    || hasRole(currentUser, 'PARTNER')

  const [recentBookings, setRecentBookings] = useState([])
  const [savedAttractions, setSavedAttractions] = useState([])
  const [loadingBookings, setLoadingBookings] = useState(true)
  const [loadingFavorites, setLoadingFavorites] = useState(true)

  useEffect(() => {
    document.title = 'Hồ sơ của tôi | VietTicket Travel'
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadProfile() {
      const result = await getProfile()

      if (!isMounted) return

      if (!result.ok) {
        setError(result.message || 'Không thể tải hồ sơ.')

        if (result.status === 401) {
          navigate('/login', {
            replace: true,
            state: { from: { pathname: '/profile' } },
          })
        }
      }
    }

    loadProfile()

    return () => {
      isMounted = false
    }
  }, [getProfile, navigate])

  useEffect(() => {
    let active = true

    bookingService.getBookings()
      .then((data) => {
        if (active) setRecentBookings(data.slice(0, 3))
      })
      .catch((err) => console.error("Lỗi tải đặt chỗ:", err))
      .finally(() => {
        if (active) setLoadingBookings(false)
      })

    getFavorites()
      .then((res) => {
        if (active) setSavedAttractions(getFavoriteItems(res).slice(0, 3))
      })
      .catch((err) => console.error("Lỗi tải yêu thích:", err))
      .finally(() => {
        if (active) setLoadingFavorites(false)
      })

    return () => {
      active = false
    }
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/', { replace: true })
  }

  return (
    <AccountLayout active="profile">
      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h1>Hồ sơ của tôi</h1>
            <p>
              {isOperationalUser
                ? 'Xem thông tin tài khoản và thiết lập bảo mật của bạn.'
                : 'Xem thông tin tài khoản và tùy chọn đặt vé du lịch của bạn.'}
            </p>
          </div>
          <div className="profile-actions-row">
            <Link className="auth-secondary-button" to="/edit-profile">
              Chỉnh sửa hồ sơ
            </Link>
            {currentUser.provider !== 'GOOGLE' ? (
              <Link className="auth-secondary-button" to="/change-password">
                Đổi mật khẩu
              </Link>
            ) : null}
            <button className="auth-submit" type="button" onClick={handleLogout}>
              Đăng xuất
            </button>
          </div>
        </div>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="profile-grid">
          <div className="profile-field">
            <span>Họ và tên</span>
            <p>{currentUser.fullName}</p>
          </div>
          <div className="profile-field">
            <span>Địa chỉ email</span>
            <p>{currentUser.email}</p>
          </div>
          <div className="profile-field">
            <span>Số điện thoại</span>
            <p>{currentUser.phone || 'Chưa cập nhật'}</p>
          </div>
          <div className="profile-field">
            <span>Ngày sinh</span>
            <p>{formatDate(currentUser.dateOfBirth)}</p>
          </div>
          <div className="profile-field">
            <span>Giới tính</span>
            <p>{getGenderLabel(currentUser.gender)}</p>
          </div>
          <div className="profile-field">
            <span>Địa chỉ</span>
            <p>{currentUser.address || 'Chưa cập nhật'}</p>
          </div>
          <div className="profile-field">
            <span>Nhà cung cấp đăng nhập</span>
            <p>{currentUser.provider === 'GOOGLE' ? 'Google' : 'Email và mật khẩu'}</p>
          </div>
        </div>

        <div className="status-row" aria-label="Huy hiệu tài khoản">
          <span className="status-pill">
            <span className="material-symbols-outlined filled" aria-hidden="true">
              badge
            </span>
            Vai trò: {currentUser.roleLabel || 'Khách hàng'}
          </span>
          <span className="status-pill">
            <span className="material-symbols-outlined filled" aria-hidden="true">
              check_circle
            </span>
            Trạng thái tài khoản: {currentUser.statusLabel || 'Hoạt động'}
          </span>
          <span className="status-pill">
            <span className="material-symbols-outlined filled" aria-hidden="true">
              verified
            </span>
            Xác minh email: {currentUser.emailVerified ? 'Đã xác minh' : 'Chưa xác minh'}
          </span>
        </div>
      </section>

      {!isOperationalUser && <>
      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Đặt chỗ gần đây</h2>
            <p>Lịch sử đặt vé tham quan của bạn.</p>
          </div>
          {recentBookings.length > 0 && (
            <Link className="auth-secondary-button" to="/my-tickets" style={{ width: 'auto', minHeight: 'auto', padding: '6px 16px', fontSize: '13px' }}>
              Xem tất cả
            </Link>
          )}
        </div>
        {loadingBookings ? (
          <div className="activity-list">
            <p className="auth-helper">Đang tải danh sách đặt vé...</p>
          </div>
        ) : recentBookings.length === 0 ? (
          <div className="activity-list activity-list--empty">
            <span className="material-symbols-outlined" aria-hidden="true">confirmation_number</span>
            <p>Bạn chưa có đặt chỗ nào. Hãy khám phá các điểm tham quan!</p>
          </div>
        ) : (
          <div className="activity-list">
            {recentBookings.map((booking) => {
              const bookingId = booking.id ?? booking.bookingId ?? ''
              return (
                <Link
                  to={bookingId ? `/tickets/${bookingId}` : '/my-tickets'}
                  className="activity-item"
                  key={bookingId || booking.reservationId}
                >
                  <img src={booking.attractionImage || fallbackImage} alt={booking.attractionTitle} />
                  <div className="activity-item__content">
                    <h4 style={{ fontWeight: 'bold', fontSize: '15px' }}>{booking.attractionTitle}</h4>
                    <p>Mã: {formatBookingCode(bookingId)} · SL: {booking.quantity || 1} vé</p>
                    <p>Ngày đi: {formatDate(booking.visitDate)}</p>
                  </div>
                  <div className="activity-price">{formatCurrency(booking.totalAmount)}</div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Điểm tham quan đã lưu</h2>
            <p>Các ý tưởng điểm tham quan Việt Nam bạn đã lưu.</p>
          </div>
          {savedAttractions.length > 0 && (
            <Link className="auth-secondary-button" to="/favorites" style={{ width: 'auto', minHeight: 'auto', padding: '6px 16px', fontSize: '13px' }}>
              Xem tất cả
            </Link>
          )}
        </div>
        {loadingFavorites ? (
          <div className="activity-list">
            <p className="auth-helper">Đang tải điểm tham quan đã lưu...</p>
          </div>
        ) : savedAttractions.length === 0 ? (
          <div className="activity-list activity-list--empty">
            <span className="material-symbols-outlined" aria-hidden="true">favorite</span>
            <p>Bạn chưa lưu điểm tham quan nào.</p>
          </div>
        ) : (
          <div className="activity-list">
            {savedAttractions.map((item) => {
              const attraction = getAttraction(item)
              return (
                <Link to={`/attractions/${attraction.id}`} className="activity-item" key={attraction.id}>
                  <img src={getAttractionImage(attraction)} alt={attraction.title || attraction.name} />
                  <div className="activity-item__content">
                    <h4 style={{ fontWeight: 'bold', fontSize: '15px' }}>{attraction.title || attraction.name}</h4>
                    <p>{attraction.city || attraction.location || 'Việt Nam'}</p>
                    <p style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary)', fontSize: '13px', fontWeight: 'bold' }}>
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1", fontSize: '16px' }}>star</span>
                      {attraction.averageRating ? Number(attraction.averageRating).toFixed(1) : 'New'}
                    </p>
                  </div>
                  <div className="activity-price" style={{ fontSize: '13px', fontWeight: 'bold' }}>Xem chi tiết</div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span className="material-symbols-outlined" aria-hidden="true">
            credit_card
          </span>
          <h3>Phương thức thanh toán</h3>
          <p>Thanh toán an toàn qua VNPay và nhận cập nhật trạng thái ngay sau giao dịch.</p>
        </article>
        <article className="summary-card">
          <span className="material-symbols-outlined" aria-hidden="true">
            security
          </span>
          <h3>Bảo mật tài khoản</h3>
          <p>{currentUser.emailVerified ? 'Email đã được xác minh.' : 'Email chưa xác minh.'} Bạn có thể đổi mật khẩu trong phần cài đặt tài khoản.</p>
        </article>
        <article className="summary-card">
          <span className="material-symbols-outlined" aria-hidden="true">
            qr_code_2
          </span>
          <h3>Vé điện tử QR</h3>
          <p>Vé đủ điều kiện sẽ có mã QR trong mục Vé của tôi để sử dụng khi check-in.</p>
        </article>
      </section>
      </>}
    </AccountLayout>
  )
}

export default ProfilePage
