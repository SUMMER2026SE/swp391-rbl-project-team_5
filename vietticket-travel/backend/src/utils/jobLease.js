'use strict';

const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

async function acquireJobLease(jobName, ttlMs, ownerId = randomUUID()) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  const updated = await prisma.scheduledJobLock.updateMany({
    where: {
      jobName,
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
        { lockedBy: ownerId },
      ],
    },
    data: { lockedBy: ownerId, lockedUntil },
  });
  if (updated.count === 1) return ownerId;

  try {
    await prisma.scheduledJobLock.create({
      data: { jobName, lockedBy: ownerId, lockedUntil },
    });
    return ownerId;
  } catch (error) {
    if (error.code === 'P2002') return null;
    throw error;
  }
}

async function releaseJobLease(jobName, ownerId) {
  await prisma.scheduledJobLock.updateMany({
    where: { jobName, lockedBy: ownerId },
    data: { lockedBy: null, lockedUntil: null },
  });
}

async function runWithJobLease(jobName, ttlMs, task) {
  const ownerId = await acquireJobLease(jobName, ttlMs);
  if (!ownerId) return { acquired: false, result: null };

  try {
    return { acquired: true, result: await task() };
  } finally {
    await releaseJobLease(jobName, ownerId).catch((error) => {
      console.error(`[job-lease] Không thể giải phóng khóa ${jobName}:`, error.message);
    });
  }
}

module.exports = {
  acquireJobLease,
  releaseJobLease,
  runWithJobLease,
};
