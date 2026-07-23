'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuthMiddleware');
const requirePartyAccess = require('../middleware/partyAccessMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  castVote,
  clearVote,
  closeRoom,
  createRoom,
  finalizeRoom,
  getSession,
  joinRoom,
  listRooms,
  removeMember,
  reopenRoom,
  rotateInvite,
  updateMe,
} = require('../controllers/partyRoomController');

const router = express.Router();

const joinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message: 'Bạn đã thử tham gia phòng quá nhiều lần. Vui lòng thử lại sau.',
  },
});

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message: 'Bạn đang cập nhật phòng quá nhanh. Vui lòng chờ một chút.',
  },
});

// Public join is scoped by the opaque invite token in the request body.
router.post('/rooms/:roomId/join', joinLimiter, joinRoom);

// Host-only lifecycle operations.
router.get('/rooms', protect, restrictTo('CUSTOMER'), listRooms);
router.post('/rooms', protect, restrictTo('CUSTOMER'), createRoom);
router.post(
  '/rooms/:roomId/finalize',
  mutationLimiter,
  protect,
  restrictTo('CUSTOMER'),
  finalizeRoom,
);
router.post(
  '/rooms/:roomId/reopen',
  mutationLimiter,
  protect,
  restrictTo('CUSTOMER'),
  reopenRoom,
);
router.post(
  '/rooms/:roomId/invite/rotate',
  mutationLimiter,
  protect,
  restrictTo('CUSTOMER'),
  rotateInvite,
);
router.delete(
  '/rooms/:roomId/members/:memberId',
  mutationLimiter,
  protect,
  restrictTo('CUSTOMER'),
  removeMember,
);
router.post(
  '/rooms/:roomId/close',
  mutationLimiter,
  protect,
  restrictTo('CUSTOMER'),
  closeRoom,
);

// Shared host/guest surface. optionalAuth resolves the logged-in Host first;
// requirePartyAccess falls back to the scoped x-party-token guest session.
router.get(
  '/rooms/:roomId/session',
  optionalAuth,
  requirePartyAccess,
  getSession,
);
router.patch(
  '/rooms/:roomId/me',
  mutationLimiter,
  optionalAuth,
  requirePartyAccess,
  updateMe,
);
router.put(
  '/rooms/:roomId/candidates/:candidateId/vote',
  mutationLimiter,
  optionalAuth,
  requirePartyAccess,
  castVote,
);
router.delete(
  '/rooms/:roomId/candidates/:candidateId/vote',
  mutationLimiter,
  optionalAuth,
  requirePartyAccess,
  clearVote,
);

module.exports = router;
