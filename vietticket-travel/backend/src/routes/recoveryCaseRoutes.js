'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requireCurrentPolicyConsent } = require('../middleware/policyConsentMiddleware');
const {
  acceptOption,
  declineCase,
  getRecoveryCase,
  listRecoveryCases,
} = require('../controllers/recoveryCaseController');

const router = express.Router();

router.use(protect, restrictTo('CUSTOMER'));
router.get('/', listRecoveryCases);
router.get('/:id', getRecoveryCase);
router.post('/:id/accept', requireCurrentPolicyConsent, acceptOption);
router.post('/:id/decline', requireCurrentPolicyConsent, declineCase);

module.exports = router;
