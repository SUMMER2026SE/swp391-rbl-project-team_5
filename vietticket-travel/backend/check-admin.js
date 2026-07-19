const prisma = require('./src/config/prisma');

async function main() {
  const users = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { email: true, fullName: true, role: true, status: true }
  });
  console.log('=== TÀI KHOẢN ADMIN ===');
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); prisma.$disconnect(); });
