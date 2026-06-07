import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { defaultUser } from '../context/authConstants.js'
import { useAuth } from '../context/useAuth.js'

function Header({ links }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, logout, user } = useAuth()

  const closeMenu = () => setIsMenuOpen(false)
  const firstName = user?.fullName?.split(' ')[0] || 'Hồ sơ'
  const avatar = user?.avatar || defaultUser.avatar

  const handleLogout = () => {
    logout()
    closeMenu()
    navigate('/')
  }

  const isHomePage = location.pathname === '/'

  return (
    <header className="site-header">
      <nav className="site-nav container" aria-label="Điều hướng chính">
        <Link className="brand" to="/" onClick={closeMenu}>
          VietTicket Travel
        </Link>

        <div className="desktop-nav">
          {links.map((link) => {
            const isHash = link.href.startsWith('#')
            if (isHash && isHomePage) {
              return (
                <a
                  className={`nav-link${link.active ? ' nav-link--active' : ''}`}
                  href={link.href}
                  key={link.label}
                >
                  {link.label}
                </a>
              )
            }
            const toPath = isHash ? `/${link.href}` : link.href
            return (
              <Link
                className={`nav-link${link.active ? ' nav-link--active' : ''}`}
                to={toPath}
                key={link.label}
              >
                {link.label}
              </Link>
            )
          })}
        </div>

        <div className="header-actions">
          <button className="icon-button" type="button" aria-label="Đổi ngôn ngữ">
            <span className="material-symbols-outlined" aria-hidden="true">
              language
            </span>
          </button>
          {isAuthenticated ? (
            <>
              {user?.role === 'ADMIN' && (
                <Link className="text-button" to="/admin/users" style={{ marginRight: '4px', color: 'var(--color-primary)', fontWeight: 'bold' }}>
                  Trang quản trị
                </Link>
              )}
              {user?.role === 'PARTNER' && (
                <Link
                  className="text-button"
                  to="/partner/dashboard"
                  style={{ marginRight: '4px', color: 'var(--color-primary)', fontWeight: 'bold' }}
                >
                  Cổng đối tác
                </Link>
              )}
              <Link className="header-profile-link" to="/profile">
                <span className="header-avatar" aria-hidden="true">
                  <img src={avatar} alt="" />
                </span>
                {firstName}
              </Link>
              <button className="text-button" type="button" onClick={handleLogout}>
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <Link
                className="text-button"
                to="/partner/register"
                style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
              >
                Đối tác
              </Link>
              <Link className="text-button" to="/login">
                Đăng nhập
              </Link>
              <Link className="button button--primary button--compact" to="/register">
                Đăng ký
              </Link>
            </>
          )}
        </div>

        <button
          className="mobile-menu-button"
          type="button"
          aria-expanded={isMenuOpen}
          aria-controls="mobile-menu"
          aria-label="Mở hoặc đóng menu điều hướng"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {isMenuOpen ? 'close' : 'menu'}
          </span>
        </button>
      </nav>

      <div
        className={`mobile-menu${isMenuOpen ? ' mobile-menu--open' : ''}`}
        id="mobile-menu"
      >
        <div className="mobile-menu__inner container">
          {links.map((link) => {
            const isHash = link.href.startsWith('#')
            if (isHash && isHomePage) {
              return (
                <a href={link.href} key={link.label} onClick={closeMenu}>
                  {link.label}
                </a>
              )
            }
            const toPath = isHash ? `/${link.href}` : link.href
            return (
              <Link to={toPath} key={link.label} onClick={closeMenu}>
                {link.label}
              </Link>
            )
          })}
          <div className="mobile-menu__actions">
            {isAuthenticated ? (
              <>
                {user?.role === 'ADMIN' && (
                  <Link className="button button--secondary" to="/admin/users" onClick={closeMenu} style={{ marginBottom: '8px', display: 'block', width: '100%', textAlign: 'center' }}>
                    Trang quản trị
                  </Link>
                )}
                {user?.role === 'PARTNER' && (
                  <Link className="button button--secondary" to="/partner/dashboard" onClick={closeMenu} style={{ marginBottom: '8px', display: 'block', width: '100%', textAlign: 'center' }}>
                    Cổng đối tác
                  </Link>
                )}
                <Link className="button button--primary" to="/profile" onClick={closeMenu}>
                  Hồ sơ
                </Link>
                <button className="text-button" type="button" onClick={handleLogout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <>
                <Link className="button button--secondary" to="/partner/register" onClick={closeMenu} style={{ marginBottom: '8px', display: 'block', width: '100%', textAlign: 'center' }}>
                  Trở thành đối tác
                </Link>
                <Link className="text-button" to="/login" onClick={closeMenu}>
                  Đăng nhập
                </Link>
                <Link className="button button--primary" to="/register" onClick={closeMenu}>
                  Đăng ký
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
