import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/auth/AccountLayout.jsx'
import { defaultUser } from '../context/authConstants.js'
import { useAuth } from '../context/useAuth.js'

const recentBookingImage =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDg08v00jscRj2H8v9bUuBlN8CAr_w8jVJn8yeVmjESBmnc8t-h9YsfZgK9K_L7q84N-NtEHTVYYVkJ_4kRdZsgt5LKFBveGgsjDYnEeIzB8Dumm5wrWwGfUWYxtKLMrtltoxT7RVRpCKtOy7tW_w-3P3nmbnljt6BOY7Im4-nSkRj6H3voMhc8hvFx4rBQjg_R2qSjdynSqLhzOQ9TYHCW77jPH0Lpk459lSDJzbUHGVZiwupKbm8wZ-lNchaaWueHMw5Lc2agvlA'

const savedAttractions = [
  {
    title: 'Tour đi bộ Phố cổ Hội An',
    price: 'từ 350.000 VND',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDIObQ2xqwRYlqftoiT3usAzPakG4WchG8cfnMekMSu42LqOqk91ASdQGxuQpnEC6-d_rpTOCDtd40sUqFm8O0BlqlRCd5XxW3Fn8YbglzE9cJN4VpHe_1twvorWRDfmIZQVZT4nW8ZvtlLfilKx9nqVV0Kqi7kooQ0Zyb0z1CElpo2JwpAT9PBjhhe46XT76L4DqMLDhME-PHjS6Pqew2o4KOY3XeNTVgxyBUhueckYVbK-dsQhMUJd3RdrbuaUnJIrfkZT9r2u74',
  },
  {
    title: 'Vé cáp treo Hòn Thơm',
    price: 'từ 600.000 VND',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB3EmmxTzeH7uD6QC_eEerSrJ9h0aUeuJ0fcKoVeRHBZGFONNQZcTRiOEaFg6BtNTw8He3hF096BrfZtwiuQ0GWYM_toyZfHfIS7UDpAX95ifs7wv8O7J-hynId1gW0ukJmhDVt-imnRDYxKY24EmrEa8IzgC4pkT8DyZ2rIeozGLIyqXi5yLMR8-aExscW7YtCNe2l12wDyqLxMUqqVxWgIpV5hQ27doOpCMkMD_YDgL6tl7k7ZcmO3o_aMNKKmSbkEXWPThKAELs',
  },
]

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
            <p>Vé demo tĩnh cho module đặt vé trong tương lai.</p>
          </div>
        </div>
        <div className="activity-list">
          <article className="activity-item">
            <img
              src={recentBookingImage}
              alt="Vé cáp treo và buffet Sun World Bà Nà Hills"
            />
            <div className="activity-item__content">
              <h3>Vé Sun World Bà Nà Hills - Cáp treo và Buffet</h3>
              <p>25/12/2026 · 2 người lớn · Đã thanh toán</p>
            </div>
            <strong className="activity-price">1,450,000 VND</strong>
          </article>
        </div>
      </section>

      <section className="account-card">
        <div className="account-card__header">
          <div>
            <h2>Điểm tham quan đã lưu</h2>
            <p>Các ý tưởng điểm tham quan Việt Nam bạn đã lưu.</p>
          </div>
        </div>
        <div className="activity-list">
          {savedAttractions.map((attraction) => (
            <article className="activity-item" key={attraction.title}>
              <img src={attraction.image} alt={attraction.title} />
              <div className="activity-item__content">
                <h3>{attraction.title}</h3>
                <p>Đã lưu để xem sau</p>
              </div>
              <strong className="activity-price">{attraction.price}</strong>
            </article>
          ))}
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
