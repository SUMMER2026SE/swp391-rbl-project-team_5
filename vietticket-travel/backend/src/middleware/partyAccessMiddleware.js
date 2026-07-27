'use strict';

const { findActor } = require('../services/partyRoomService');
const { readPartyToken } = require('../utils/partyToken');

async function requirePartyAccess(req, res, next) {
  try {
    const actor = await findActor({
      roomId: req.params.roomId,
      userId: req.user?.id,
      partyToken: readPartyToken(req),
    });
    if (!actor) {
      return res.status(401).json({
        message: 'Phiên tham gia phòng không hợp lệ, đã hết hạn hoặc đã bị thu hồi.',
      });
    }
    req.partyActor = actor;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requirePartyAccess;
