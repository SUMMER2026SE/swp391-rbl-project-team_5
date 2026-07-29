'use strict';

const CURRENT_TERMS_VERSION = '2026-07-29-v2';
const CURRENT_PRIVACY_VERSION = '2026-07-29-v2';

function hasCurrentPolicyConsent(user) {
  return Boolean(
    user?.termsAcceptedAt
    && user?.termsVersion === CURRENT_TERMS_VERSION
    && user?.privacyVersion === CURRENT_PRIVACY_VERSION,
  );
}

module.exports = {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  hasCurrentPolicyConsent,
};
