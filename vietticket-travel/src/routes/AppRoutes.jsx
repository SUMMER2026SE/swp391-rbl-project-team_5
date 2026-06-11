import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute.jsx'
import AdminRoute from '../components/AdminRoute.jsx'
import AdminUserManagementPage from '../pages/AdminUserManagementPage.jsx'
import AttractionDetailPage from '../pages/AttractionDetailPage.jsx'
import BookingSuccessPage from '../pages/BookingSuccessPage.jsx'
import ChangePasswordPage from '../pages/ChangePasswordPage.jsx'
import CheckoutPage from '../pages/CheckoutPage.jsx'
import ETicketPage from '../pages/ETicketPage.jsx'
import EditProfilePage from '../pages/EditProfilePage.jsx'
import ForgotPasswordPage from '../pages/ForgotPasswordPage.jsx'
import HomePage from '../pages/HomePage.jsx'
import LoginPage from '../pages/LoginPage.jsx'
import MyTicketsPage from '../pages/MyTicketsPage.jsx'
import PartnerAddAttractionPage from '../pages/PartnerAddAttractionPage.jsx'
import PartnerAttractionsPage from '../pages/PartnerAttractionsPage.jsx'
import PartnerBookingsPage from '../pages/PartnerBookingsPage.jsx'
import PartnerDashboardPage from '../pages/PartnerDashboardPage.jsx'
import PartnerEditAttractionPage from '../pages/PartnerEditAttractionPage.jsx'
import PartnerKycPage from '../pages/PartnerKycPage.jsx'
import PartnerPendingPage from '../pages/PartnerPendingPage.jsx'
import PartnerRegisterPage from '../pages/PartnerRegisterPage.jsx'
import PartnerReportsPage from '../pages/PartnerReportsPage.jsx'
import PartnerSchedulePage from '../pages/PartnerSchedulePage.jsx'
import PartnerSettingsPage from '../pages/PartnerSettingsPage.jsx'
import PartnerTicketFormPage from '../pages/PartnerTicketFormPage.jsx'
import PartnerTicketsPage from '../pages/PartnerTicketsPage.jsx'
import ProfilePage from '../pages/ProfilePage.jsx'
import RegisterPage from '../pages/RegisterPage.jsx'
import ResetPasswordPage from '../pages/ResetPasswordPage.jsx'
import SearchAttractionsPage from '../pages/SearchAttractionsPage.jsx'
import SupportCenterPage from '../pages/SupportCenterPage.jsx'
import MySupportTicketsPage from '../pages/MySupportTicketsPage.jsx'
import UserFavoritesPage from '../pages/UserFavoritesPage.jsx'
import VerifyEmailPage from '../pages/VerifyEmailPage.jsx'
import AdminDashboard from '../pages/admin/AdminDashboard.jsx'
import KycApprovalPage from '../pages/admin/KycApprovalPage.jsx'
import AttractionApprovalPage from '../pages/admin/AttractionApprovalPage.jsx'
import ViolationManagementPage from '../pages/admin/ViolationManagementPage.jsx'
import CategoryManagementPage from '../pages/admin/CategoryManagementPage.jsx'
import BookingManagementPage from '../pages/admin/BookingManagementPage.jsx'
import CheckinPage from '../pages/staff/CheckinPage.jsx'
import RefundManagementPage from '../pages/staff/RefundManagementPage.jsx'
import SupportTicketsPage from '../pages/staff/SupportTicketsPage.jsx'
import PartnerReviewsPage from '../pages/PartnerReviewsPage.jsx'
import ReviewModerationPage from '../pages/admin/ReviewModerationPage.jsx'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/attractions" element={<SearchAttractionsPage />} />
      <Route path="/attractions/:id" element={<AttractionDetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/partner" element={<Navigate to="/partner/dashboard" replace />} />
      <Route path="/partner/register" element={<PartnerRegisterPage />} />
      <Route
        path="/partner/dashboard"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/bookings"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerBookingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/reports"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/settings"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerAttractionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions/new"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerAddAttractionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions/:id/edit"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerEditAttractionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions/:id/tickets"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerTicketsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions/:id/tickets/new"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerTicketFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions/:id/tickets/:ticketId/edit"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerTicketFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/attractions/:id/schedule"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerSchedulePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/pending"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerPendingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/kyc"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerKycPage />
          </ProtectedRoute>
        }
      />
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
        path="/admin/bookings"
        element={
          <AdminRoute>
            <BookingManagementPage />
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
      <Route
        path="/admin/users"
        element={
          <AdminRoute>
            <AdminUserManagementPage />
          </AdminRoute>
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
      <Route
        path="/my-tickets"
        element={
          <ProtectedRoute>
            <MyTicketsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tickets/:bookingId"
        element={
          <ProtectedRoute>
            <ETicketPage />
          </ProtectedRoute>
        }
      />
      {/* Module 5 - Customer Support */}
      <Route
        path="/support"
        element={
          <ProtectedRoute>
            <SupportCenterPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-support"
        element={
          <ProtectedRoute>
            <MySupportTicketsPage />
          </ProtectedRoute>
        }
      />
      {/* Module 5 - Staff Routes */}
      <Route
        path="/staff/checkin"
        element={
          <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']}>
            <CheckinPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff/refunds"
        element={
          <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']}>
            <RefundManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff/tickets"
        element={
          <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']}>
            <SupportTicketsPage />
          </ProtectedRoute>
        }
      />
      {/* Module 5 - Partner Routes */}
      <Route
        path="/partner/reviews"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerReviewsPage />
          </ProtectedRoute>
        }
      />
      {/* Module 5 - Admin Routes */}
      <Route
        path="/admin/reviews"
        element={
          <AdminRoute>
            <ReviewModerationPage />
          </AdminRoute>
        }
      />
    </Routes>
  )
}

export default AppRoutes
