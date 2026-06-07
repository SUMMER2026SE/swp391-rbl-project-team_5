import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute.jsx'
import AdminRoute from '../components/AdminRoute.jsx'
import ChangePasswordPage from '../pages/ChangePasswordPage.jsx'
import EditProfilePage from '../pages/EditProfilePage.jsx'
import ForgotPasswordPage from '../pages/ForgotPasswordPage.jsx'
import HomePage from '../pages/HomePage.jsx'
import LoginPage from '../pages/LoginPage.jsx'
import ProfilePage from '../pages/ProfilePage.jsx'
import RegisterPage from '../pages/RegisterPage.jsx'
import ResetPasswordPage from '../pages/ResetPasswordPage.jsx'
import VerifyEmailPage from '../pages/VerifyEmailPage.jsx'
import AdminDashboard from '../pages/admin/AdminDashboard.jsx'
import KycApprovalPage from '../pages/admin/KycApprovalPage.jsx'
import AttractionApprovalPage from '../pages/admin/AttractionApprovalPage.jsx'
import ViolationManagementPage from '../pages/admin/ViolationManagementPage.jsx'
import CategoryManagementPage from '../pages/admin/CategoryManagementPage.jsx'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
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
      {/* Admin routes protected by AdminRoute */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/kyc-approval"
        element={
          <AdminRoute>
            <KycApprovalPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/attraction-approval"
        element={
          <AdminRoute>
            <AttractionApprovalPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/violations"
        element={
          <AdminRoute>
            <ViolationManagementPage />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/categories"
        element={
          <AdminRoute>
            <CategoryManagementPage />
          </AdminRoute>
        }
      />
    </Routes>
  )
}

export default AppRoutes
