'use strict';

const prisma = require('../config/prisma');

function getRequestIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req?.socket?.remoteAddress || req?.ip || null;
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
