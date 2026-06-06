(# Change Log)

## [2026-06-06] Bước 1 — Schema: Reservation
- **Files modified:** `backend/prisma/schema.prisma`
- **Added:** `ReservationStatus` (enum); `Reservation` (model); relations `User.reservations`, `TicketProduct.reservations`, `TimeSlot.reservations`
- **Deleted:** None
- **Functions / Routes added:** None
- **Terminal commands run / attempted:**
  - `cd backend && npx prisma migrate dev --name add_reservation_model` — Thành công
  - `npx prisma generate` — Thành công


Note: Tôi sẽ tiếp tục append các mục tóm tắt (file thêm/sửa/xóa, hàm/route thêm, lệnh terminal) vào file này sau mỗi lần sửa code.

## [2026-06-06] Bước 2 — Partner API
- **Files created:** `backend/src/controllers/partnerController.js`, `backend/src/routes/partnerRoutes.js`
- **Files modified:** `backend/src/app.js` (line to add shown below)
- **Added functions / routes:** `registerPartner`, `getMyPartnerProfile`; routes: `POST /api/partners/` and `GET /api/partners/profile`
- **Deleted:** None
- **Terminal commands run:** None

Add to `backend/src/app.js`:
```javascript
const partnerRoutes = require('./routes/partnerRoutes');
app.use('/api/partners', partnerRoutes);
```

## [2026-06-06] Bước 3 — Attraction API
- **Files created:** `backend/src/controllers/attractionController.js`, `backend/src/routes/attractionRoutes.js`
- **Files modified:** `backend/src/app.js` (line to add shown below)
- **Added functions / routes:** `createAttraction`, `submitAttraction`, `searchAttractions`, `getAttractionDetail`; routes: `GET /api/attractions`, `GET /api/attractions/:id`, `POST /api/attractions` (partner), `PUT /api/attractions/:id/submit` (partner)
- **Deleted:** None
- **Terminal commands run:** None

Add to `backend/src/app.js`:
```javascript
const attractionRoutes = require('./routes/attractionRoutes');
app.use('/api/attractions', attractionRoutes);
```

## [2026-06-06] Bước 4 — Ticket & Overbooking
- **Files created:** `backend/src/controllers/ticketController.js`, `backend/src/routes/ticketRoutes.js`
- **Files modified:** `backend/src/app.js` (lines to add shown below)
- **Added functions / routes:** `createTicketProduct`, `setupTimeSlots`, `checkAvailability`, `reserveTickets`; routes: `POST /api/attractions/:attractionId/tickets`, `POST /api/tickets/:ticketProductId/slots`, `GET /api/tickets/:ticketProductId/availability`, `POST /api/tickets/:ticketProductId/reserve`
- **Deleted:** None
- **Terminal commands run:** None

Add to `backend/src/app.js`:
```javascript
const { router: attractionTicketRouter, ticketRouter } = require('./routes/ticketRoutes');
app.use('/api/attractions/:attractionId/tickets', attractionTicketRouter);
app.use('/api/tickets', ticketRouter);
```

## [2026-06-06] Bước 5 — Admin nâng cao + Email tự động
- **Files modified:** `backend/src/utils/mailer.js`, `backend/src/controllers/adminController.js`, `backend/src/routes/adminRoutes.js`
- **Added functions / routes:** `sendPartnerReviewEmail`, `sendAttractionViolationEmail` (mailer); `getPartners`, `reviewPartner`, `reviewAttraction`, `hideAttraction` (admin controller); admin routes: `GET /api/admin/partners`, `PUT /api/admin/partners/:id/review`, `PUT /api/admin/attractions/:id/review`, `PUT /api/admin/attractions/:id/hide`
- **Behavior notes:** emails sent with `.catch()` so they don't block responses
- **Terminal commands run:** None

## [2026-06-06] Bước 6 — Upload ảnh mở rộng
- **Files modified:** `backend/src/middleware/uploadMiddleware.js`
- **Files created:** `backend/src/routes/uploadRoutes.js`
- **Files modified:** `backend/src/app.js` (mounted `/api/upload`)
- **Added functions / routes:** `uploadAttractionImages` middleware; route: `POST /api/upload/attraction-images` (protect, restrictTo PARTNER|ADMIN)
- **Deleted:** None
- **Terminal commands run:** None





