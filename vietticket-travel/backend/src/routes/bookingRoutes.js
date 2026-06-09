const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  createBooking,
  getBooking,
  getReservation,
  listBookings,
  updatePaymentStatus,
  validateAndApplyVoucher,
} = require('../controllers/bookingController');

const router = express.Router();

router.get('/', protect, restrictTo('CUSTOMER'), listBookings);
router.post('/', protect, restrictTo('CUSTOMER'), createBooking);
router.post('/apply-voucher', protect, validateAndApplyVoucher);
router.get(
  '/reservations/:reservationId',
  protect,
  restrictTo('CUSTOMER'),
  getReservation,
);
router.get('/:bookingId', protect, restrictTo('CUSTOMER'), getBooking);
router.patch(
  '/:bookingId/payment-status',
  protect,
  restrictTo('CUSTOMER'),
  updatePaymentStatus,
);

module.exports = router;
