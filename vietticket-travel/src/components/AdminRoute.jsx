import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/useAuth.js';
import { hasRole } from '../utils/userRoles.js';
import AccessDenied from './AccessDenied.jsx';

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
 * Guests are redirected to login; authenticated users without the role receive
 * a clear access-denied explanation.
 */
function AdminRoute({ children }) {
  const location = useLocation();
  const { isAuthenticated, isAuthLoading, user } = useAuth();

  if (isAuthLoading) {
    return <RouteLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!hasRole(user, 'ADMIN')) {
    return <AccessDenied user={user} />;
  }

  return children;
}

export default AdminRoute;
