import { useState } from 'react';
import AdminSidebar from '../components/admin/AdminSidebar';
import AdminHeader from '../components/admin/AdminHeader';
import '../styles/admin.css';

/**
 * AdminLayout – wraps every admin page with the shared sidebar + header.
 * Children render inside the scrollable main area.
 */
export default function AdminLayout({ children, searchPlaceholder }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="admin-layout">
      <AdminSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <AdminHeader placeholder={searchPlaceholder} onMenuClick={() => setIsSidebarOpen(true)} />
      
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <main className="admin-main">
        <div className="admin-canvas">
          {children}
        </div>
      </main>
    </div>
  );
}

