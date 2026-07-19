const { validateProductionEnv } = require('../config/runtimeConfig');

describe('validateProductionEnv - payment/refund configuration', () => {
  const validProductionEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@example.com:5432/db',
    JWT_SECRET: 'a-strong-random-secret-with-at-least-32-characters',
    FRONTEND_URL: 'https://vietticket.example',
    BACKEND_URL: 'https://api.vietticket.example',
    VNP_TMNCODE: 'TESTCODE',
    VNP_HASHSECRET: 'test-vnpay-secret',
    VNP_URL: 'https://pay.vnpay.example',
    VNP_API: 'https://api.vnpay.example/transaction',
    VNP_RETURNURL: 'https://api.vietticket.example/api/payments/vnpay-return',
    VNP_IPNURL: 'https://api.vietticket.example/api/payments/vnpay-ipn',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'secret',
    MAIL_FROM: 'VietTicket <noreply@vietticket.example>',
  };
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    Object.assign(process.env, validProductionEnv);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('production hợp lệ bắt buộc có cả VNPay Refund/QueryDR API', () => {
    expect(validateProductionEnv).not.toThrow();
  });

  test('fail fast khi production thiếu VNP_API', () => {
    delete process.env.VNP_API;
    expect(validateProductionEnv).toThrow(/VNP_API/);
  });
});
