# VietTicket Travel

Travel attraction ticket platform built with React/Vite, Express, Prisma, and PostgreSQL.

## Modules

- Customer: search attractions, favorites, reservation, booking, vouchers, VNPay payment, e-ticket QR, reviews, refund requests, support chat.
- Partner: KYC, attraction/ticket/schedule management, manual booking approval, dashboard and reports.
- Staff: refund processing, ticket check-in, support handling, assigned attraction access.
- Admin: user, partner KYC, attraction moderation, category, booking, review, and dashboard management.

## Local Setup

1. Install frontend dependencies:

```bash
npm install
```

2. Configure frontend environment:

```bash
cp .env.example .env
```

For local development, keep:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

3. Configure backend:

```bash
cd backend
npm install
cp .env.example .env
```

Fill `DATABASE_URL`, `JWT_SECRET`, and optional SMTP/Google/VNPay values in `backend/.env`.

4. Prepare database:

```bash
cd backend
npx prisma migrate dev
npm run db:seed
npm run create-admin
```

5. Run both apps in separate terminals:

```bash
cd backend
npm run dev
```

```bash
npm run dev
```

Frontend runs on `http://localhost:5173`; backend API runs on `http://localhost:5000/api`.

## Verification

```bash
npm run lint
npm run test
npm run build
```

```bash
cd backend
npm run test
```

## Environment Notes

- Do not commit real `.env` files or private keys.
- Leave `VITE_API_URL` empty only when frontend and backend are deployed behind the same domain/proxy and `/api` is routed to the backend.
- Uploaded images and private documents are stored outside source code; do not delete upload folders during maintenance.
