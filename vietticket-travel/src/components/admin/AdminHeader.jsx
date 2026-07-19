import { Link } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import { hasRole } from '../../utils/userRoles.js';
import '../../styles/admin.css';

const ADMIN_AVATAR =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA9EMAVDAxQX5keC0ppG7FjHNkygtjkzXcw0hT0QB1cxg0hnSB-Sid71KvctqqRsGyAMVqLjnrJRH68NAgYTDXd2o6RVsvBVEJ8joIqcsiYMN9MN4LK5di-MyY0ObRNofSUIx5SbiNksKAd-ftWk5CQOgBWlDJp8zMRLckW2P9WYpu93XKJqt0tvjkLJygFt6mYYoCWlNouapEC2n3Ptzkp5XQkmAppY7oSkOO0a4f-enxzB1EkhOftLzxD1LKc5Gs0WOGoJx0tOj3D';

export default function AdminHeader({ onMenuClick }) {
  const { user } = useAuth();
  const helpPath = hasRole(user, 'ADMIN')
    || (hasRole(user, 'STAFF') && !user?.employerPartnerId)
    ? '/staff/tickets'
    : hasRole(user, 'STAFF')
      ? '/staff/checkin'
      : '/support';

  return (
    <header className="admin-header">
      <button
        className="admin-header__icon-btn md:hidden mr-2"
        onClick={onMenuClick}
        aria-label="Mở menu"
        type="button"
      >
        <span className="material-symbols-outlined">menu</span>
      </button>
      <div className="admin-header__actions">
        <Link
          to="/"
          className="admin-header__icon-btn"
          aria-label="Xem trang bán vé chính"
          title="Xem trang bán vé chính"
          style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
        >
          <span className="material-symbols-outlined">home</span>
        </Link>
        <Link
          to={helpPath}
          className="admin-header__icon-btn"
          aria-label="Mở Trung tâm hỗ trợ"
          title="Trung tâm hỗ trợ"
          style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
        >
          <span className="material-symbols-outlined">help_outline</span>
        </Link>
        <div className="admin-header__user">
          <div className="admin-header__user-info">
            <p className="admin-header__user-name">{user?.fullName || 'Admin'}</p>
            <p className="admin-header__user-role">{user?.roleLabel || 'Quản trị viên'}</p>
          </div>
          <img
            className="admin-header__avatar"
            src={user?.avatar || ADMIN_AVATAR}
            alt="Admin User Avatar"
          />
        </div>
      </div>
    </header>
  );
}
