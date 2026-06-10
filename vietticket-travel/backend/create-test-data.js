const bcrypt = require('bcrypt');
const prisma = require('./src/config/prisma');

async function createTestData() {
  try {
    await prisma.$connect();
    console.log('Connected to database.');

    // 1. Ensure Customer User exists
    const email = 'customer@vietticket.com';
    const password = 'Customer@123';
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: 'Nguyễn Thu Như',
          role: 'CUSTOMER',
          isEmailVerified: true,
          status: 'ACTIVE',
          profile: { create: { phoneNumber: '0987654321' } },
        },
      });
      console.log(`✓ Created customer account: ${email} / ${password}`);
    } else {
      console.log(`✓ Customer account already exists: ${email}`);
    }

    // 2. Fetch an approved attraction and ticket product
    const attraction = await prisma.attraction.findFirst({
      where: { status: 'APPROVED' },
      include: { ticketProducts: true },
    });

    if (!attraction || attraction.ticketProducts.length === 0) {
      console.error('❌ Error: No approved attraction or ticket products found. Please seed the database first using "npm run db:seed"');
      return;
    }

    const ticketProduct = attraction.ticketProducts[0];
    console.log(`Using attraction: "${attraction.title}" and ticket product: "${ticketProduct.name}"`);

    // 3. Create a Reservation
    const visitDate = new Date();
    visitDate.setDate(visitDate.getDate() - 1); // Yesterday

    const reservation = await prisma.reservation.create({
      data: {
        userId: user.id,
        ticketProductId: ticketProduct.id,
        date: visitDate,
        quantity: 1,
        status: 'CONFIRMED',
        expiresAt: new Date(),
      },
    });
    console.log(`✓ Created Reservation (ID: ${reservation.id.slice(0, 8)})`);

    // 4. Create a Booking with COMPLETED status
    const price = ticketProduct.sellingPrice;
    
    // Check if a completed booking already exists for this reservation to avoid duplicates
    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        reservationId: reservation.id,
        subtotalAmount: price,
        discountAmount: 0,
        totalAmount: price,
        status: 'COMPLETED',
        fullName: user.fullName,
        email: user.email,
        phone: '0987654321',
        note: 'Đơn hàng thử nghiệm đánh giá dịch vụ.',
      },
    });

    // Create a ticket instance for this booking
    await prisma.ticketInstance.create({
      data: {
        bookingId: booking.id,
        ticketProductId: ticketProduct.id,
        qrCodeToken: require('crypto').randomUUID(),
        status: 'USED',
      },
    });

    console.log(`✓ Created Booking with status COMPLETED (ID: ${booking.id.slice(0, 8)})`);
    console.log('\n==================================================');
    console.log('TEST DATA CREATED SUCCESSFULLY!');
    console.log(`Customer Login: ${email} / ${password}`);
    console.log('==================================================');

  } catch (error) {
    console.error('Failed to create test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestData();
