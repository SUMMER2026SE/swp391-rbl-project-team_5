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
  favoriteAttraction: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
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
    findUnique: jest.fn(),
    aggregate: jest.fn(),
  },
  dailyStock: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  timeSlotStock: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  reservation: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

module.exports = mockPrisma;
