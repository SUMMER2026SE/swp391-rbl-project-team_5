'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const protect = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/roleMiddleware');
const { requireCurrentPolicyConsent } = require('../middleware/policyConsentMiddleware');
const questionController = require('../controllers/questionController');

const router = express.Router();
const createQuestionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Bạn đã gửi quá nhiều câu hỏi. Vui lòng thử lại sau.' },
});
const reportQuestionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Bạn đã gửi quá nhiều báo cáo. Vui lòng thử lại sau.' },
});

router.get('/', questionController.listPublicQuestions);
router.post(
  '/',
  protect,
  restrictTo('CUSTOMER'),
  requireCurrentPolicyConsent,
  createQuestionLimiter,
  questionController.createQuestion,
);
router.post(
  '/:questionId/report',
  protect,
  restrictTo('CUSTOMER'),
  requireCurrentPolicyConsent,
  reportQuestionLimiter,
  questionController.reportQuestion,
);

module.exports = router;
