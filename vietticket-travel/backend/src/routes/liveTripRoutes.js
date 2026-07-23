'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const {
  activateLiveTrip,
  decideAutopilotProposal,
  getAttractionPressureForCustomer,
  getLiveTrip,
  getSmartQueue,
  joinSmartQueue,
  leaveSmartQueue,
  listLiveTrips,
  predictArrivals,
  predictWait,
  refreshAutopilot,
  simulateAutopilot,
} = require('../controllers/liveTripController');

const router = express.Router();

router.use(protect, restrictTo('CUSTOMER'));

router.get('/trips', listLiveTrips);
router.post('/trips', activateLiveTrip);
router.post('/trips/:tripId/autopilot/refresh', refreshAutopilot);
router.post('/trips/:tripId/autopilot/simulate', simulateAutopilot);
router.post('/trips/:tripId/proposals/:proposalId/decision', decideAutopilotProposal);
router.get('/trips/:tripId/items/:itemId/queue', getSmartQueue);
router.post('/trips/:tripId/items/:itemId/queue', joinSmartQueue);
router.delete('/trips/:tripId/items/:itemId/queue', leaveSmartQueue);
router.get('/trips/:tripId', getLiveTrip);
router.get('/attractions/:attractionId/pressure', getAttractionPressureForCustomer);
router.get('/attractions/:attractionId/predict-arrivals', predictArrivals);
router.get('/attractions/:attractionId/predict-wait', predictWait);

module.exports = router;
