require('dotenv').config({ quiet: true });

const { createServer } = require('http');
const app = require('./app');
const prisma = require('./config/prisma');
const {
  closeSocketServer,
  initializeSocketServer,
} = require('./realtime/socketServer');
const { startCleanupWorker } = require('./utils/cleanupWorker');

const PORT = process.env.PORT || 5000;

const server = createServer(app);
const io = initializeSocketServer(server);

server.listen(PORT, () => {
  console.log(`VietTicket Travel API is running on port ${PORT}`);
});

// Worker dọn giữ chỗ quá hạn (chỉ chạy ở server thật, không chạy trong test).
const cleanupHandle = startCleanupWorker();

let shutdownPromise = null;

async function closeHttpServer() {
  if (!server.listening) return;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function shutdown({ exit = true } = {}) {
  if (shutdownPromise) return shutdownPromise;

  clearInterval(cleanupHandle);

  shutdownPromise = (async () => {
    await closeSocketServer();
    await closeHttpServer();
    await prisma.$disconnect();
    if (exit) process.exit(0);
  })().catch((error) => {
    console.error('[Server] Shutdown failed:', error);
    if (exit) process.exit(1);
    throw error;
  });

  return shutdownPromise;
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

module.exports = {
  io,
  server,
  shutdown,
};
