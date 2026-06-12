jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const mockPrisma = require('./helpers/mockPrisma');
const { registerPartner, getMyPartnerProfile } = require('../controllers/partnerController');

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

describe('registerPartner', () => {
	test('✅ Tạo partner profile thành công', async () => {
		mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
		mockPrisma.partnerProfile.create.mockResolvedValue({ id: 'p-001', userId: 'user-001', businessName: 'Công ty Test', status: 'PENDING', createdAt: new Date() });

		const { req, res, next } = mockReqRes({
			businessName: 'Công ty Test',
			taxCode: '0123456789',
			businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
		});
		await registerPartner(req, res, next);

		expect(res.status).toHaveBeenCalledWith(201);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
	});

	test('❌ Trả 409 nếu đã có partner profile', async () => {
		mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-existing' });
		const { req, res, next } = mockReqRes({
			businessName: 'Test',
			businessLicenseUrl: 'http://localhost/api/upload/documents/user-001-license.pdf',
		});
		await registerPartner(req, res, next);
		expect(res.status).toHaveBeenCalledWith(409);
	});

	test('❌ Trả 400 nếu thiếu businessName', async () => {
		mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
		const { req, res, next } = mockReqRes({ taxCode: '0123456789' });
		await registerPartner(req, res, next);
		expect(res.status).toHaveBeenCalledWith(400);
	});
});

describe('getMyPartnerProfile', () => {
	test('✅ Trả về profile nếu tìm thấy', async () => {
		mockPrisma.partnerProfile.findUnique.mockResolvedValue({ id: 'p-001', businessName: 'Công ty Test', status: 'APPROVED' });
		const { req, res, next } = mockReqRes();
		await getMyPartnerProfile(req, res, next);
		expect(res.status).toHaveBeenCalledWith(200);
	});

	test('❌ Trả 404 nếu không có profile', async () => {
		mockPrisma.partnerProfile.findUnique.mockResolvedValue(null);
		const { req, res, next } = mockReqRes();
		await getMyPartnerProfile(req, res, next);
		expect(res.status).toHaveBeenCalledWith(404);
	});
});
