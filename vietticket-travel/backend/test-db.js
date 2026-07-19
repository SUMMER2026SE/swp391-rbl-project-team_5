const prisma = require('./src/config/prisma');

async function main() {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Script bảo trì test-db bị cấm trong production.');
    }
    if (process.env.ALLOW_DB_MAINTENANCE !== 'true') {
      throw new Error('Đặt ALLOW_DB_MAINTENANCE=true để xác nhận thao tác cập nhật dữ liệu.');
    }
    console.log('Connecting to database...');
    await prisma.$connect();
    console.log('Connected successfully!');

    console.log('Recalculating and updating minTicketPrice for all attractions...');
    const updatedCount = await prisma.$executeRaw`
      UPDATE "Attraction" a
      SET "minTicketPrice" = (
        SELECT MIN(tp."sellingPrice")
        FROM "TicketProduct" tp
        WHERE tp."attractionId" = a."id"
          AND tp."status" = 'ACTIVE'
          AND tp."archivedAt" IS NULL
      )
    `;
    console.log(`Successfully updated minTicketPrice! Rows affected: ${updatedCount}`);
  } catch (error) {
    console.error('Database operation failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
