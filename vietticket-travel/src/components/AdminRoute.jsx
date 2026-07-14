import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { hasRole } from '../utils/userRoles.js';

function RouteLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9fc] px-5">
      <div
        className="rounded-lg border border-[#bec8ca]/60 bg-white px-6 py-5 text-sm font-semibold text-[#3f484a] shadow-[0_8px_30px_rgba(0,40,50,0.08)]"
        role="status"
      >
        Đang kiểm tra phiên đăng nhập...
      </div>
    </main>
  );
}

function RouteLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9fc] px-5">
      <div
        className="rounded-lg border border-[#bec8ca]/60 bg-white px-6 py-5 text-sm font-semibold text-[#3f484a] shadow-[0_8px_30px_rgba(0,40,50,0.08)]"
        role="status"
      >
        Đang kiểm tra phiên đăng nhập...
      </div>
    </main>
  );
}

/**
 * AdminRoute protects admin routes.
 * It checks if the user is authenticated and has the ADMIN role.
 * If not, it redirects the user to the login page.
 */
function AdminRoute({ children }) {
  const location = useLocation();
  const { isAuthenticated, isAuthLoading, user } = useAuth();

  if (isAuthLoading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated || !hasRole(user, 'ADMIN')) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export default AdminRoute;
