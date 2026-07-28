'use strict';

const express = require('express');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
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
router.post('/:id/accept', acceptOption);
router.post('/:id/decline', declineCase);

module.exports = router;
