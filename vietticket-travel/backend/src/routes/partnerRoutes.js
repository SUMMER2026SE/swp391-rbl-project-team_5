const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const {
  requirePartner,
  requireApprovedPartner,
  requireOwnedAttraction,
} = require('../middleware/partnerMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  uploadAttractionImages,
  enforcePublicUploadQuota,
  validateUploadedFiles,
} = require('../middleware/uploadMiddleware');
const partnerController = require('../controllers/partnerController');
const partnerStaffController = require('../controllers/partnerStaffController');
const attractionController = require('../controllers/attractionController');
const ticketController = require('../controllers/ticketController');
const scheduleController = require('../controllers/scheduleController');
const reviewController = require('../controllers/reviewController');
const settlementController = require('../controllers/settlementController');

const router = express.Router();
const staffInviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `partner:${req.partner.id}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'STAFF_INVITE_RATE_LIMITED',
      message: 'Đối tác đã gửi quá nhiều lời mời nhân viên. Vui lòng thử lại sau.',
    },
  },
});
const attractionImageUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: {
      code: 'UPLOAD_RATE_LIMITED',
      message: 'Bạn đã tải ảnh quá thường xuyên. Vui lòng thử lại sau.',
    },
  },
});

// --- KYC: chỉ cần đăng nhập (người dùng chưa phải đối tác) ---
router.post('/register', protect, partnerController.submitKyc);

// --- Mọi route bên dưới yêu cầu đã có hồ sơ đối tác ---
router.use(protect, requirePartner);

// Hồ sơ này phải truy cập được khi đang PENDING/REJECTED để hiển thị trạng thái.
router.get('/me', partnerController.getMyPartner);

// Mọi thao tác nghiệp vụ bên dưới chỉ dành cho đối tác đã được duyệt.
router.use(requireApprovedPartner);

// Hồ sơ & tổng quan
router.put('/settings', partnerController.updateSettings);
router.get('/dashboard', partnerController.getDashboard);
router.get('/reports', partnerController.getReports);
router.get('/settlements', restrictTo('PARTNER'), settlementController.listPartnerSettlements);
router.get('/categories', attractionController.listCategories);

// Điểm tham quan
router.get('/attractions', attractionController.listAttractions);
router.post('/attractions', attractionController.createAttraction);
router.get('/attractions/:id', attractionController.getAttraction);
router.put('/attractions/:id', attractionController.updateAttraction);
router.delete('/attractions/:id', attractionController.deleteAttraction);
router.patch('/attractions/:id/publication', attractionController.setPublicationStatus);
router.post(
  '/attractions/:id/images',
  attractionImageUploadLimiter,
  requireOwnedAttraction,
  enforcePublicUploadQuota,
  uploadAttractionImages.array('images', 10),
  validateUploadedFiles,
  attractionController.uploadImages,
);
router.delete('/attractions/:id/images/:imageId', attractionController.deleteImage);
router.patch(
  '/attractions/:id/images/:imageId/primary',
  attractionController.setPrimaryImage,
);

// Vé (gói vé)
router.get('/attractions/:id/tickets', ticketController.listTickets);
router.post('/attractions/:id/tickets', ticketController.createTicket);
router.get('/tickets/:ticketId', ticketController.getTicket);
router.put('/tickets/:ticketId', ticketController.updateTicket);
router.delete('/tickets/:ticketId', ticketController.deleteTicket);

// Lịch & sức chứa
router.get('/attractions/:id/schedule', scheduleController.getSchedule);
router.put('/attractions/:id/schedule', scheduleController.saveSchedule);

// Đặt vé (quản lý phía đối tác)
router.get('/bookings', restrictTo('PARTNER'), partnerController.getPartnerBookings);
router.patch('/bookings/:id/approve', restrictTo('PARTNER'), partnerController.approveBooking);
router.patch('/bookings/:id/reject', restrictTo('PARTNER'), partnerController.rejectBooking);
router.patch('/bookings/:id/cancel', restrictTo('PARTNER'), partnerController.cancelConfirmedBooking);

// Đánh giá (phản hồi & thống kê phía đối tác)
router.get('/reviews', restrictTo('PARTNER'), reviewController.listPartnerReviews);
router.get('/reviews/stats', restrictTo('PARTNER'), reviewController.getPartnerReviewStats);

// Nhân viên (mỗi đối tác tự quản lý nhân viên của mình)
router.get('/staff', restrictTo('PARTNER'), partnerStaffController.listStaff);
router.post('/staff', restrictTo('PARTNER'), staffInviteLimiter, partnerStaffController.createStaff);
router.post(
  '/staff/:staffId/invite',
  restrictTo('PARTNER'),
  staffInviteLimiter,
  partnerStaffController.resendStaffInvite,
);
router.patch('/staff/:staffId/status', restrictTo('PARTNER'), partnerStaffController.changeStaffStatus);
router.get('/staff/:staffId/assignments', restrictTo('PARTNER'), partnerStaffController.getStaffAssignments);
router.put('/staff/:staffId/assignments', restrictTo('PARTNER'), partnerStaffController.replaceStaffAssignments);
router.delete('/staff/:staffId', restrictTo('PARTNER'), partnerStaffController.removeStaff);

module.exports = router;

