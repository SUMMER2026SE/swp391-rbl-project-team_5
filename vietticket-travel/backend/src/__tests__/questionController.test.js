jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  answerQuestion,
  createQuestion,
  listPublicQuestions,
} = require('../controllers/questionController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('attraction Q&A', () => {
  test('rejects a question that is too short before querying the attraction', async () => {
    const res = response();
    await createQuestion({
      body: { attractionId: 'a-1', question: 'Ngắn' },
      user: { id: 'u-1' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.attraction.findFirst).not.toHaveBeenCalled();
  });

  test('creates a normalized question only for a public attraction', async () => {
    prisma.attraction.findFirst.mockResolvedValue({ id: 'a-1' });
    prisma.attractionQuestion.create.mockImplementation(({ data }) => Promise.resolve({
      id: 'q-1',
      ...data,
      createdAt: new Date(),
      user: { fullName: 'Khách QA' },
    }));
    const res = response();

    await createQuestion({
      body: { attractionId: 'a-1', question: '  Có   bãi gửi xe gần đây không?  ' },
      user: { id: 'u-1' },
    }, res, jest.fn());

    expect(prisma.attractionQuestion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        attractionId: 'a-1',
        userId: 'u-1',
        question: 'Có bãi gửi xe gần đây không?',
      },
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('does not let one partner answer another partner question', async () => {
    prisma.attractionQuestion.findFirst.mockResolvedValue(null);
    const res = response();

    await answerQuestion({
      params: { questionId: 'q-other' },
      body: { answer: 'Câu trả lời hợp lệ.' },
      partner: { id: 'partner-1' },
      user: { id: 'partner-user-1' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.attractionQuestion.update).not.toHaveBeenCalled();
  });

  test('lists public questions without exposing private user fields', async () => {
    prisma.attractionQuestion.count.mockResolvedValue(1);
    prisma.attractionQuestion.findMany.mockResolvedValue([{
      id: 'q-1',
      question: 'Có chỗ gửi xe không?',
      answer: 'Có bãi xe gần cổng.',
      answeredAt: new Date(),
      createdAt: new Date(),
      user: { fullName: 'Nguyễn A', email: 'private@example.com' },
    }]);
    const res = response();

    await listPublicQuestions({
      query: { attractionId: 'a-1' },
    }, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data[0].user).toEqual({ fullName: 'N*** A*' });
    expect(payload.data[0].user.email).toBeUndefined();
    expect(prisma.attractionQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  test('rejects direct contact details in public Q&A', async () => {
    const res = response();
    await createQuestion({
      body: {
        attractionId: 'a-1',
        question: 'Liên hệ tôi qua email guest@example.com để trả lời nhé',
      },
      user: { id: 'u-1' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.attraction.findFirst).not.toHaveBeenCalled();
  });
});
