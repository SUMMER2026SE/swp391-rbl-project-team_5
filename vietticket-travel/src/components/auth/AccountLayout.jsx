import { Link, useNavigate } from 'react-router-dom'
import { defaultUser } from '../../context/authConstants.js'
import { useAuth } from '../../context/useAuth.js'

const navItems = [
  { label: 'Hồ sơ của tôi', icon: 'person', to: '/profile', active: 'profile' },
  { label: 'Đặt chỗ gần đây', icon: 'confirmation_number', to: '/profile' },
  { label: 'Điểm đã lưu', icon: 'favorite', to: '/profile' },
  { label: 'Phương thức thanh toán', icon: 'credit_card', to: '/profile' },
  {
    label: 'Đổi mật khẩu',
    icon: 'lock_reset',
    to: '/change-password',
    active: 'password',
  },
]

function AccountLayout({ active = 'profile', children }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const currentUser = user || defaultUser
  const visibleNavItems =
    currentUser.provider === 'GOOGLE'
      ? navItems.filter((item) => item.active !== 'password')
      : navItems

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <div className="account-page">
      <header className="account-header">
        <div className="container account-header__inner">
          <Link className="auth-brand" to="/">
            <span className="material-symbols-outlined filled" aria-hidden="true">
              travel
            </span>
            VietTicket Travel
          </Link>
          <div className="account-header__actions">
            <Link className="text-button" to="/">
              Trang chủ
            </Link>
            <button className="text-button" type="button" onClick={handleLogout}>
              Đăng xuất
            </button>
            <Link className="account-avatar" to="/profile" aria-label="Mở hồ sơ">
              <img
                src={currentUser.avatar}
                alt={`Ảnh đại diện của ${currentUser.fullName}`}
              />
            </Link>
          </div>
        </div>
      </header>

      <div className="account-shell">
        <aside className="account-sidebar" aria-label="Điều hướng tài khoản">
          <div className="account-sidebar__profile">
            <div className="account-avatar">
              <img
                src={currentUser.avatar}
                alt={`Ảnh đại diện của ${currentUser.fullName}`}
              />
            </div>
            <div>
              <h2>{currentUser.fullName}</h2>
              <p>{currentUser.email}</p>
            </div>
            <span className="account-badge">
              <span className="material-symbols-outlined filled" aria-hidden="true">
                workspace_premium
              </span>
              Nhà khám phá cao cấp
            </span>
          </div>

          <nav className="account-nav">
            {visibleNavItems.map((item) => (
              <Link
                className={item.active === active ? 'active' : ''}
                key={item.label}
                to={item.to}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
            <button type="button" onClick={handleLogout}>
              <span className="material-symbols-outlined" aria-hidden="true">
                logout
              </span>
              Đăng xuất
            </button>
          </nav>
        </aside>

        <main className="account-main">{children}</main>
      </div>
    </div>
  )
}

export default AccountLayout
