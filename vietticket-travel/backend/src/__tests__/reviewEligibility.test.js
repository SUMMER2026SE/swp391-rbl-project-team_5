const { isReviewEligible } = require('../utils/reviewEligibility');

test('chỉ booking COMPLETED mới được đánh giá', () => {
  expect(isReviewEligible({ status: 'COMPLETED' })).toEqual({ allowed: true });
  expect(isReviewEligible({
    status: 'CONFIRMED',
    ticketInstances: [{ status: 'USED' }],
  })).toEqual({
    allowed: false,
    reason: 'Bạn chỉ được đánh giá sau khi đơn đã hoàn thành.',
  });
  expect(isReviewEligible({ status: 'NO_SHOW' }).allowed).toBe(false);
});
