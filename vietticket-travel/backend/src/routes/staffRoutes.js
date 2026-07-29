'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const {
  requirePlatformStaff,
  requireStaffAccess,
  restrictTo,
} = require('../middleware/roleMiddleware');
const {
  requireCheckInEmployer,
} = require('../middleware/partnerMiddleware');
const {
  adjudicateRefundRequest,
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
  reissueTicket,
  lookupTicketByQr,
  lookupCheckinTarget,
  checkInTicket,
  listTodayBookings,
  listOperationalBookings,
  listStaffAssignments,
  replaceStaffAssignments,
} = require('../controllers/staffController');
const smartQueueOperationsController = require('../controllers/smartQueueOperationsController');
const {
  getFinancialReport,
  getFinancialTransactions,
} = require('../controllers/adminController');

const router = express.Router();

router.use(protect);
router.get('/assignments/:staffId', restrictTo('ADMIN'), listStaffAssignments);
router.put('/assignments/:staffId', restrictTo('ADMIN'), replaceStaffAssignments);

router.use(restrictTo('STAFF', 'ADMIN'));
router.get('/refunds', requirePlatformStaff, listRefundRequests);
router.patch('/refunds/:refundId', requirePlatformStaff, processRefundRequest);
router.post('/refunds/:refundId/reconcile', requirePlatformStaff, reconcileRefundRequest);
router.get('/financial-report', requirePlatformStaff, getFinancialReport);
router.get('/financial-transactions', requirePlatformStaff, getFinancialTransactions);
// Manual adjudication is a last-resort financial control. Platform staff may
// investigate, but only an ADMIN can bind external evidence to a local refund.
router.post(
  '/refunds/:refundId/adjudicate',
  requirePlatformStaff,
  restrictTo('ADMIN'),
  adjudicateRefundRequest,
);
// Nhân viên chỉ thao tác được khi đối tác chủ quản còn hoạt động (APPROVED).
router.post('/bookings/:bookingId/reissue', requireCheckInEmployer, requireStaffAccess('MANAGER'), reissueTicket);
router.get('/bookings/today', requireCheckInEmployer, requireStaffAccess('SCANNER', 'MANAGER'), listTodayBookings);
router.get('/bookings', requireCheckInEmployer, requireStaffAccess('MANAGER'), listOperationalBookings);
// Tra cứu hợp nhất: nhận mã QR hoặc mã đặt chỗ VT-XXXX, trả về mọi vé trong đơn.
router.get('/lookup', requireCheckInEmployer, requireStaffAccess('SCANNER', 'MANAGER'), lookupCheckinTarget);
router.get('/checkin/:token', requireCheckInEmployer, requireStaffAccess('SCANNER', 'MANAGER'), lookupTicketByQr);
router.post('/checkin/:token', requireCheckInEmployer, requireStaffAccess('SCANNER', 'MANAGER'), checkInTicket);

// SmartQueue operations console: every non-admin request is checked against
// StaffAttractionAssignment inside the controller (not merely by the role).
router.get('/smart-queue/attractions', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.listAssignedAttractions);
router.get('/smart-queue/overview', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.getOverview);
router.get('/smart-queue/policy/:attractionId', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.getPolicy);
// Long-lived queue policy belongs to the attraction owner. Platform ADMIN may
// override it here; on-site STAFF can only pause/resume and operate FIFO.
router.put('/smart-queue/policy/:attractionId', requireCheckInEmployer, restrictTo('ADMIN'), smartQueueOperationsController.updatePolicy);
router.post('/smart-queue/policy/:attractionId/pause', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.pauseQueue);
router.post('/smart-queue/policy/:attractionId/resume', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.resumeQueue);
router.post('/smart-queue/entries/:entryId/call', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.actOnEntry);
router.post('/smart-queue/entries/:entryId/no-show', requireCheckInEmployer, requireStaffAccess('MANAGER'), smartQueueOperationsController.actOnEntry);

module.exports = router;
