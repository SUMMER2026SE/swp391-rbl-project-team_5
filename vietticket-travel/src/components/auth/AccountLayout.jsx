import { Link, useNavigate } from 'react-router-dom'
import { defaultUser } from '../../context/authConstants.js'
import { useAuth } from '../../context/useAuth.js'

const navItems = [
  { label: 'Hồ sơ của tôi', icon: 'person', to: '/profile', active: 'profile' },
  {
    label: 'Vé của tôi',
    icon: 'confirmation_number',
    to: '/my-tickets',
    active: 'bookings',
  },
  {
    label: 'Điểm đã lưu',
    icon: 'favorite',
    to: '/favorites',
    active: 'saved',
  },
  {
    label: 'Lịch sử hỗ trợ',
    icon: 'support_agent',
    to: '/my-support',
    active: 'support',
  },
  {
    label: 'Phương thức thanh toán',
    icon: 'credit_card',
    to: null,
    active: 'payment',
    comingSoon: true,
  },
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
            {currentUser?.role === 'ADMIN' && (
              <Link className="text-button" to="/admin">
                Trang quản trị
              </Link>
            )}
            {currentUser?.role === 'STAFF' && (
              <Link className="text-button" to="/staff/tickets">
                Cổng nhân viên
              </Link>
            )}
            {currentUser?.role === 'PARTNER' && (
              <Link className="text-button" to="/partner/dashboard">
                Cổng đối tác
              </Link>
            )}
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
          </div>

          <nav className="account-nav">
            {currentUser?.role === 'ADMIN' && (
              <Link to="/admin">
                <span className="material-symbols-outlined" aria-hidden="true">
                  admin_panel_settings
                </span>
                Trang quản trị
              </Link>
            )}
            {currentUser?.role === 'STAFF' && (
              <Link to="/staff/tickets">
                <span className="material-symbols-outlined" aria-hidden="true">
                  support_agent
                </span>
                Cổng nhân viên
              </Link>
            )}
            {currentUser?.role === 'PARTNER' && (
              <Link to="/partner/dashboard">
                <span className="material-symbols-outlined" aria-hidden="true">
                  dashboard
                </span>
                Cổng đối tác
              </Link>
            )}
            {visibleNavItems.map((item) =>
              item.comingSoon ? (
                <span
                  className="account-nav-item--disabled"
                  key={item.label}
                  title="Tính năng đang phát triển"
                  aria-disabled="true"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                  <span className="account-nav-badge">Sắp ra mắt</span>
                </span>
              ) : (
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
              ),
            )}
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
