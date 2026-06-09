require('dotenv').config({ quiet: true });

const app = require('./app');
const prisma = require('./config/prisma');
const { startCleanupWorker } = require('./utils/cleanupWorker');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`VietTicket Travel API is running on port ${PORT}`);
});

// Worker dọn giữ chỗ quá hạn (chỉ chạy ở server thật, không chạy trong test).
const cleanupHandle = startCleanupWorker();

function shutdown() {
  clearInterval(cleanupHandle);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
