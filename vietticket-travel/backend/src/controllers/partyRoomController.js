'use strict';

const partyRoomService = require('../services/partyRoomService');

async function createRoom(req, res, next) {
  try {
    const result = await partyRoomService.createRoom(req.user.id, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function listRooms(req, res, next) {
  try {
    const rooms = await partyRoomService.listRooms(req.user.id);
    return res.json({ success: true, data: rooms });
  } catch (error) {
    return next(error);
  }
}

async function joinRoom(req, res, next) {
  try {
    const result = await partyRoomService.joinRoom(req.params.roomId, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function previewInvite(req, res, next) {
  try {
    const preview = await partyRoomService.previewInvite(
      req.params.roomId,
      req.body?.inviteToken,
    );
    return res.json({ success: true, data: preview });
  } catch (error) {
    return next(error);
  }
}

async function getSession(req, res, next) {
  try {
    const room = await partyRoomService.getRoom(
      req.params.roomId,
      req.partyActor,
    );
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function updateMe(req, res, next) {
  try {
    const room = await partyRoomService.updateMember(
      req.params.roomId,
      req.partyActor,
      req.body || {},
    );
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function castVote(req, res, next) {
  try {
    const room = await partyRoomService.castVote(
      req.params.roomId,
      req.params.candidateId,
      req.partyActor,
      req.body?.value,
    );
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function clearVote(req, res, next) {
  try {
    const room = await partyRoomService.clearVote(
      req.params.roomId,
      req.params.candidateId,
      req.partyActor,
    );
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function finalizeRoom(req, res, next) {
  try {
    const room = await partyRoomService.finalizeRoom(req.params.roomId, req.user.id);
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function reopenRoom(req, res, next) {
  try {
    const room = await partyRoomService.reopenRoom(req.params.roomId, req.user.id);
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function rotateInvite(req, res, next) {
  try {
    const invite = await partyRoomService.rotateInvite(req.params.roomId, req.user.id);
    return res.json({ success: true, data: invite });
  } catch (error) {
    return next(error);
  }
}

async function removeMember(req, res, next) {
  try {
    const room = await partyRoomService.removeMember(
      req.params.roomId,
      req.params.memberId,
      req.user.id,
    );
    return res.json({ success: true, data: room });
  } catch (error) {
    return next(error);
  }
}

async function closeRoom(req, res, next) {
  try {
    const result = await partyRoomService.closeRoom(req.params.roomId, req.user.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  castVote,
  clearVote,
  closeRoom,
  createRoom,
  finalizeRoom,
  getSession,
  joinRoom,
  listRooms,
  previewInvite,
  removeMember,
  reopenRoom,
  rotateInvite,
  updateMe,
};
