import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import '../../styles/admin.css';
import { hasRole } from '../../utils/userRoles.js';

const ADMIN_AVATAR =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA9EMAVDAxQX5keC0ppG7FjHNkygtjkzXcw0hT0QB1cxg0hnSB-Sid71KvctqqRsGyAMVqLjnrJRH68NAgYTDXd2o6RVsvBVEJ8joIqcsiYMN9MN4LK5di-MyY0ObRNofSUIx5SbiNksKAd-ftWk5CQOgBWlDJp8zMRLckW2P9WYpu93XKJqt0tvjkLJygFt6mYYoCWlNouapEC2n3Ptzkp5XQkmAppY7oSkOO0a4f-enxzB1EkhOftLzxD1LKc5Gs0WOGoJx0tOj3D';

const NAV_ITEMS_ADMIN = [
  { to: '/admin',                     icon: 'dashboard',      label: 'Tổng quan',          end: true },
  { to: '/admin/bookings',            icon: 'receipt_long',   label: 'Đặt vé & Thanh toán' },
  { to: '/admin/reports',             icon: 'finance',        label: 'Báo cáo tài chính' },
  { to: '/admin/settlements',         icon: 'request_quote',  label: 'Đối soát đối tác' },
  { to: '/admin/kyc-approval',        icon: 'verified_user',  label: 'Duyệt hồ sơ KYC' },
  { to: '/admin/attraction-approval', icon: 'location_on',    label: 'Duyệt địa điểm' },
  { to: '/admin/violations',          icon: 'report_problem', label: 'Quản lý vi phạm' },
  { to: '/admin/categories',          icon: 'category',       label: 'Quản lý danh mục' },
  { to: '/admin/vouchers',            icon: 'confirmation_number', label: 'Quản lý voucher' },
  { to: '/admin/reviews',             icon: 'rate_review',    label: 'Kiểm duyệt Đánh giá' },
  { to: '/admin/users',               icon: 'manage_accounts', label: 'Quản lý người dùng' },
  { to: '/admin/audit-logs',          icon: 'history',         label: 'Nhật ký kiểm toán' },
];

const NAV_ITEMS_CHECKIN_STAFF = [
  { to: '/staff/checkin', icon: 'qr_code_scanner', label: 'Check-in vé' },
  { to: '/staff/smart-queue', icon: 'queue', label: 'SmartQueue Control Tower' },
];

const NAV_ITEMS_PLATFORM_STAFF = [
  { to: '/staff/tickets', icon: 'support_agent', label: 'Hỗ trợ khách hàng' },
  { to: '/staff/refunds', icon: 'currency_exchange', label: 'Quản lý hoàn tiền' },
  { to: '/admin/reviews', icon: 'rate_review', label: 'Kiểm duyệt đánh giá' },
];


export default function AdminSidebar({ isOpen, onClose }) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isAdmin = hasRole(user, 'ADMIN');
  const isPartnerStaff = hasRole(user, 'STAFF') && Boolean(user?.employerPartnerId);
  const isPlatformStaff = hasRole(user, 'STAFF') && !user?.employerPartnerId;
  const staffNavItems = [
    ...(isAdmin || isPartnerStaff ? NAV_ITEMS_CHECKIN_STAFF : []),
    ...(isAdmin || isPlatformStaff ? NAV_ITEMS_PLATFORM_STAFF : []),
  ];
  const portalTitle = isAdmin ? 'VietTicket Admin' : 'VietTicket Operations';
  const portalSubtitle = isAdmin
    ? 'Cổng quản trị'
    : isPartnerStaff
      ? 'Vận hành check-in'
      : 'CSKH nền tảng';

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <aside className={`admin-sidebar${isOpen ? ' admin-sidebar--open' : ''}`} style={{ background: 'var(--adm-primary-dark)' }}>
      {/* Brand */}
      <div className="admin-sidebar__brand" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Link to="/" style={{ textDecoration: 'none' }} title="Về trang chủ khách hàng">
            <h1 style={{ color: '#fff', cursor: 'pointer' }} className="hover:opacity-90 transition-opacity">{portalTitle}</h1>
          </Link>
          <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0 }}>{portalSubtitle}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden text-white/70 hover:text-white border-0 bg-transparent cursor-pointer p-1"
            aria-label="Đóng menu"
            type="button"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>close</span>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="admin-sidebar__nav" style={{ padding: '12px 12px', flex: 1, overflowY: 'auto' }}>
        {isAdmin && (
          <>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 12px 8px' }}>Quản trị hệ thống</p>
            {NAV_ITEMS_ADMIN.map(({ to, icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  'admin-sidebar__nav-link' + (isActive ? ' admin-sidebar__nav-link--active-dark' : ' admin-sidebar__nav-link--dark')
                }
              >
                <span className="material-symbols-outlined">{icon}</span>
                <span>{label}</span>
              </NavLink>
            ))}
          </>
        )}
        {/* Công cụ nhân viên hiển thị theo đúng phân quyền backend. */}
        {staffNavItems.length > 0 && (
          <>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '16px 12px 8px' }}>Công cụ nhân viên</p>
            {staffNavItems.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  'admin-sidebar__nav-link' + (isActive ? ' admin-sidebar__nav-link--active-dark' : ' admin-sidebar__nav-link--dark')
                }
              >
                <span className="material-symbols-outlined">{icon}</span>
                <span>{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="admin-sidebar__footer" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <Link
          to="/profile"
          className="admin-sidebar__footer-link"
          style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}
        >
          <span className="material-symbols-outlined">settings</span>
          <span>Cài đặt</span>
        </Link>
        <button
          type="button"
          className="admin-sidebar__logout"
          style={{ color: 'rgba(255,255,255,0.7)' }}
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          <span className="material-symbols-outlined">logout</span>
          <span>{isLoggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</span>
        </button>

        <Link 
          to="/profile" 
          className="admin-sidebar__profile" 
          style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 12, textDecoration: 'none', cursor: 'pointer' }}
        >
          <img
            className="admin-sidebar__avatar"
            src={user?.avatar || ADMIN_AVATAR}
            alt="Admin Avatar"
          />
          <div>
            <p className="admin-sidebar__profile-name" style={{ color: '#fff' }}>{user?.fullName || 'Admin'}</p>
            <p className="admin-sidebar__profile-role" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {isAdmin
                ? 'Quản trị viên'
                : user?.employerPartnerId
                ? 'Nhân viên đối tác'
                : 'Nhân viên hỗ trợ'}
            </p>
          </div>
        </Link>
      </div>
    </aside>
  );
}
