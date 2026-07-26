require('dotenv').config({ quiet: true });

const { validateProductionEnv } = require('./config/runtimeConfig');

validateProductionEnv();

const { createServer } = require('http');
const app = require('./app');
const prisma = require('./config/prisma');
const {
  closeSocketServer,
  initializeSocketServer,
} = require('./realtime/socketServer');
const { startCleanupWorker } = require('./utils/cleanupWorker');
const { startCompletionWorker } = require('./utils/completionWorker');
const { startRefundWorker } = require('./utils/refundWorker');
const { startPendingPartnerWorker } = require('./utils/pendingPartnerWorker');
const { startLiveTripWorker } = require('./utils/liveTripWorker');

const PORT = process.env.PORT || 5000;

const server = createServer(app);
const io = initializeSocketServer(server);

server.listen(PORT, () => {
  console.log(`VietTicket Travel API is running on port ${PORT}`);
});

// Worker dọn giữ chỗ quá hạn (chỉ chạy ở server thật, không chạy trong test).
const cleanupHandle = startCleanupWorker();

// Worker chuyển đơn đã qua ngày tham quan sang COMPLETED (mở khoá luồng đánh giá).
const completionHandle = startCompletionWorker();

// Worker đối soát hoàn tiền VNPay tự động.
const refundHandle = startRefundWorker();

// Worker tự hủy và tạo yêu cầu hoàn tiền cho đơn đã chờ đối tác quá 24 giờ.
const pendingPartnerHandle = startPendingPartnerWorker();

// Worker điều phối SmartQueue và tạo đề xuất Autopilot có kiểm soát.
const liveTripHandle = startLiveTripWorker();

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
  clearInterval(completionHandle);
  clearInterval(refundHandle);
  clearInterval(pendingPartnerHandle);
  clearInterval(liveTripHandle);

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
