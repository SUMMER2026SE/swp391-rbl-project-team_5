'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { requirePlatformStaff, restrictTo } = require('../middleware/roleMiddleware');
const {
  requireCheckInEmployer,
} = require('../middleware/partnerMiddleware');
const {
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
  reissueTicket,
  lookupTicketByQr,
  checkInTicket,
  listTodayBookings,
  listStaffAssignments,
  replaceStaffAssignments,
} = require('../controllers/staffController');

const router = express.Router();

router.use(protect);
router.get('/assignments/:staffId', restrictTo('ADMIN'), listStaffAssignments);
router.put('/assignments/:staffId', restrictTo('ADMIN'), replaceStaffAssignments);

router.use(restrictTo('STAFF', 'ADMIN'));
router.get('/refunds', requirePlatformStaff, listRefundRequests);
router.patch('/refunds/:refundId', requirePlatformStaff, processRefundRequest);
router.post('/refunds/:refundId/reconcile', requirePlatformStaff, reconcileRefundRequest);
// Nhân viên chỉ thao tác được khi đối tác chủ quản còn hoạt động (APPROVED).
router.post('/bookings/:bookingId/reissue', requireCheckInEmployer, reissueTicket);
router.get('/bookings/today', requireCheckInEmployer, listTodayBookings);
router.get('/checkin/:token', requireCheckInEmployer, lookupTicketByQr);
router.post('/checkin/:token', requireCheckInEmployer, checkInTicket);

module.exports = router;
