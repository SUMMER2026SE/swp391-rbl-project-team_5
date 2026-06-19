'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requireActiveEmployer } = require('../middleware/partnerMiddleware');
const {
  listRefundRequests,
  processRefundRequest,
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
// Nhân viên chỉ thao tác được khi đối tác chủ quản còn hoạt động (APPROVED).
router.use(requireActiveEmployer);
router.get('/refunds', listRefundRequests);
router.patch('/refunds/:refundId', processRefundRequest);
router.post('/bookings/:bookingId/reissue', reissueTicket);
router.get('/bookings/today', listTodayBookings);
router.get('/checkin/:token', lookupTicketByQr);
router.post('/checkin/:token', checkInTicket);

module.exports = router;
