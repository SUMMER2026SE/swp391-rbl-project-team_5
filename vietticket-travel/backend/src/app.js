const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
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
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  if (process.env.NODE_ENV !== 'production') {
    return /^http:\/\/(localhost|127\.0\.0\.1):51\d{2}$/.test(origin);
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Không được phép truy cập CORS từ origin này.'));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

app.get('/api/health', (req, res) => {
  res.json({ message: 'VietTicket Travel API is running' });
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

app.use(notFound);
app.use(errorHandler);

module.exports = app;
