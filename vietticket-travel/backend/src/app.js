const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const prisma = require('./config/prisma');
const { corsOptions } = require('./config/cors');
const { getTrustProxySetting } = require('./config/runtimeConfig');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const partnerRoutes = require('./routes/partnerRoutes');
const attractionRoutes = require('./routes/attractionRoutes');
const favoriteRoutes = require('./routes/favoriteRoutes');
const { router: attractionTicketRouter, ticketRouter } = require('./routes/ticketRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const staffRoutes = require('./routes/staffRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const supportRoutes = require('./routes/supportRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
const aiRoutes = require('./routes/aiRoutes');
const weatherRoutes = require('./routes/weatherRoutes');
const forecastRoutes = require('./routes/forecastRoutes');
const liveTripRoutes = require('./routes/liveTripRoutes');
const loyaltyRoutes = require('./routes/loyaltyRoutes');
const recoveryCaseRoutes = require('./routes/recoveryCaseRoutes');
const partyRoomRoutes = require('./routes/partyRoomRoutes');
const questionRoutes = require('./routes/questionRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();

app.disable('x-powered-by');
const trustProxy = getTrustProxySetting();
if (trustProxy !== false) app.set('trust proxy', trustProxy);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/payments/vnpay-ipn',
  message: { message: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' },
});
app.use('/api', apiLimiter);

// Chặn các tài liệu KYC cũ từng được lưu nhầm dưới thư mục public.
app.use('/uploads/:filename', async (req, res, next) => {
  try {
    const suffix = `/uploads/${path.basename(req.params.filename)}`;
    const privateDocument = await prisma.partnerProfile.findFirst({
      where: { businessLicenseUrl: { endsWith: suffix } },
      select: { id: true },
    });
    if (privateDocument) {
      return res.status(404).json({ message: 'Không tìm thấy tệp.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
});
app.use('/uploads', express.static(
  path.join(__dirname, '../public/uploads'),
  {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    immutable: process.env.NODE_ENV === 'production',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  },
));

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const payload = {
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };

    // Staging-only diagnostics help verify a remote restore without exposing
    // catalog counts or database metadata from a production health endpoint.
    if (process.env.NODE_ENV !== 'production' && req.query.details === 'true') {
      const [
        totalAttractions,
        approvedAttractions,
        publicAttractions,
        totalPartners,
        approvedPartners,
      ] = await Promise.all([
        prisma.attraction.count(),
        prisma.attraction.count({ where: { status: 'APPROVED' } }),
        prisma.attraction.count({
          where: {
            publishedAt: { not: null },
            publicationStatus: 'ACTIVE',
            operationalStatus: 'ACTIVE',
            archivedAt: null,
            partner: { status: 'APPROVED' },
          },
        }),
        prisma.partnerProfile.count(),
        prisma.partnerProfile.count({ where: { status: 'APPROVED' } }),
      ]);
      payload.catalog = {
        totalAttractions,
        approvedAttractions,
        publicAttractions,
        totalPartners,
        approvedPartners,
      };
    }

    return res.json(payload);
  } catch {
    return res.status(503).json({
      status: 'unavailable',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/attractions', attractionRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/attractions/:attractionId/tickets', attractionTicketRouter);
app.use('/api/tickets', ticketRouter);
app.use('/api/upload', uploadRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/live', liveTripRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/recovery-cases', recoveryCaseRoutes);
app.use('/api/party', partyRoomRoutes);
app.use('/api/questions', questionRoutes);

// Render demo deployment can serve the Vite build from the same origin as the
// API. Keeping the SPA and API together preserves cookie-based authentication
// and Socket.IO without cross-site configuration.
const frontendDistDir = path.resolve(
  process.env.FRONTEND_DIST_DIR || path.join(__dirname, '../../dist'),
);
const shouldServeFrontend =
  process.env.SERVE_FRONTEND === 'true' && fs.existsSync(frontendDistDir);

if (shouldServeFrontend) {
  app.use(
    express.static(frontendDistDir, {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
      immutable: process.env.NODE_ENV === 'production',
    }),
  );

  // React Router handles client-side routes. Never turn unknown API or
  // websocket paths into index.html; those must reach the API 404 handler.
  app.get(
    /^(?!\/api(?:\/|$)|\/socket\.io(?:\/|$)|\/uploads(?:\/|$)).*/,
    (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method)) return next();
      return res.sendFile(path.join(frontendDistDir, 'index.html'));
    },
  );
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
