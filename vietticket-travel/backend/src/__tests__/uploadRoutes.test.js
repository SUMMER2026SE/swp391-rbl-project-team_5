const request = require('supertest');
const fs = require('fs');
const app = require('../app');
const { generateTestToken, mockValidSession } = require('./helpers/authHelper');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

function mockApprovedPartner(userId = 'partner-user-01') {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: userId,
    role: 'PARTNER',
    status: 'ACTIVE',
    tokenVersion: 0,
    profile: {},
    roleMemberships: [{ role: 'PARTNER' }],
  });
  mockValidSession(mockPrisma, userId);
  mockPrisma.partnerProfile.findUnique.mockResolvedValue({
    id: 'partner-01',
    userId,
    status: 'APPROVED',
  });
}

describe('Upload document routes', () => {
  test('blocks partner staff from reading another user private document', async () => {
    const token = generateTestToken('partner-staff-01', 'STAFF');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'partner-staff-01',
      role: 'STAFF',
      status: 'ACTIVE',
      tokenVersion: 0,
      employerPartnerId: 'partner-01',
    });
    mockValidSession(mockPrisma, 'partner-staff-01');

    const res = await request(app)
      .get('/api/upload/documents/customer-01-license.pdf')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('Kh');
  });
});

describe('Partner attraction image upload protections', () => {
  test('checks attraction ownership before quota or multipart upload processing', async () => {
    const userId = 'partner-owner-check';
    const token = generateTestToken(userId, 'PARTNER');
    mockApprovedPartner(userId);
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-foreign',
      partnerId: 'another-partner',
      archivedAt: null,
    });
    const readdir = jest.spyOn(fs.promises, 'readdir');

    const res = await request(app)
      .post('/api/partners/attractions/attr-foreign/images')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ATTRACTION_NOT_FOUND');
    expect(readdir).not.toHaveBeenCalled();
    expect(mockPrisma.attractionImage.create).not.toHaveBeenCalled();
  });

  test('applies the public upload quota on the UI partner route', async () => {
    const userId = 'partner-quota-check';
    const token = generateTestToken(userId, 'PARTNER');
    mockApprovedPartner(userId);
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-owned',
      partnerId: 'partner-01',
      archivedAt: null,
    });
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([{
      name: `${userId}-existing.jpg`,
      isFile: () => true,
    }]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 1024 * 1024 * 1024,
    });

    const res = await request(app)
      .post('/api/partners/attractions/attr-owned/images')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('UPLOAD_QUOTA_EXCEEDED');
    expect(mockPrisma.attractionImage.create).not.toHaveBeenCalled();
  });

  test('rate-limits repeated uploads through the UI partner route', async () => {
    const userId = 'partner-rate-check';
    const token = generateTestToken(userId, 'PARTNER');
    mockApprovedPartner(userId);
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-owned',
      partnerId: 'partner-01',
      archivedAt: null,
      status: 'DRAFT',
    });
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    process.env.NODE_ENV = 'development';

    const responses = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      responses.push(await request(app)
        .post('/api/partners/attractions/attr-owned/images')
        .set('Authorization', `Bearer ${token}`));
    }

    expect(responses.slice(0, 20).every((response) => response.status !== 429)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect(responses[20].body.error.code).toBe('UPLOAD_RATE_LIMITED');
  });
});
