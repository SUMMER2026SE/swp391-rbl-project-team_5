# VietTicket Travel Backend

Express + Prisma + PostgreSQL API for the full VietTicket platform.

## Main Areas

- Auth, profile, email verification, password reset, Google login, DB-backed sessions.
- Public catalog, attraction search/detail, favorites, reviews.
- Reservations, bookings, vouchers, VNPay payment, tickets, refunds.
- Partner KYC, attraction/ticket/schedule management, approval workflow, reports.
- Admin moderation, users, categories, bookings, reviews, dashboard.
- Staff refund/check-in/support workflows.

## Setup

```bash
npm install
cp .env.example .env
```

Fill at least:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/vietticket?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
FRONTEND_URL="http://localhost:5173"
BACKEND_URL="http://localhost:5000"
```

Optional integrations: SMTP, Google OAuth, VNPay sandbox, Gemini/OpenAI for AI assistant.

For the AI assistant, fill at least one provider key:

```env
AI_PRIMARY_PROVIDER="gemini"
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.0-flash"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-4o-mini"
```

## Database

```bash
npx prisma migrate dev
npm run db:seed
npm run create-admin
```

Use `npm run db:push` only for quick local sync when migration history is not required.

## Run

```bash
npm run dev
```

API base URL: `http://localhost:5000/api`

Health check: `http://localhost:5000/api/health`

## Test

```bash
npm run test
```

## Safety Notes

- Do not commit real `.env` values.
- Keep uploaded attraction images and private KYC documents out of git.
- For local frontend development, set `VITE_API_URL=http://localhost:5000/api`.
- VNPay IPN requires a public HTTPS URL in production; localhost is only suitable for browser return testing.
