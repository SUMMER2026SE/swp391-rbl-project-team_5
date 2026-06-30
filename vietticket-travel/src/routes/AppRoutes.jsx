import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute.jsx'
import AdminRoute from '../components/AdminRoute.jsx'

const AdminUserManagementPage = lazy(() => import('../pages/AdminUserManagementPage.jsx'))
const AttractionDetailPage = lazy(() => import('../pages/AttractionDetailPage.jsx'))
const BookingSuccessPage = lazy(() => import('../pages/BookingSuccessPage.jsx'))
const ChangePasswordPage = lazy(() => import('../pages/ChangePasswordPage.jsx'))
const CheckoutPage = lazy(() => import('../pages/CheckoutPage.jsx'))
const ETicketPage = lazy(() => import('../pages/ETicketPage.jsx'))
const EditProfilePage = lazy(() => import('../pages/EditProfilePage.jsx'))
const ForgotPasswordPage = lazy(() => import('../pages/ForgotPasswordPage.jsx'))
const HomePage = lazy(() => import('../pages/HomePage.jsx'))
const LoginPage = lazy(() => import('../pages/LoginPage.jsx'))
const MyTicketsPage = lazy(() => import('../pages/MyTicketsPage.jsx'))
const PartnerAddAttractionPage = lazy(() => import('../pages/PartnerAddAttractionPage.jsx'))
const PartnerAttractionsPage = lazy(() => import('../pages/PartnerAttractionsPage.jsx'))
const PartnerBookingsPage = lazy(() => import('../pages/PartnerBookingsPage.jsx'))
const PartnerStaffPage = lazy(() => import('../pages/PartnerStaffPage.jsx'))
const PartnerDashboardPage = lazy(() => import('../pages/PartnerDashboardPage.jsx'))
const PartnerEditAttractionPage = lazy(() => import('../pages/PartnerEditAttractionPage.jsx'))
const PartnerKycPage = lazy(() => import('../pages/PartnerKycPage.jsx'))
const PartnerPendingPage = lazy(() => import('../pages/PartnerPendingPage.jsx'))
const PartnerRegisterPage = lazy(() => import('../pages/PartnerRegisterPage.jsx'))
const PartnerReportsPage = lazy(() => import('../pages/PartnerReportsPage.jsx'))
const PartnerSchedulePage = lazy(() => import('../pages/PartnerSchedulePage.jsx'))
const PartnerSettingsPage = lazy(() => import('../pages/PartnerSettingsPage.jsx'))
const PartnerTicketFormPage = lazy(() => import('../pages/PartnerTicketFormPage.jsx'))
const PartnerTicketsPage = lazy(() => import('../pages/PartnerTicketsPage.jsx'))
const ProfilePage = lazy(() => import('../pages/ProfilePage.jsx'))
const RegisterPage = lazy(() => import('../pages/RegisterPage.jsx'))
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage.jsx'))
const SearchAttractionsPage = lazy(() => import('../pages/SearchAttractionsPage.jsx'))
const SupportCenterPage = lazy(() => import('../pages/SupportCenterPage.jsx'))
const MySupportTicketsPage = lazy(() => import('../pages/MySupportTicketsPage.jsx'))
const UserFavoritesPage = lazy(() => import('../pages/UserFavoritesPage.jsx'))
const VerifyEmailPage = lazy(() => import('../pages/VerifyEmailPage.jsx'))
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard.jsx'))
const KycApprovalPage = lazy(() => import('../pages/admin/KycApprovalPage.jsx'))
const AttractionApprovalPage = lazy(() => import('../pages/admin/AttractionApprovalPage.jsx'))
const ViolationManagementPage = lazy(() => import('../pages/admin/ViolationManagementPage.jsx'))
const CategoryManagementPage = lazy(() => import('../pages/admin/CategoryManagementPage.jsx'))
const BookingManagementPage = lazy(() => import('../pages/admin/BookingManagementPage.jsx'))
const CheckinPage = lazy(() => import('../pages/staff/CheckinPage.jsx'))
const RefundManagementPage = lazy(() => import('../pages/staff/RefundManagementPage.jsx'))
const SupportTicketsPage = lazy(() => import('../pages/staff/SupportTicketsPage.jsx'))
const PartnerReviewsPage = lazy(() => import('../pages/PartnerReviewsPage.jsx'))
const ReviewModerationPage = lazy(() => import('../pages/admin/ReviewModerationPage.jsx'))
const StaticPage = lazy(() => import('../pages/StaticPage.jsx'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.jsx'))

function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center" role="status">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">
            progress_activity
          </span>
          <span className="sr-only">Đang tải trang</span>
        </div>
      }
    >
      <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/about" element={<StaticPage type="about" />} />
      <Route path="/faq" element={<StaticPage type="faq" />} />
      <Route path="/terms" element={<StaticPage type="terms" />} />
      <Route path="/privacy" element={<StaticPage type="privacy" />} />
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
        path="/partner/staff"
        element={
          <ProtectedRoute allowedRoles={['PARTNER']}>
            <PartnerStaffPage />
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
          <ProtectedRoute allowedRoles={['CUSTOMER', 'PARTNER']}>
            <PartnerPendingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/partner/kyc"
        element={
          <ProtectedRoute allowedRoles={['CUSTOMER', 'PARTNER']}>
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
          <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']} requirePlatformStaff>
            <RefundManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff/tickets"
        element={
          <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']} requirePlatformStaff>
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
      <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

export default AppRoutes
