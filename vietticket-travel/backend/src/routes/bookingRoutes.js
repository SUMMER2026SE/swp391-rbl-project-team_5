const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requireCurrentPolicyConsent } = require('../middleware/policyConsentMiddleware');
const {
  createBooking,
  getBooking,
  getItineraryBookingProgress,
  getReservation,
  listApplicableVouchers,
  listBookings,
  validateAndApplyVoucher,
} = require('../controllers/bookingController');

const router = express.Router();

router.get('/', protect, restrictTo('CUSTOMER'), listBookings);
router.post(
  '/',
  protect,
  restrictTo('CUSTOMER'),
  requireCurrentPolicyConsent,
  createBooking,
);
router.post(
  '/apply-voucher',
  protect,
  restrictTo('CUSTOMER'),
  requireCurrentPolicyConsent,
  validateAndApplyVoucher,
);
router.get('/available-vouchers', protect, restrictTo('CUSTOMER'), listApplicableVouchers);
router.get(
  '/reservations/:reservationId',
  protect,
  restrictTo('CUSTOMER'),
  getReservation,
);
router.get(
  '/itineraries/:itineraryId/progress',
  protect,
  restrictTo('CUSTOMER'),
  getItineraryBookingProgress,
);
router.get('/:bookingId', protect, restrictTo('CUSTOMER'), getBooking);

module.exports = router;
