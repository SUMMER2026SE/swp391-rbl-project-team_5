# 🧪 BACKEND TEST TASKS – VietTicket Travel
> **Stack:** Jest + Supertest (Integration) + Jest thuần (Unit)
> **Copilot:** Đọc file này và implement theo từng phần. Luôn tham khảo code thực tế trong repo trước khi viết test.

---

## ⚠️ QUY TẮC BẮT BUỘC

```
1. CommonJS: require/module.exports - KHÔNG dùng import/export
2. Test file đặt tại: backend/src/__tests__/
3. Mỗi nhóm API 1 file test riêng
4. Dùng jest.mock() để mock Prisma - KHÔNG gọi DB thật trong unit test
5. Integration test dùng supertest gọi HTTP thật vào app (không server.listen)
6. Sau mỗi test: dọn dẹp mock bằng afterEach(() => jest.clearAllMocks())
```

---

## BƯỚC 0 – CÀI ĐẶT (CHẠY TRƯỚC KHI LÀM GÌ)

```powershell
cd backend
npm install --save-dev jest supertest @jest/globals
```

Sau đó thêm vào `backend/package.json` phần scripts:

```json
"scripts": {
  "dev": "nodemon src/server.js",
  "start": "node src/server.js",
  "test": "jest --runInBand --forceExit",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "prisma:migrate": "prisma migrate dev",
  "prisma:generate": "prisma generate"
}
```

Thêm config Jest vào cuối `backend/package.json`:

```json
"jest": {
  "testEnvironment": "node",
  "testMatch": ["**/__tests__/**/*.test.js"],
  "coverageDirectory": "coverage",
  "collectCoverageFrom": [
    "src/controllers/**/*.js",
    "src/utils/**/*.js"
  ]
}
```

---

## BƯỚC 1 – TẠO TEST HELPER & MOCK SETUP

### Tạo file: `backend/src/__tests__/helpers/mockPrisma.js`

```javascript
// Mock toàn bộ Prisma client để test không cần DB thật
// Copilot: tạo file này với nội dung sau

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  partnerProfile: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  attraction: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  ticketProduct: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  timeSlot: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  dailyStock: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  timeSlotStock: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  reservation: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

module.exports = mockPrisma;
```

### Tạo file: `backend/src/__tests__/helpers/authHelper.js`

```javascript
// Tạo JWT token giả để test các endpoint cần auth
// Copilot: implement hàm generateTestToken(userId, role)
// Dùng jsonwebtoken với JWT_SECRET từ process.env hoặc 'test-secret'

const jwt = require('jsonwebtoken');

function generateTestToken(userId = 'user-001', role = 'CUSTOMER') {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

module.exports = { generateTestToken };
```

---

## BƯỚC 2 – UNIT TESTS: PARTNER CONTROLLER

### Tạo file: `backend/src/__tests__/partnerController.test.js`

```javascript
// Copilot: viết unit test cho partnerController.js
// Mock prisma và test từng hàm độc lập

jest.mock('../../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { registerPartner, getMyPartnerProfile } = require('../controllers/partnerController');

// Helper tạo mock req/res/next
function mockReqRes(body = {}, user = { id: 'user-001' }) {
  const req = { body, user };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

afterEach(() => jest.clearAllMocks());

// ===== registerPartner =====
describe('registerPartner', () => {
  test('✅ Tạo partner profile thành công', async () => {
    // Setup: chưa có profile, tạo thành công
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
    mockPrisma.partnerProfile.create.mockResolvedValue({
      id: 'p-001',
      userId: 'user-001',
      businessName: 'Công ty Test',
      status: 'PENDING',
      createdAt: new Date(),
    });

    const { req, res, next } = mockReqRes({
      businessName: 'Công ty Test',
      taxCode: '0123456789',
    });

    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test('❌ Trả 409 nếu đã có partner profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-existing' });

    const { req, res, next } = mockReqRes({ businessName: 'Test', taxCode: '123' });
    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('❌ Trả 400 nếu thiếu businessName', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);

    const { req, res, next } = mockReqRes({ taxCode: '0123456789' }); // thiếu businessName
    await registerPartner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ===== getMyPartnerProfile =====
describe('getMyPartnerProfile', () => {
  test('✅ Trả về profile nếu tìm thấy', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue({
      id: 'p-001',
      businessName: 'Công ty Test',
      status: 'APPROVED',
    });

    const { req, res, next } = mockReqRes();
    await getMyPartnerProfile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  test('❌ Trả 404 nếu không có profile', async () => {
    mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);

    const { req, res, next } = mockReqRes();
    await getMyPartnerProfile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
```

---

## BƯỚC 3 – UNIT TESTS: ATTRACTION CONTROLLER

### Tạo file: `backend/src/__tests__/attractionController.test.js`

```javascript
// Copilot: viết unit test cho attractionController.js
// Tập trung vào 4 hàm: createAttraction, submitAttraction, searchAttractions, getAttractionDetail

jest.mock('../../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const {
  createAttraction,
  submitAttraction,
  searchAttractions,
  getAttractionDetail,
} = require('../controllers/attractionController');

afterEach(() => jest.clearAllMocks());

// ===== searchAttractions =====
describe('searchAttractions', () => {
  test('✅ Trả về danh sách + pagination đúng format', async () => {
    const fakeAttractions = [
      { id: 'attr-001', title: 'Suối Tiên', city: 'Ho Chi Minh', images: [], ticketProducts: [] }
    ];
    mockPrisma.$transaction.mockResolvedValue([fakeAttractions, 1]);

    const req = { query: { page: '1', limit: '10' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await searchAttractions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          attractions: expect.any(Array),
          pagination: expect.objectContaining({
            totalItems: 1,
            currentPage: 1,
          }),
        }),
      })
    );
  });

  test('✅ Lọc theo city', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);

    const req = { query: { city: 'Hanoi', page: '1', limit: '10' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await searchAttractions(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ===== getAttractionDetail =====
describe('getAttractionDetail', () => {
  test('✅ Trả về chi tiết nếu tìm thấy và status APPROVED', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Suối Tiên',
      status: 'APPROVED',
      images: [],
      categories: [],
      ticketProducts: [],
    });

    const req = { params: { id: 'attr-001' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAttractionDetail(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Trả 404 nếu không tìm thấy', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);

    const req = { params: { id: 'not-exist' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAttractionDetail(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
```

---

## BƯỚC 4 – UNIT TESTS: OVERBOOKING (Quan trọng nhất!)

### Tạo file: `backend/src/__tests__/ticketController.test.js`

```javascript
// Copilot: viết unit test cho ticketController.js
// Tập trung vào reserveTickets - đây là logic quan trọng nhất cần test kỹ

jest.mock('../../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { reserveTickets, checkAvailability } = require('../controllers/ticketController');

afterEach(() => jest.clearAllMocks());

// ===== reserveTickets =====
describe('reserveTickets - Chống Overbooking', () => {
  const mockUser = { id: 'user-001' };
  const mockTicket = { id: 'tkt-001', status: 'ACTIVE', attractionId: 'attr-001' };

  function makeReq(body = {}) {
    return {
      params: { ticketProductId: 'tkt-001' },
      body: { date: '2026-06-15', quantity: 2, ...body },
      user: mockUser,
    };
  }

  test('✅ Giữ vé thành công khi còn đủ slot', async () => {
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        ticketProduct: { findUnique: jest.fn().mockResolvedValue(mockTicket) },
        dailyStock: {
          findUnique: jest.fn().mockResolvedValue({
            capacity: 100, bookedQuantity: 10, heldQuantity: 5
          }),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn(),
        },
        reservation: {
          create: jest.fn().mockResolvedValue({
            id: 'res-001',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          }),
        },
      });
    });

    const req = makeReq({ quantity: 2 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Trả 409 khi không đủ vé (overbooking)', async () => {
    // Stock chỉ còn 1 vé nhưng request 5 vé
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        ticketProduct: { findUnique: jest.fn().mockResolvedValue(mockTicket) },
        dailyStock: {
          findUnique: jest.fn().mockResolvedValue({
            capacity: 10, bookedQuantity: 8, heldQuantity: 1 // chỉ còn 1
          }),
          create: jest.fn(),
        },
        reservation: { create: jest.fn() },
      });
    });

    const req = makeReq({ quantity: 5 }); // muốn 5 nhưng chỉ còn 1
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('❌ Trả 400 nếu quantity <= 0', async () => {
    const req = makeReq({ quantity: 0 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Trả 400 nếu date sai format', async () => {
    const req = makeReq({ date: 'ngay-sai' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await reserveTickets(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ===== checkAvailability =====
describe('checkAvailability', () => {
  test('✅ Trả về danh sách slot với availableTickets đúng', async () => {
    mockPrisma.timeSlot.findMany.mockResolvedValue([
      { id: 'slot-001', startTime: '08:00', endTime: '11:00', maxCapacity: 100 },
    ]);
    mockPrisma.timeSlotStock.findUnique.mockResolvedValue({
      bookedQty: 30, heldQty: 10
    });

    const req = {
      params: { ticketProductId: 'tkt-001' },
      query: { date: '2026-06-15' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await checkAvailability(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    // availableTickets = 100 - 30 - 10 = 60
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ availableTickets: 60 })
        ])
      })
    );
  });

  test('✅ availableTickets không âm khi sold + held > capacity', async () => {
    mockPrisma.timeSlot.findMany.mockResolvedValue([
      { id: 'slot-001', startTime: '08:00', endTime: '11:00', maxCapacity: 10 },
    ]);
    mockPrisma.timeSlotStock.findUnique.mockResolvedValue({
      bookedQty: 8, heldQty: 5 // tổng 13 > 10
    });

    const req = {
      params: { ticketProductId: 'tkt-001' },
      query: { date: '2026-06-15' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await checkAvailability(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ availableTickets: 0 }) // không âm
        ])
      })
    );
  });
});
```

---

## BƯỚC 5 – INTEGRATION TEST: API ENDPOINTS

### Tạo file: `backend/src/__tests__/integration/attractions.test.js`

```javascript
// Copilot: viết integration test gọi HTTP thật vào Express app
// Dùng supertest - KHÔNG mock Prisma ở đây, dùng DB test riêng
// Hoặc mock ở level cao hơn

const request = require('supertest');
const app = require('../../app'); // Import app (không phải server.js)
const { generateTestToken } = require('../helpers/authHelper');

// Lưu ý: Copilot cần đảm bảo app.js export app:
// module.exports = app; (thêm vào cuối app.js nếu chưa có)

jest.mock('../../config/prisma', () => require('../helpers/mockPrisma'));
const mockPrisma = require('../helpers/mockPrisma');

afterEach(() => jest.clearAllMocks());

describe('GET /api/attractions', () => {
  test('✅ Trả 200 và đúng format pagination', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);

    const res = await request(app)
      .get('/api/attractions')
      .query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('attractions');
    expect(res.body.data).toHaveProperty('pagination');
  });

  test('✅ Lọc theo city hoạt động', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);

    const res = await request(app)
      .get('/api/attractions')
      .query({ city: 'Ho Chi Minh' });

    expect(res.status).toBe(200);
  });
});

describe('GET /api/attractions/:id', () => {
  test('✅ Trả 200 khi tìm thấy', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue({
      id: 'attr-001',
      title: 'Test',
      status: 'APPROVED',
      images: [],
      categories: [],
      ticketProducts: [],
    });

    const res = await request(app).get('/api/attractions/attr-001');
    expect(res.status).toBe(200);
  });

  test('❌ Trả 404 khi không tìm thấy', async () => {
    mockPrisma.attraction.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/attractions/not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/attractions (Partner only)', () => {
  test('❌ Trả 401 nếu không có token', async () => {
    const res = await request(app)
      .post('/api/attractions')
      .send({ title: 'Test' });

    expect(res.status).toBe(401);
  });

  test('❌ Trả 403 nếu role là CUSTOMER', async () => {
    const token = generateTestToken('user-001', 'CUSTOMER');

    const res = await request(app)
      .post('/api/attractions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test' });

    expect(res.status).toBe(403);
  });
});
```

---

## BƯỚC 6 – CHẠY TEST & XEM KẾT QUẢ

```powershell
# Chạy tất cả test
cd backend
npm test

# Chạy 1 file test cụ thể
npx jest src/__tests__/ticketController.test.js

# Xem coverage report
npm run test:coverage
```

**Kết quả mong đợi:**
```
PASS src/__tests__/partnerController.test.js
PASS src/__tests__/attractionController.test.js
PASS src/__tests__/ticketController.test.js
PASS src/__tests__/integration/attractions.test.js

Test Suites: 4 passed
Tests:       15+ passed
Coverage:    >70%
```

---

## ✅ CHECKLIST

- [ ] `npm install --save-dev jest supertest` xong
- [ ] `package.json` có script `"test": "jest --runInBand --forceExit"`
- [ ] `mockPrisma.js` và `authHelper.js` đã tạo
- [ ] Unit test partner: 3 test pass
- [ ] Unit test attraction: 4 test pass
- [ ] Unit test overbooking: 4 test pass ← quan trọng nhất
- [ ] Integration test: 5 test pass
- [ ] `npm run test:coverage` hiển thị coverage > 70%

---

> 💡 **Ghi chú cho Copilot:**
> - Nếu `app.js` chưa có `module.exports = app` → thêm vào dòng cuối
> - Nếu test báo lỗi mock path → kiểm tra lại đường dẫn `require()` trong mock
> - Chạy `npx jest --verbose` để xem chi tiết từng test
