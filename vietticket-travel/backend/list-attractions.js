const prisma = require('./src/config/prisma');

async function listAll() {
  try {
    await prisma.$connect();
    const attractions = await prisma.attraction.findMany({
      include: {
        images: true,
        ticketProducts: true
      }
    });
    console.log('--- ALL ATTRACTIONS IN DB ---');
    attractions.forEach(a => {
      console.log(`ID: ${a.id}`);
      console.log(`Title: ${a.title}`);
      console.log(`Status: ${a.status}`);
      console.log(`Images Count: ${a.images.length}`);
      console.log(`Ticket Products: ${a.ticketProducts.length}`);
      console.log('----------------------------');
    });
  } catch (error) {
    console.error('Error listing attractions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

listAll();
