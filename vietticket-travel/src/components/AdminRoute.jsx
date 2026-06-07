import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';

/**
 * AdminRoute protects admin routes.
 * It checks if the user is authenticated and has the ADMIN role.
 * If not, it redirects the user to the login page.
 */
function AdminRoute({ children }) {
  const location = useLocation();
  const { isAuthenticated, isAuthLoading, user } = useAuth();

  if (isAuthLoading) {
    return null;
  }

  if (!isAuthenticated || user?.role !== 'ADMIN') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export default AdminRoute;
