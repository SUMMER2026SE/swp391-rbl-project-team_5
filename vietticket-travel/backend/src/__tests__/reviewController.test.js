const request = require('supertest');
const app = require('../app');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { generateTestToken } = require('./helpers/authHelper');

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');

afterEach(() => jest.clearAllMocks());

describe('Review Routes Integration Tests', () => {
  describe('GET /api/reviews', () => {
    test('✅ Lấy danh sách reviews công khai của attractionId thành công', async () => {
      mockPrisma.review.findMany.mockResolvedValue([
        {
          id: 'rev-001',
          rating: 5,
          comment: 'Rất tuyệt vời!',
          replyComment: 'Cảm ơn bạn',
          repliedAt: new Date(),
          createdAt: new Date(),
          user: {
            fullName: 'Nguyen Van A',
            profile: { avatarUrl: 'http://avatar.url' }
          }
        }
      ]);

      const res = await request(app)
        .get('/api/reviews')
        .query({ attractionId: 'attr-001' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].comment).toBe('Rất tuyệt vời!');
      expect(mockPrisma.review.findMany).toHaveBeenCalled();
    });

    test('❌ Trả 400 nếu không truyền attractionId', async () => {
      const res = await request(app).get('/api/reviews');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Thiếu attractionId');
    });
  });

  describe('POST /api/reviews', () => {
    test('❌ Trả 401 nếu chưa đăng nhập', async () => {
      const res = await request(app).post('/api/reviews').send({ bookingId: 'b-01', rating: 5 });
      expect(res.status).toBe(401);
    });

    test('❌ Trả 403 nếu không phải CUSTOMER', async () => {
      const token = generateTestToken('user-01', 'PARTNER');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-01', role: 'PARTNER', status: 'ACTIVE' });

      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId: 'b-01', rating: 5 });

      expect(res.status).toBe(403);
    });

    test('✅ Tạo review thành công cho booking COMPLETED chưa đánh giá', async () => {
      const token = generateTestToken('user-01', 'CUSTOMER');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-01', role: 'CUSTOMER', status: 'ACTIVE' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-01',
        userId: 'user-01',
        status: 'COMPLETED',
        review: null,
        reservation: {
          ticketProduct: {
            attractionId: 'attr-01'
          }
        }
      });
      mockPrisma.review.findMany.mockResolvedValue([{ rating: 5 }]);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });
      mockPrisma.review.create.mockResolvedValue({
        id: 'rev-01',
        userId: 'user-01',
        attractionId: 'attr-01',
        bookingId: 'booking-01',
        rating: 5,
        comment: 'Tuyệt'
      });

      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId: 'booking-01', rating: 5, comment: 'Tuyệt' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('rev-01');
      expect(mockPrisma.review.create).toHaveBeenCalled();
      expect(mockPrisma.attraction.update).toHaveBeenCalled();
    });
  });

  describe('POST /api/reviews/:reviewId/reply', () => {
    test('✅ Đối tác phản hồi đánh giá thuộc attraction của mình thành công', async () => {
      const token = generateTestToken('partner-user-01', 'PARTNER');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'partner-user-01', role: 'PARTNER', status: 'ACTIVE' });
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-01', userId: 'partner-user-01', status: 'APPROVED' });
      mockPrisma.review.findUnique.mockResolvedValue({
        id: 'rev-01',
        attraction: {
          partnerId: 'partner-01'
        }
      });
      mockPrisma.review.update.mockResolvedValue({
        id: 'rev-01',
        replyComment: 'Cảm ơn bạn đã phản hồi!'
      });

      const res = await request(app)
        .post('/api/reviews/rev-01/reply')
        .set('Authorization', `Bearer ${token}`)
        .send({ replyComment: 'Cảm ơn bạn đã phản hồi!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replyComment).toBe('Cảm ơn bạn đã phản hồi!');
    });

    test('❌ Trả 403 nếu đối tác không sở hữu địa điểm được đánh giá', async () => {
      const token = generateTestToken('partner-user-01', 'PARTNER');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'partner-user-01', role: 'PARTNER', status: 'ACTIVE' });
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-01', userId: 'partner-user-01' });
      mockPrisma.review.findUnique.mockResolvedValue({
        id: 'rev-01',
        attraction: {
          partnerId: 'different-partner-02'
        }
      });

      const res = await request(app)
        .post('/api/reviews/rev-01/reply')
        .set('Authorization', `Bearer ${token}`)
        .send({ replyComment: 'Hacker reply' });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/reviews/:reviewId/moderate', () => {
    test('✅ Admin ẩn đánh giá vi phạm thành công', async () => {
      const token = generateTestToken('admin-01', 'ADMIN');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'admin-01', role: 'ADMIN', status: 'ACTIVE' });
      mockPrisma.review.findUnique.mockResolvedValue({
        id: 'rev-01',
        attractionId: 'attr-01'
      });
      mockPrisma.review.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });
      mockPrisma.review.update.mockResolvedValue({
        id: 'rev-01',
        isHidden: true
      });

      const res = await request(app)
        .patch('/api/reviews/rev-01/moderate')
        .set('Authorization', `Bearer ${token}`)
        .send({ isHidden: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isHidden).toBe(true);
    });
  });

  describe('GET /api/partners/reviews', () => {
    test('✅ Lấy danh sách reviews của đối tác thành công', async () => {
      const token = generateTestToken('partner-user-01', 'PARTNER');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'partner-user-01', role: 'PARTNER', status: 'ACTIVE' });
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-01', userId: 'partner-user-01', status: 'APPROVED' });
      mockPrisma.review.findMany.mockResolvedValue([
        {
          id: 'rev-01',
          rating: 4,
          comment: 'Khá ok',
          attraction: { title: 'Bà Nà Hills' },
          user: { fullName: 'Tran Thi B', profile: { avatarUrl: null } }
        }
      ]);

      const res = await request(app)
        .get('/api/partners/reviews')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].attraction.title).toBe('Bà Nà Hills');
    });

    test('✅ Lấy thống kê reviews của đối tác thành công', async () => {
      const token = generateTestToken('partner-user-01', 'PARTNER');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'partner-user-01', role: 'PARTNER', status: 'ACTIVE' });
      mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'partner-01', userId: 'partner-user-01', status: 'APPROVED' });
      mockPrisma.review.findMany.mockResolvedValue([
        { rating: 5, isHidden: false, replyComment: null },
        { rating: 4, isHidden: false, replyComment: 'Reply' }
      ]);

      const res = await request(app)
        .get('/api/partners/reviews/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.averageRating).toBe(4.5);
      expect(res.body.data.totalReviews).toBe(2);
      expect(res.body.data.unrepliedReviews).toBe(1);
    });
  });

  describe('GET /api/admin/reviews', () => {
    test('✅ Lấy danh sách reviews quản trị thành công', async () => {
      const token = generateTestToken('admin-01', 'ADMIN');
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'admin-01', role: 'ADMIN', status: 'ACTIVE' });
      mockPrisma.review.findMany.mockResolvedValue([
        {
          id: 'rev-01',
          rating: 5,
          comment: 'Admin review list',
          attraction: { title: 'Vịnh Hạ Long' },
          user: { fullName: 'Le Van C', email: 'le@van.c' }
        }
      ]);

      const res = await request(app)
        .get('/api/admin/reviews')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].comment).toBe('Admin review list');
    });
  });
});
