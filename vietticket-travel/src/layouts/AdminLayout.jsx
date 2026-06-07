import AdminSidebar from '../components/admin/AdminSidebar';
import AdminHeader from '../components/admin/AdminHeader';
import '../styles/admin.css';

/**
 * AdminLayout – wraps every admin page with the shared sidebar + header.
 * Children render inside the scrollable main area.
 */
export default function AdminLayout({ children, searchPlaceholder }) {
  return (
    <div className="admin-layout">
      <AdminSidebar />
      <AdminHeader placeholder={searchPlaceholder} />
      <main className="admin-main">
        <div className="admin-canvas">
          {children}
        </div>
      </main>
    </div>
  );
}
