'use strict';

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { validateKyc } = require('../utils/partnerValidators');
const { normalizePayoutCurrency } = require('../utils/payoutCurrency');
const { isDocumentOwnedByUser } = require('../middleware/uploadMiddleware');
const { getRequestIp, writeAuditLog } = require('../utils/auditLog');

const KYC_FIELDS = [
  'businessName',
  'businessLicenseUrl',
  'taxCode',
  'registrationDate',
  'representativeName',
  'representativePhone',
  'businessAddress',
  'bankName',
  'branchName',
  'bankAccountNumber',
  'bankAccountName',
  'swiftCode',
  'payoutCurrency',
];
const CURRENT_KYC_CHANGE_CONSENT_VERSION = '2026-07-29-v1';

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeProposedKyc(body = {}) {
  return {
    businessName: clean(body.businessName),
    businessLicenseUrl: clean(body.businessLicenseUrl),
    taxCode: clean(body.taxCode),
    registrationDate: clean(body.registrationDate),
    representativeName: clean(body.representativeName),
    representativePhone: clean(body.representativePhone),
    businessAddress: clean(body.businessAddress),
    bankName: clean(body.bankName),
    branchName: clean(body.branchName),
    bankAccountNumber: clean(body.bankAccountNumber),
    bankAccountName: clean(body.bankAccountName).toUpperCase(),
    swiftCode: clean(body.swiftCode).toUpperCase(),
    payoutCurrency: normalizePayoutCurrency(body.payoutCurrency) || '',
  };
}

function currentKyc(partner) {
  return normalizeProposedKyc({
    ...partner,
    registrationDate: dateKey(partner.registrationDate),
  });
}

function changedKycFields(partner, proposed) {
  const current = currentKyc(partner);
  return KYC_FIELDS.filter((field) => current[field] !== proposed[field]);
}

function serializeRequest(request) {
  if (!request) return null;
  const proposedData = request.proposedData || {};
  return {
    ...request,
    proposedData: proposedData.fields || proposedData,
    consentEvidence: proposedData.evidence || null,
  };
}

async function createKycChangeRequest(req, res, next) {
  try {
    if (req.partner.status !== 'APPROVED') {
      return res.status(409).json({
        code: 'PARTNER_NOT_APPROVED',
        message: 'Chỉ đối tác đang hoạt động mới có thể gửi yêu cầu thay đổi KYC.',
      });
    }
    if (req.body?.confirmedAccurate !== true) {
      return res.status(400).json({
        code: 'KYC_CHANGE_CONSENT_REQUIRED',
        message: 'Bạn phải xác nhận thông tin thay đổi là chính xác.',
      });
    }
    const reason = clean(req.body?.reason);
    if (reason.length < 10 || reason.length > 1000) {
      return res.status(400).json({
        message: 'Lý do thay đổi phải có từ 10 đến 1.000 ký tự.',
      });
    }
    const proposed = normalizeProposedKyc(req.body);
    const validationError = validateKyc({
      ...proposed,
      kycConsentAccepted: true,
    });
    if (validationError) return res.status(400).json({ message: validationError });
    const current = currentKyc(req.partner);
    if (
      proposed.businessLicenseUrl !== current.businessLicenseUrl
      && !isDocumentOwnedByUser(proposed.businessLicenseUrl, req.user.id, req)
    ) {
      return res.status(400).json({
        message: 'Tài liệu pháp lý phải thuộc tài khoản đối tác và được tải qua VietTicket.',
      });
    }
    const changedFields = changedKycFields(req.partner, proposed);
    if (changedFields.length === 0) {
      return res.status(400).json({ message: 'Không có thông tin KYC nào thay đổi.' });
    }
    const existing = await prisma.partnerKycChangeRequest.findFirst({
      where: { partnerId: req.partner.id, status: 'PENDING' },
    });
    if (existing) {
      return res.status(409).json({
        code: 'KYC_CHANGE_ALREADY_PENDING',
        message: 'Đối tác đã có một yêu cầu thay đổi KYC đang chờ duyệt.',
        data: serializeRequest(existing),
      });
    }

    const acceptedAt = new Date();
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.partnerKycChangeRequest.create({
        data: {
          partnerId: req.partner.id,
          requestedById: req.user.id,
          reason,
          proposedData: {
            fields: proposed,
            evidence: {
              consentVersion: CURRENT_KYC_CHANGE_CONSENT_VERSION,
              acceptedAt: acceptedAt.toISOString(),
              ipAddress: getRequestIp(req),
            },
          },
        },
      });
      await writeAuditLog({
        client: tx,
        req,
        action: 'PARTNER_KYC_CHANGE_REQUESTED',
        entityType: 'PARTNER_KYC_CHANGE',
        entityId: request.id,
        metadata: {
          partnerId: req.partner.id,
          changedFields,
          consentVersion: CURRENT_KYC_CHANGE_CONSENT_VERSION,
        },
      });
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return res.status(201).json({
      success: true,
      message: 'Đã gửi yêu cầu thay đổi KYC. Thông tin hiện tại vẫn có hiệu lực đến khi Admin duyệt.',
      data: serializeRequest(created),
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        code: 'KYC_CHANGE_ALREADY_PENDING',
        message: 'Đối tác đã có một yêu cầu thay đổi KYC đang chờ duyệt.',
      });
    }
    return next(error);
  }
}

async function listMyKycChangeRequests(req, res, next) {
  try {
    const requests = await prisma.partnerKycChangeRequest.findMany({
      where: { partnerId: req.partner.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return res.json({
      success: true,
      data: requests.map(serializeRequest),
    });
  } catch (error) {
    return next(error);
  }
}

async function cancelMyKycChangeRequest(req, res, next) {
  try {
    const changed = await prisma.partnerKycChangeRequest.updateMany({
      where: {
        id: req.params.id,
        partnerId: req.partner.id,
        requestedById: req.user.id,
        status: 'PENDING',
      },
      data: { status: 'CANCELLED' },
    });
    if (changed.count !== 1) {
      return res.status(409).json({
        message: 'Yêu cầu không còn ở trạng thái có thể hủy.',
      });
    }
    await writeAuditLog({
      req,
      action: 'PARTNER_KYC_CHANGE_CANCELLED',
      entityType: 'PARTNER_KYC_CHANGE',
      entityId: req.params.id,
      metadata: { partnerId: req.partner.id },
    });
    return res.json({ success: true, message: 'Đã hủy yêu cầu thay đổi KYC.' });
  } catch (error) {
    return next(error);
  }
}

async function listKycChangeRequests(req, res, next) {
  try {
    const status = clean(req.query?.status || 'PENDING').toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái yêu cầu KYC không hợp lệ.' });
    }
    const requests = await prisma.partnerKycChangeRequest.findMany({
      where: status === 'ALL' ? {} : { status },
      include: {
        partner: {
          select: {
            id: true,
            status: true,
            ...Object.fromEntries(KYC_FIELDS.map((field) => [field, true])),
          },
        },
        requestedBy: { select: { id: true, fullName: true, email: true } },
        reviewedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return res.json({
      success: true,
      data: requests.map(serializeRequest),
    });
  } catch (error) {
    return next(error);
  }
}

async function reviewKycChangeRequest(req, res, next) {
  try {
    const action = clean(req.body?.action).toUpperCase();
    const reviewNote = clean(req.body?.reviewNote);
    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ message: 'Action phải là APPROVED hoặc REJECTED.' });
    }
    if (action === 'REJECTED' && (reviewNote.length < 10 || reviewNote.length > 1000)) {
      return res.status(400).json({ message: 'Lý do từ chối phải có từ 10 đến 1.000 ký tự.' });
    }
    const request = await prisma.partnerKycChangeRequest.findUnique({
      where: { id: req.params.id },
      include: { partner: true },
    });
    if (!request || request.status !== 'PENDING') {
      return res.status(409).json({ message: 'Yêu cầu KYC không còn chờ duyệt.' });
    }
    if (request.requestedById === req.user.id) {
      return res.status(403).json({
        code: 'SELF_REVIEW_FORBIDDEN',
        message: 'Người gửi yêu cầu không được tự duyệt thay đổi KYC.',
      });
    }
    const proposed = request.proposedData?.fields || request.proposedData;
    const changedFields = changedKycFields(request.partner, proposed);
    if (action === 'APPROVED') {
      const validationError = validateKyc({
        ...proposed,
        kycConsentAccepted: true,
      });
      if (validationError) {
        return res.status(409).json({
          code: 'KYC_CHANGE_INVALID',
          message: `Dữ liệu thay đổi không còn hợp lệ: ${validationError}`,
        });
      }
      const current = currentKyc(request.partner);
      if (
        proposed.businessLicenseUrl !== current.businessLicenseUrl
        && !isDocumentOwnedByUser(
          proposed.businessLicenseUrl,
          request.requestedById,
          req,
        )
      ) {
        return res.status(409).json({
          code: 'KYC_DOCUMENT_INVALID',
          message: 'Tài liệu pháp lý không còn đáng tin cậy.',
        });
      }
    }

    const reviewedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerKycChangeRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: {
          status: action,
          reviewedById: req.user.id,
          reviewedAt,
          reviewNote: reviewNote || null,
        },
      });
      if (claimed.count !== 1) {
        const error = new Error('Yêu cầu vừa được quản trị viên khác xử lý.');
        error.statusCode = 409;
        throw error;
      }
      if (action === 'APPROVED') {
        await tx.partnerProfile.update({
          where: { id: request.partnerId },
          data: {
            businessName: proposed.businessName,
            businessLicenseUrl: proposed.businessLicenseUrl,
            taxCode: proposed.taxCode,
            registrationDate: new Date(`${proposed.registrationDate}T00:00:00.000Z`),
            representativeName: proposed.representativeName,
            representativePhone: proposed.representativePhone,
            businessAddress: proposed.businessAddress,
            bankName: proposed.bankName,
            branchName: proposed.branchName,
            bankAccountNumber: proposed.bankAccountNumber,
            bankAccountName: proposed.bankAccountName,
            swiftCode: proposed.swiftCode || null,
            payoutCurrency: proposed.payoutCurrency,
            kycConsentAccepted: true,
            kycConsentVersion: request.proposedData?.evidence?.consentVersion
              || CURRENT_KYC_CHANGE_CONSENT_VERSION,
            kycConsentAcceptedAt: request.proposedData?.evidence?.acceptedAt
              ? new Date(request.proposedData.evidence.acceptedAt)
              : request.createdAt,
            kycConsentIpAddress:
              request.proposedData?.evidence?.ipAddress || null,
          },
        });
      }
      await writeAuditLog({
        client: tx,
        req,
        action: action === 'APPROVED'
          ? 'PARTNER_KYC_CHANGE_APPROVED'
          : 'PARTNER_KYC_CHANGE_REJECTED',
        entityType: 'PARTNER_KYC_CHANGE',
        entityId: request.id,
        metadata: {
          partnerId: request.partnerId,
          changedFields,
          reviewNote: reviewNote || null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return res.json({
      success: true,
      message: action === 'APPROVED'
        ? 'Đã duyệt và áp dụng thay đổi KYC.'
        : 'Đã từ chối yêu cầu thay đổi KYC.',
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({
        message: 'Mã số thuế đã thuộc một đối tác khác hoặc yêu cầu vừa được xử lý.',
      });
    }
    return next(error);
  }
}

module.exports = {
  KYC_FIELDS,
  cancelMyKycChangeRequest,
  createKycChangeRequest,
  listKycChangeRequests,
  listMyKycChangeRequests,
  reviewKycChangeRequest,
};
