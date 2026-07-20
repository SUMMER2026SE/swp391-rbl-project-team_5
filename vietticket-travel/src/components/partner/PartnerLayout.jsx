import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth.js'

const NAV_ITEMS = [
  { to: '/partner/dashboard', icon: 'dashboard', label: 'Tổng quan' },
  { to: '/partner/attractions', icon: 'local_activity', label: 'Điểm tham quan', fillIcon: true },
  { to: '/partner/bookings', icon: 'confirmation_number', label: 'Đặt vé' },
  { to: '/partner/staff', icon: 'groups', label: 'Nhân viên' },
  { to: '/partner/reviews', icon: 'rate_review', label: 'Đánh giá' },
  { to: '/partner/reports', icon: 'assessment', label: 'Báo cáo' },
  { to: '/partner/settlements', icon: 'account_balance_wallet', label: 'Đối soát & chi trả' },
  { to: '/partner/settings', icon: 'settings', label: 'Cài đặt' },
]

function PartnerLayout({ children, pageTitle = 'Partner Dashboard' }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  const initials = user?.fullName
    ? user.fullName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'P'

  return (
    <div
      className="text-[#191c1d] bg-[#f8fafb] h-screen flex overflow-hidden"
      style={{ fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif" }}
    >
      {/* ── Mobile Top Nav ── */}
      <nav className="md:hidden bg-white text-[#00474d] shadow-sm flex justify-between items-center w-full px-5 h-16 fixed top-0 z-50">
        <Link to="/partner/dashboard" className="font-bold text-lg text-[#00474d]" style={{ textDecoration: 'none' }} title="Về tổng quan đối tác">
          VietTicket B2B
        </Link>
        <div className="flex items-center gap-4">
          <Link
            to="/partner/bookings"
            className="material-symbols-outlined text-[#3f484a]"
            aria-label="Xem đơn đặt vé"
          >
            confirmation_number
          </Link>
          <button
            type="button"
            className="material-symbols-outlined"
            aria-label={mobileMenuOpen ? 'Đóng trình đơn' : 'Mở trình đơn'}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? 'close' : 'menu'}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="absolute left-0 top-16 h-[calc(100%-4rem)] w-64 bg-white shadow-xl flex flex-col py-6 px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent
              user={user}
              initials={initials}
              onLogout={handleLogout}
              isLoggingOut={isLoggingOut}
              onNavClick={() => setMobileMenuOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex flex-col h-full border-r border-[#bec8ca] py-8 px-4 bg-white shadow-sm w-64 flex-shrink-0">
        <SidebarContent user={user} initials={initials} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
      </aside>

      {/* ── Main Canvas ── */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto pt-16 md:pt-0">
        {/* Desktop Top Bar */}
        <header className="hidden md:flex justify-between items-center w-full px-16 h-20 bg-white border-b border-[#e1e3e4] sticky top-0 z-40">
          <h1 className="text-2xl font-semibold text-[#191c1d]">{pageTitle}</h1>
          <div className="flex items-center gap-6">
            <Link
              to="/partner/bookings"
              className="material-symbols-outlined text-[#3f484a] hover:text-[#00474d] transition-colors"
              aria-label="Xem đơn đặt vé"
            >
              confirmation_number
            </Link>
            <Link
              to="/profile"
              className="flex items-center gap-2 cursor-pointer hover:bg-[#f2f4f5] p-2 rounded-lg transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-[#006068] text-white flex items-center justify-center text-xs font-bold">
                {initials}
              </div>
              <span className="material-symbols-outlined text-[#3f484a]">expand_more</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-5 md:p-16 w-full max-w-[1280px] mx-auto flex flex-col gap-6">
          {children}
        </div>
      </main>
    </div>
  )
}

function SidebarContent({ user, initials, onLogout, isLoggingOut, onNavClick }) {
  return (
    <>
      {/* Brand */}
      <Link
        to="/partner/dashboard"
        className="mb-8 px-4 flex items-center gap-3 hover:opacity-90 transition-opacity"
        style={{ textDecoration: 'none' }}
        title="Về tổng quan đối tác"
      >
        <div className="w-10 h-10 rounded-lg bg-[#00474d] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#00474d] truncate">
            {user?.fullName || 'Đối tác VietTicket'}
          </h2>
          <p className="text-xs text-[#3f484a]">Cổng vận hành đối tác</p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-sm font-medium ${
                isActive
                  ? 'bg-[#cfe5ff] text-[#003558] font-semibold'
                  : 'text-[#3f484a] hover:bg-[#eceeef]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className="material-symbols-outlined"
                  style={isActive && item.fillIcon ? { fontVariationSettings: "'FILL' 1" } : {}}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto pt-4 border-t border-[#bec8ca] flex flex-col gap-1">
        <a
          href="mailto:partners@vietticket.com"
          className="flex items-center gap-3 px-4 py-3 text-[#3f484a] hover:bg-[#eceeef] rounded-lg transition-colors text-sm font-medium"
        >
          <span className="material-symbols-outlined">contact_support</span>
          <span>Hỗ trợ</span>
        </a>
        <button
          type="button"
          onClick={onLogout}
          disabled={isLoggingOut}
          className="flex items-center gap-3 px-4 py-3 text-[#ba1a1a] hover:bg-[#ffdad6] hover:text-[#93000a] rounded-lg transition-colors text-sm font-medium w-full"
        >
          <span className="material-symbols-outlined">logout</span>
          <span>{isLoggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}</span>
        </button>
      </div>
    </>
  )
}

export default PartnerLayout
