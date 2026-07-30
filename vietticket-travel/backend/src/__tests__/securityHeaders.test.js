const request = require('supertest');

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const app = require('../app');

describe('frontend security headers', () => {
  test('allow production images and Google Identity without weakening script policy', async () => {
    const response = await request(app).get('/api/route-that-does-not-exist');
    const csp = response.headers['content-security-policy'];

    expect(response.status).toBe(404);
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain(
      "script-src 'self' https://accounts.google.com/gsi/client",
    );
    expect(csp).toContain(
      "frame-src 'self' https://accounts.google.com/gsi/",
    );
    expect(csp).toContain(
      "connect-src 'self' https://accounts.google.com/gsi/",
    );
    expect(response.headers['cross-origin-opener-policy']).toBe(
      'same-origin-allow-popups',
    );
  });
});
