import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth.js'

const NAV_ITEMS = [
  { to: '/partner/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/partner/attractions', icon: 'local_activity', label: 'Điểm tham quan', fillIcon: true },
  { to: '/partner/bookings', icon: 'confirmation_number', label: 'Đặt vé' },
  { to: '/partner/reports', icon: 'assessment', label: 'Báo cáo' },
  { to: '/partner/settings', icon: 'settings', label: 'Cài đặt' },
]

function PartnerLayout({ children, pageTitle = 'Partner Dashboard' }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
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
        <div className="font-bold text-lg text-[#00474d]">VietTicket B2B</div>
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined cursor-pointer">notifications</span>
          <span
            className="material-symbols-outlined cursor-pointer"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? 'close' : 'menu'}
          </span>
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
              onNavClick={() => setMobileMenuOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex flex-col h-full border-r border-[#bec8ca] py-8 px-4 bg-white shadow-sm w-64 flex-shrink-0">
        <SidebarContent user={user} initials={initials} onLogout={handleLogout} />
      </aside>

      {/* ── Main Canvas ── */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto pt-16 md:pt-0">
        {/* Desktop Top Bar */}
        <header className="hidden md:flex justify-between items-center w-full px-16 h-20 bg-white border-b border-[#e1e3e4] sticky top-0 z-40">
          <h1 className="text-2xl font-semibold text-[#191c1d]">{pageTitle}</h1>
          <div className="flex items-center gap-6">
            <div className="relative">
              <span className="material-symbols-outlined text-[#3f484a] cursor-pointer hover:text-[#00474d] transition-colors">
                notifications
              </span>
              <span className="absolute top-0 right-0 w-2 h-2 bg-[#ba1a1a] rounded-full" />
            </div>
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

function SidebarContent({ user, initials, onLogout, onNavClick }) {
  return (
    <>
      {/* Brand */}
      <div className="mb-8 px-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#00474d] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#00474d] truncate">
            {user?.fullName || 'Đối tác VietTicket'}
          </h2>
          <p className="text-xs text-[#3f484a]">Premium Partner</p>
        </div>
      </div>

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
          onClick={onLogout}
          className="flex items-center gap-3 px-4 py-3 text-[#ba1a1a] hover:bg-[#ffdad6] hover:text-[#93000a] rounded-lg transition-colors text-sm font-medium w-full"
        >
          <span className="material-symbols-outlined">logout</span>
          <span>Đăng xuất</span>
        </button>
      </div>
    </>
  )
}

export default PartnerLayout
