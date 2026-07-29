'use strict';

const {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasCurrentPolicyConsent,
} = require('../config/policyVersions');

function requireCurrentPolicyConsent(req, res, next) {
  if (hasCurrentPolicyConsent(req.user)) return next();
  return res.status(428).json({
    success: false,
    code: 'POLICY_REACCEPTANCE_REQUIRED',
    message: 'Vui lòng đồng ý phiên bản Điều khoản và Chính sách bảo mật hiện hành để tiếp tục.',
    currentTermsVersion: CURRENT_TERMS_VERSION,
    currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
  });
}

module.exports = {
  requireCurrentPolicyConsent,
};
