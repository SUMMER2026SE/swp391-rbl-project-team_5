const {
  getTrustProxySetting,
  validateProductionEnv,
} = require('../config/runtimeConfig');

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
    ML_SERVICE_URL: 'https://ml.vietticket.example',
    ML_SERVICE_API_KEY: 'a-strong-ml-service-secret-with-32-characters',
    TRUST_PROXY: '1',
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

  test('fail fast khi production dùng ML service không được bảo vệ', () => {
    process.env.ML_SERVICE_API_KEY = 'weak';
    expect(validateProductionEnv).toThrow(/ML_SERVICE_API_KEY/);
  });

  test('fail fast khi production trỏ ML service về localhost', () => {
    process.env.ML_SERVICE_URL = 'http://localhost:8000';
    expect(validateProductionEnv).toThrow(/ML_SERVICE_URL/);
  });

  test.each([
    ['false', false],
    ['true', 1],
    ['2', 2],
    ['loopback,10.0.0.0/8', ['loopback', '10.0.0.0/8']],
  ])('chuẩn hóa TRUST_PROXY an toàn: %s', (value, expected) => {
    expect(getTrustProxySetting(value)).toEqual(expected);
  });

  test('từ chối TRUST_PROXY không hợp lệ thay vì tin header giả mạo', () => {
    expect(() => getTrustProxySetting('*')).toThrow(/TRUST_PROXY/);
  });

  test('fail fast khi cấu hình tỷ giá payout bị hỏng', () => {
    process.env.PAYOUT_EXCHANGE_RATES = '{"USD":0}';
    expect(validateProductionEnv).toThrow(/USD/);
  });
});
