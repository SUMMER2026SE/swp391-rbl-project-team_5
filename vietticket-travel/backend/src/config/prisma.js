const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
  quiet: true,
});

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
