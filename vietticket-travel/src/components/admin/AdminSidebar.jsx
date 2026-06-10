import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import '../../styles/admin.css';

const ADMIN_AVATAR =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA9EMAVDAxQX5keC0ppG7FjHNkygtjkzXcw0hT0QB1cxg0hnSB-Sid71KvctqqRsGyAMVqLjnrJRH68NAgYTDXd2o6RVsvBVEJ8joIqcsiYMN9MN4LK5di-MyY0ObRNofSUIx5SbiNksKAd-ftWk5CQOgBWlDJp8zMRLckW2P9WYpu93XKJqt0tvjkLJygFt6mYYoCWlNouapEC2n3Ptzkp5XQkmAppY7oSkOO0a4f-enxzB1EkhOftLzxD1LKc5Gs0WOGoJx0tOj3D';

const NAV_ITEMS = [
  { to: '/admin',                     icon: 'dashboard',      label: 'Tổng quan',          end: true },
  { to: '/admin/kyc-approval',        icon: 'verified_user',  label: 'Duyệt hồ sơ KYC' },
  { to: '/admin/attraction-approval', icon: 'location_on',    label: 'Duyệt địa điểm' },
  { to: '/admin/violations',          icon: 'report_problem', label: 'Quản lý vi phạm' },
  { to: '/admin/categories',          icon: 'category',       label: 'Quản lý danh mục' },
  { to: '/admin/reviews',             icon: 'rate_review',    label: 'Kiểm duyệt Đánh giá' },
];


export default function AdminSidebar() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    const ok = window.confirm("Bạn có chắc chắn muốn đăng xuất khỏi cổng quản trị không?");
    if (!ok) return;
    await logout();
    navigate('/login');
  };

  return (
    <aside className="admin-sidebar" style={{ background: 'var(--adm-primary-dark)' }}>
      {/* Brand */}
      <div className="admin-sidebar__brand" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <h1 style={{ color: '#fff' }}>VietTicket Admin</h1>
        <p style={{ color: 'rgba(255,255,255,0.7)' }}>Management Portal</p>
      </div>

      {/* Navigation */}
      <nav className="admin-sidebar__nav" style={{ padding: '12px 12px', flex: 1 }}>
        {NAV_ITEMS.map(({ to, icon, label, end }) => (
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
          className="admin-sidebar__logout"
          style={{ color: 'rgba(255,255,255,0.7)' }}
          onClick={handleLogout}
        >
          <span className="material-symbols-outlined">logout</span>
          <span>Đăng xuất</span>
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
            <p className="admin-sidebar__profile-role" style={{ color: 'rgba(255,255,255,0.6)' }}>Quản trị viên</p>
          </div>
        </Link>
      </div>
    </aside>
  );
}
