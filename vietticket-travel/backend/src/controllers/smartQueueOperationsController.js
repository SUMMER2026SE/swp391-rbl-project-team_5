'use strict';

const prisma = require('../config/prisma');
const { hasRole } = require('../utils/userRoles');
const { writeAuditLog } = require('../utils/auditLog');
const {
  listQueueOperations,
  getPolicy: readPolicy,
  saveQueuePolicy,
  setQueuePause,
  transitionQueueEntry,
} = require('../services/smartQueueOperationsService');

function httpError(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = message ? code : undefined;
  return error;
}

async function assertStaffAttractionAccess(user, attractionId, client = prisma) {
  if (hasRole(user, 'ADMIN')) return;
  const assignment = await client.staffAttractionAssignment.findFirst({
    where: { staffId: user.id, attractionId, revokedAt: null },
    select: { id: true },
  });
  if (!assignment) throw httpError(403, 'STAFF_ATTRACTION_FORBIDDEN', 'Bạn chưa được phân công vận hành điểm tham quan này.');
}

async function assertPartnerAttraction(req, attractionId) {
  const attraction = await prisma.attraction.findFirst({
    where: { id: attractionId, partnerId: req.partner?.id, archivedAt: null },
    select: { id: true },
  });
  if (!attraction) throw httpError(404, 'ATTRACTION_NOT_FOUND', 'Không tìm thấy điểm tham quan thuộc đối tác.');
}

async function listAssignedAttractions(req, res, next) {
  try {
    const where = hasRole(req.user, 'ADMIN')
      ? { status: 'APPROVED', archivedAt: null }
      : { status: 'APPROVED', archivedAt: null, staffAssignments: { some: { staffId: req.user.id, revokedAt: null } } };
    const attractions = await prisma.attraction.findMany({
      where,
      select: { id: true, title: true, city: true, operationalStatus: true },
      orderBy: { title: 'asc' },
    });
    return res.json({ success: true, data: attractions });
  } catch (error) {
    return next(error);
  }
}

async function getOverview(req, res, next) {
  try {
    const attractionId = String(req.query.attractionId || '').trim();
    await assertStaffAttractionAccess(req.user, attractionId);
    const data = await listQueueOperations({
      attractionId,
      date: req.query.date,
      now: new Date(),
    });
    return res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function actOnEntry(req, res, next) {
  try {
    const entry = await prisma.smartQueueEntry.findUnique({ where: { id: req.params.entryId }, select: { attractionId: true } });
    if (!entry) return res.status(404).json({ success: false, error: { message: 'Không tìm thấy lượt SmartQueue.' } });
    await assertStaffAttractionAccess(req.user, entry.attractionId);
    const action = req.body?.action || (req.path.endsWith('/no-show') ? 'NO_SHOW' : 'CALL');
    const updated = await transitionQueueEntry({ entryId: req.params.entryId, action, actorId: req.user.id });
    await writeAuditLog({
      req,
      action: `SMART_QUEUE_${String(action).toUpperCase()}`,
      entityType: 'SmartQueueEntry',
      entityId: req.params.entryId,
      metadata: { attractionId: entry.attractionId },
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function pauseQueue(req, res, next) {
  try {
    const attractionId = String(req.params.attractionId || '').trim();
    await assertStaffAttractionAccess(req.user, attractionId);
    const policy = await setQueuePause({ attractionId, paused: true, reason: req.body?.reason, actorId: req.user.id });
    await writeAuditLog({ req, action: 'SMART_QUEUE_PAUSE', entityType: 'SmartQueuePolicy', entityId: policy.id, metadata: { attractionId, reason: policy.pauseReason } });
    return res.json({ success: true, data: policy });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function resumeQueue(req, res, next) {
  try {
    const attractionId = String(req.params.attractionId || '').trim();
    await assertStaffAttractionAccess(req.user, attractionId);
    const policy = await setQueuePause({ attractionId, paused: false, actorId: req.user.id });
    await writeAuditLog({ req, action: 'SMART_QUEUE_RESUME', entityType: 'SmartQueuePolicy', entityId: policy.id, metadata: { attractionId } });
    return res.json({ success: true, data: policy });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function getPolicy(req, res, next) {
  try {
    const attractionId = String(req.params.attractionId || '').trim();
    await assertStaffAttractionAccess(req.user, attractionId);
    const policy = await readPolicy(attractionId);
    return res.json({ success: true, data: policy });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function updatePolicy(req, res, next) {
  try {
    const attractionId = String(req.params.attractionId || '').trim();
    await assertStaffAttractionAccess(req.user, attractionId);
    const policy = await saveQueuePolicy({ attractionId, payload: req.body, actorId: req.user.id });
    await writeAuditLog({ req, action: 'SMART_QUEUE_POLICY_UPDATE', entityType: 'SmartQueuePolicy', entityId: policy.id, metadata: { attractionId, changedFields: Object.keys(req.body || {}) } });
    return res.json({ success: true, data: policy });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function getPartnerPolicy(req, res, next) {
  try {
    const attractionId = String(req.params.id || '').trim();
    await assertPartnerAttraction(req, attractionId);
    return res.json({ success: true, data: await readPolicy(attractionId) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

async function updatePartnerPolicy(req, res, next) {
  try {
    const attractionId = String(req.params.id || '').trim();
    await assertPartnerAttraction(req, attractionId);
    const policy = await saveQueuePolicy({ attractionId, payload: req.body, actorId: req.user.id });
    await writeAuditLog({ req, action: 'SMART_QUEUE_POLICY_UPDATE', entityType: 'SmartQueuePolicy', entityId: policy.id, metadata: { attractionId, actorType: 'PARTNER', changedFields: Object.keys(req.body || {}) } });
    return res.json({ success: true, data: policy });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    return next(error);
  }
}

module.exports = {
  actOnEntry,
  getOverview,
  getPolicy,
  getPartnerPolicy,
  listAssignedAttractions,
  pauseQueue,
  resumeQueue,
  updatePolicy,
  updatePartnerPolicy,
};
