const express = require('express');
const protect = require('../middleware/authMiddleware');
const { requirePartner, requireApprovedPartner } = require('../middleware/partnerMiddleware');
const { uploadAttractionImages } = require('../middleware/uploadMiddleware');
const partnerController = require('../controllers/partnerController');
const attractionController = require('../controllers/attractionController');
const ticketController = require('../controllers/ticketController');
const scheduleController = require('../controllers/scheduleController');

const router = express.Router();

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
router.get('/categories', attractionController.listCategories);

// Điểm tham quan
router.get('/attractions', attractionController.listAttractions);
router.post('/attractions', attractionController.createAttraction);
router.get('/attractions/:id', attractionController.getAttraction);
router.put('/attractions/:id', attractionController.updateAttraction);
router.delete('/attractions/:id', attractionController.deleteAttraction);
router.post(
  '/attractions/:id/images',
  uploadAttractionImages.array('images', 10),
  attractionController.uploadImages,
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

module.exports = router;

