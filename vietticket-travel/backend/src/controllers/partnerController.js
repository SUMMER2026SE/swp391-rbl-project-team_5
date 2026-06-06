const prisma = require('../config/prisma');

async function registerPartner(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });
    }

    const { businessName, businessLicenseUrl, taxCode, bankName, bankAccountNumber, bankAccountName } = req.body || {};

    if (!businessName || String(businessName).trim() === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'businessName is required' } });
    }

    if (!taxCode || String(taxCode).trim() === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'taxCode is required' } });
    }

    const existing = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (existing) {
      return res.status(409).json({ success: false, error: { code: 'ALREADY_PARTNER', message: 'User already has a partner profile' } });
    }

    const partner = await prisma.partnerProfile.create({
      data: {
        userId,
        businessName,
        businessLicenseUrl: businessLicenseUrl || null,
        taxCode,
        bankName: bankName || null,
        bankAccountNumber: bankAccountNumber || null,
        bankAccountName: bankAccountName || null,
        // status defaults to PENDING in schema
      },
    });

    return res.status(201).json({ success: true, data: {
      id: partner.id,
      userId: partner.userId,
      businessName: partner.businessName,
      status: partner.status,
      createdAt: partner.createdAt,
    } });
  } catch (error) {
    return next(error);
  }
}

async function getMyPartnerProfile(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });
    }

    const profile = await prisma.partnerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        businessName: true,
        status: true,
        commissionRate: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountName: true,
        rejectionReason: true,
        createdAt: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Partner profile not found' } });
    }

    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    return next(error);
  }
}

module.exports = { registerPartner, getMyPartnerProfile };
