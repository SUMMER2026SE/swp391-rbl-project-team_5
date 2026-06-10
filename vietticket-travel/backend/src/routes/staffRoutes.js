'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  listRefundRequests,
  processRefundRequest,
  reissueTicket,
} = require('../controllers/staffController');

const router = express.Router();

router.use(protect, restrictTo('STAFF', 'ADMIN'));
router.get('/refunds', listRefundRequests);
router.patch('/refunds/:refundId', processRefundRequest);
router.post('/bookings/:bookingId/reissue', reissueTicket);

module.exports = router;
