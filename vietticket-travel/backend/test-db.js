const prisma = require('./src/config/prisma');

async function main() {
  try {
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('Connected successfully!');

    console.log('Recalculating and updating minTicketPrice for all attractions...');
    const updatedCount = await prisma.$executeRawUnsafe(`
      UPDATE "Attraction" a
      SET "minTicketPrice" = (
        SELECT MIN(tp."sellingPrice")
        FROM "TicketProduct" tp
        WHERE tp."attractionId" = a."id"
          AND tp."status" = 'ACTIVE'
          AND tp."archivedAt" IS NULL
      );
    `);
    console.log(`Successfully updated minTicketPrice! Rows affected: ${updatedCount}`);
  } catch (error) {
    console.error('Database operation failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
