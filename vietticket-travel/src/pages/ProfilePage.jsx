import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/auth/AccountLayout.jsx'
import { defaultUser } from '../context/authConstants.js'
import { useAuth } from '../context/useAuth.js'

function ProfilePage() {
  const navigate = useNavigate()
  const { user, logout, getProfile } = useAuth()
  const [error, setError] = useState('')
  const currentUser = user || defaultUser

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

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <AccountLayout active="profile">
      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h1>Hồ sơ của tôi</h1>
            <p>Xem thông tin tài khoản và tùy chọn đặt vé du lịch của bạn.</p>
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
            <p>
              {currentUser.dateOfBirth
                ? new Date(currentUser.dateOfBirth).toLocaleDateString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                : 'Chưa cập nhật'}
            </p>
          </div>
          <div className="profile-field">
            <span>Giới tính</span>
            <p>
              {currentUser.gender
                ? currentUser.gender.charAt(0).toUpperCase() + currentUser.gender.slice(1)
                : 'Chưa cập nhật'}
            </p>
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

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Đặt chỗ gần đây</h2>
            <p>Lịch sử đặt vé tham quan của bạn.</p>
          </div>
        </div>
        <div className="activity-list activity-list--empty">
          <span className="material-symbols-outlined" aria-hidden="true">confirmation_number</span>
          <p>Bạn chưa có đặt chỗ nào. Hãy khám phá các điểm tham quan!</p>
        </div>
      </section>

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Điểm tham quan đã lưu</h2>
            <p>Các ý tưởng điểm tham quan Việt Nam bạn đã lưu.</p>
          </div>
        </div>
        <div className="activity-list activity-list--empty">
          <span className="material-symbols-outlined" aria-hidden="true">favorite</span>
          <p>Bạn chưa lưu điểm tham quan nào.</p>
        </div>
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span className="material-symbols-outlined" aria-hidden="true">
            credit_card
          </span>
          <h3>Phương thức thanh toán</h3>
          <p>Thẻ Visa kết thúc bằng 4242. Tích hợp thanh toán sẽ làm sau.</p>
        </article>
        <article className="summary-card">
          <span className="material-symbols-outlined" aria-hidden="true">
            security
          </span>
          <h3>Bảo mật tài khoản</h3>
          <p>Email đã xác minh, mật khẩu đã hash ở backend, JWT bảo vệ API.</p>
        </article>
        <article className="summary-card">
          <span className="material-symbols-outlined" aria-hidden="true">
            qr_code_2
          </span>
          <h3>Vé điện tử QR</h3>
          <p>Các đặt chỗ sau này sẽ hiển thị tại đây cùng vé QR.</p>
        </article>
      </section>
    </AccountLayout>
  )
}

export default ProfilePage
