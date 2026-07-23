'use strict';

const liveTripService = require('../services/liveTripService');
const { getAttractionPressure } = require('../services/arrivalPressureService');
const {
  decideProposal,
  refreshTripAutopilot,
} = require('../services/liveTripAutopilotService');
const {
  cancelQueue,
  getQueueForItem,
  joinQueue,
} = require('../services/smartQueueService');
const {
  optimizeLiveTrip,
  predictLiveArrivals,
  predictLiveWait,
} = require('../services/livePredictionService');

async function activateLiveTrip(req, res, next) {
  try {
    const result = await liveTripService.activateLiveTrip({
      userId: req.user.id,
      planId: req.body?.planId,
      startDate: req.body?.startDate,
    });
    return res.status(result.created ? 201 : 200).json({
      success: true,
      data: result.trip,
      created: result.created,
    });
  } catch (error) {
    return next(error);
  }
}

async function listLiveTrips(req, res, next) {
  try {
    const trips = await liveTripService.listLiveTrips(req.user.id);
    return res.json({ success: true, data: trips });
  } catch (error) {
    return next(error);
  }
}

async function getLiveTrip(req, res, next) {
  try {
    const trip = await liveTripService.getLiveTripOverview(
      req.params.tripId,
      req.user.id,
    );
    return res.json({ success: true, data: trip });
  } catch (error) {
    return next(error);
  }
}

async function getAttractionPressureForCustomer(req, res, next) {
  try {
    const pressure = await getAttractionPressure(
      req.params.attractionId,
      req.query.date,
      { publicOnly: true },
    );
    return res.json({ success: true, data: pressure });
  } catch (error) {
    return next(error);
  }
}

async function refreshAutopilot(req, res, next) {
  try {
    const result = await refreshTripAutopilot(req.params.tripId, req.user.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function simulateAutopilot(req, res, next) {
  try {
    const result = await optimizeLiveTrip({ liveTripId: req.params.tripId, userId: req.user.id });
    if (result && result.live_trip_id && prismaForSimulationAvailable()) {
      // The simulation is an immutable evidence record; it does not modify the
      // itinerary and never bypasses the existing customer-confirmation gate.
      const prisma = require('../config/prisma');
      await prisma.autopilotSimulation.create({
        data: {
          liveTripId: req.params.tripId,
          algorithmVersion: result.algorithm_version,
          baselineScore: Number(result.baseline_score || 0),
          optimizedScore: Number(result.optimized_score || 0),
          predictedMinutesSaved: Number(result.predicted_minutes_saved || 0),
          protectedBookingCount: Number(result.protected_booking_count || 0),
          proposalCount: Array.isArray(result.proposals) ? result.proposals.length : 0,
          constraints: result.constraints || {},
          result,
        },
      });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

function prismaForSimulationAvailable() {
  const prisma = require('../config/prisma');
  return Boolean(prisma?.autopilotSimulation?.create);
}

async function predictArrivals(req, res, next) {
  try {
    const result = await predictLiveArrivals({
      attractionId: req.params.attractionId,
      date: req.query.date,
      horizonMinutes: req.query.horizonMinutes,
      publicOnly: true,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function predictWait(req, res, next) {
  try {
    const result = await predictLiveWait({
      attractionId: req.params.attractionId,
      date: req.query.date,
      guestsAhead: req.query.guestsAhead,
      partySize: req.query.partySize,
      publicOnly: true,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function decideAutopilotProposal(req, res, next) {
  try {
    const result = await decideProposal({
      tripId: req.params.tripId,
      proposalId: req.params.proposalId,
      userId: req.user.id,
      decision: req.body?.decision,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function getSmartQueue(req, res, next) {
  try {
    const queue = await getQueueForItem({
      tripId: req.params.tripId,
      itemId: req.params.itemId,
      userId: req.user.id,
    });
    return res.json({ success: true, data: queue });
  } catch (error) {
    return next(error);
  }
}

async function joinSmartQueue(req, res, next) {
  try {
    const result = await joinQueue({
      tripId: req.params.tripId,
      itemId: req.params.itemId,
      userId: req.user.id,
    });
    return res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,
      data: result.queue,
    });
  } catch (error) {
    return next(error);
  }
}

async function leaveSmartQueue(req, res, next) {
  try {
    const queue = await cancelQueue({
      tripId: req.params.tripId,
      itemId: req.params.itemId,
      userId: req.user.id,
    });
    return res.json({ success: true, data: queue });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  activateLiveTrip,
  decideAutopilotProposal,
  getAttractionPressureForCustomer,
  getLiveTrip,
  getSmartQueue,
  joinSmartQueue,
  leaveSmartQueue,
  listLiveTrips,
  refreshAutopilot,
  simulateAutopilot,
  predictArrivals,
  predictWait,
};
