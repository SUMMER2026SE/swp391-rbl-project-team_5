'use strict';

const prisma = require('../config/prisma');

function getRequestIp(req) {
  // Express computes req.ip according to the configured trust-proxy topology.
  // Reading X-Forwarded-For directly would let clients forge audit evidence.
  return req?.ip || req?.socket?.remoteAddress || null;
}

async function writeAuditLog({
  client = prisma,
  req,
  actorId,
  action,
  entityType,
  entityId,
  metadata,
}) {
  return client.auditLog.create({
    data: {
      actorId: actorId || req?.user?.id || null,
      action,
      entityType,
      entityId: entityId || null,
      ipAddress: getRequestIp(req),
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: metadata || undefined,
    },
  });
}

module.exports = {
  getRequestIp,
  writeAuditLog,
};
