jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  listPublicReviews,
  toggleHelpfulVote,
} = require('../controllers/reviewController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.review.count.mockResolvedValue(0);
  prisma.review.groupBy.mockResolvedValue([]);
  prisma.review.findMany.mockResolvedValue([]);
});

describe('review helpful votes', () => {
  test('prevents authors from upvoting their own review', async () => {
    prisma.review.findFirst.mockResolvedValue({ id: 'r-1', userId: 'u-1' });
    const res = response();

    await toggleHelpfulVote({
      params: { reviewId: 'r-1' },
      user: { id: 'u-1' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prisma.reviewHelpfulVote.create).not.toHaveBeenCalled();
  });

  test('toggles an existing vote off and returns the authoritative count', async () => {
    prisma.review.findFirst.mockResolvedValue({ id: 'r-1', userId: 'author' });
    prisma.reviewHelpfulVote.findUnique.mockResolvedValue({ reviewId: 'r-1', userId: 'u-1' });
    prisma.reviewHelpfulVote.count.mockResolvedValue(2);
    const res = response();

    await toggleHelpfulVote({
      params: { reviewId: 'r-1' },
      user: { id: 'u-1' },
    }, res, jest.fn());

    expect(prisma.reviewHelpfulVote.delete).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: { reviewId: 'r-1', helpful: false, helpfulCount: 2 },
    }));
  });

  test('marks reviews already upvoted by the signed-in viewer', async () => {
    prisma.review.count.mockResolvedValue(1);
    prisma.review.findMany.mockResolvedValue([{
      id: 'r-1',
      rating: 5,
      comment: 'Tốt',
      imageUrls: [],
      travelerType: null,
      _count: { helpfulVotes: 3 },
      createdAt: new Date(),
      user: { fullName: 'Khách', profile: null },
    }]);
    prisma.reviewHelpfulVote.findMany.mockResolvedValue([{ reviewId: 'r-1' }]);
    const res = response();

    await listPublicReviews({
      query: { attractionId: 'a-1' },
      user: { id: 'viewer' },
    }, res, jest.fn());

    expect(res.json.mock.calls[0][0].data[0]).toEqual(expect.objectContaining({
      helpfulCount: 3,
      isHelpful: true,
    }));
  });
});
