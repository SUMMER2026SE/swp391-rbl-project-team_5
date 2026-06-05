import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute.jsx'
import AdminUserManagementPage from '../pages/AdminUserManagementPage.jsx'
import AttractionDetailPage from '../pages/AttractionDetailPage.jsx'
import BookingSuccessPage from '../pages/BookingSuccessPage.jsx'
import ChangePasswordPage from '../pages/ChangePasswordPage.jsx'
import CheckoutPage from '../pages/CheckoutPage.jsx'
import EditProfilePage from '../pages/EditProfilePage.jsx'
import ForgotPasswordPage from '../pages/ForgotPasswordPage.jsx'
import HomePage from '../pages/HomePage.jsx'
import LoginPage from '../pages/LoginPage.jsx'
import ProfilePage from '../pages/ProfilePage.jsx'
import RegisterPage from '../pages/RegisterPage.jsx'
import ResetPasswordPage from '../pages/ResetPasswordPage.jsx'
import SearchAttractionsPage from '../pages/SearchAttractionsPage.jsx'
import UserFavoritesPage from '../pages/UserFavoritesPage.jsx'
import VerifyEmailPage from '../pages/VerifyEmailPage.jsx'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/attractions" element={<SearchAttractionsPage />} />
      <Route path="/attractions/:id" element={<AttractionDetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/favorites"
        element={
          <ProtectedRoute>
            <UserFavoritesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/edit-profile"
        element={
          <ProtectedRoute>
            <EditProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminUserManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/checkout/:reservationId"
        element={
          <ProtectedRoute>
            <CheckoutPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/booking-success"
        element={
          <ProtectedRoute>
            <BookingSuccessPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default AppRoutes
