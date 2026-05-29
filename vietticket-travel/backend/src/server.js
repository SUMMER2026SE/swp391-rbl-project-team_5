require('dotenv').config({ quiet: true });

const app = require('./app');
const prisma = require('./config/prisma');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`VietTicket Travel API is running on port ${PORT}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
