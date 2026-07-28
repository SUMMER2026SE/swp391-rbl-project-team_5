'use strict';

const prisma = require('../config/prisma');
const { writeAuditLog } = require('../utils/auditLog');
const {
  getPolicy,
  getPricingImpact,
  previewPricing,
  savePolicy,
} = require('../services/dynamicPricingService');

// Chỉ những field này được nhận từ client. Mọi field lạ bị bỏ qua để đối tác
// không thể ghi đè cột hệ thống qua payload.
const EDITABLE_FIELDS = [
  'enabled',
  'mode',
  'highDemandThreshold',
  'lowDemandThreshold',
  'maxSurchargePercent',
  'maxDiscountPercent',
  'priceFloorPercent',
  'priceCeilingPercent',
  'roundingStep',
  'lookaheadDays',
  'minConfidence',
];

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function fail(res, error, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
  }
  return next(error);
}

async function assertPartnerAttraction(req) {
  const attractionId = String(req.params.id || '').trim();
  const attraction = await prisma.attraction.findFirst({
    where: { id: attractionId, partnerId: req.partner?.id, archivedAt: null },
    select: { id: true },
  });
  if (!attraction) {
    throw httpError(404, 'ATTRACTION_NOT_FOUND', 'Không tìm thấy điểm tham quan thuộc đối tác.');
  }
  return attractionId;
}

function pickEditable(body) {
  const payload = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = body[field];
    }
  });
  return payload;
}

// GET /api/partner/attractions/:id/pricing-policy
async function getPricingPolicy(req, res, next) {
  try {
    const attractionId = await assertPartnerAttraction(req);
    return res.json({ success: true, data: await getPolicy(attractionId) });
  } catch (error) {
    return fail(res, error, next);
  }
}

// PUT /api/partner/attractions/:id/pricing-policy
async function updatePricingPolicy(req, res, next) {
  try {
    const attractionId = await assertPartnerAttraction(req);
    const payload = pickEditable(req.body);
    if (Object.keys(payload).length === 0) {
      throw httpError(400, 'VALIDATION_ERROR', 'Không có trường hợp lệ nào để cập nhật.');
    }

    if (
      payload.lowDemandThreshold != null
      && payload.highDemandThreshold != null
      && Number(payload.lowDemandThreshold) >= Number(payload.highDemandThreshold)
    ) {
      throw httpError(
        400,
        'VALIDATION_ERROR',
        'Ngưỡng vắng khách phải nhỏ hơn ngưỡng đông khách.',
      );
    }

    const policy = await savePolicy({ attractionId, payload, actorId: req.user.id });
    await writeAuditLog({
      req,
      action: 'DYNAMIC_PRICING_POLICY_UPDATE',
      entityType: 'DynamicPricingPolicy',
      entityId: policy.id,
      metadata: {
        attractionId,
        actorType: 'PARTNER',
        changedFields: Object.keys(payload),
        enabled: policy.enabled,
        mode: policy.mode,
      },
    });
    return res.json({ success: true, data: policy });
  } catch (error) {
    return fail(res, error, next);
  }
}

// GET /api/partner/attractions/:id/pricing-preview?days=14
async function getPricingPreview(req, res, next) {
  try {
    const attractionId = await assertPartnerAttraction(req);
    const data = await previewPricing({ attractionId, days: req.query.days });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, next);
  }
}

// GET /api/partner/attractions/:id/pricing-impact?days=30
async function getImpactReport(req, res, next) {
  try {
    const attractionId = await assertPartnerAttraction(req);
    const data = await getPricingImpact({ attractionId, days: req.query.days });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, next);
  }
}

module.exports = {
  getImpactReport,
  getPricingPolicy,
  getPricingPreview,
  updatePricingPolicy,
};
