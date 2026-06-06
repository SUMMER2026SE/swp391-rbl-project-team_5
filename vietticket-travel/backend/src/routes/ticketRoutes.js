const express = require('express');
const { createTicketProduct, setupTimeSlots, checkAvailability, reserveTickets } = require('../controllers/ticketController');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');

const router = express.Router({ mergeParams: true });

// Nested under /api/attractions/:attractionId/tickets
router.post('/', protect, restrictTo('PARTNER'), createTicketProduct);

// Separate ticket routes
const ticketRouter = express.Router();
ticketRouter.post('/:ticketProductId/slots', protect, restrictTo('PARTNER'), setupTimeSlots);
ticketRouter.get('/:ticketProductId/availability', checkAvailability);
ticketRouter.post('/:ticketProductId/reserve', protect, restrictTo('CUSTOMER'), reserveTickets);

module.exports = { router, ticketRouter };
