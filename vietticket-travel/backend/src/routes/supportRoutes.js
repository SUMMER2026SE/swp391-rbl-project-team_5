'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  createTicket,
  listMyTickets,
  listAllTickets,
  getTicketDetail,
  sendMessage,
  updateTicketStatus,
} = require('../controllers/supportController');

const router = express.Router();

router.use(protect);

// Khách hàng
router.post('/tickets', restrictTo('CUSTOMER'), createTicket);
router.get('/tickets/my-tickets', restrictTo('CUSTOMER'), listMyTickets);

// Staff/Admin — đặt trước route động /:ticketId
router.get('/tickets', restrictTo('STAFF', 'ADMIN'), listAllTickets);
router.patch('/tickets/:ticketId/status', restrictTo('STAFF', 'ADMIN'), updateTicketStatus);

// Dùng chung (kiểm tra quyền sở hữu/role bên trong controller)
router.get('/tickets/:ticketId', getTicketDetail);
router.post('/tickets/:ticketId/messages', sendMessage);

module.exports = router;
