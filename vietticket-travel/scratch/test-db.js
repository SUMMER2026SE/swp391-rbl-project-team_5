const prisma = require('../backend/src/config/prisma');

async function test() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('Connected successfully!');
    
    console.log('Fetching users...');
    const users = await prisma.user.findMany();
    console.log('Users count:', users.length);
  } catch (error) {
    console.error('Database connection failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
