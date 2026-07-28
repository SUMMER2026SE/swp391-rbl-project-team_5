# Render deployment for the six-day defense

This runbook deploys a separate demo/staging environment:

* one Render Web Service for the Node API **and** the Vite frontend (same origin);
* one Render Web Service for the FastAPI ML service;
* the Render Postgres database already created by the team.

Do not use the demo database for real customer data. Do not paste database
passwords or API keys into chat, screenshots, Git, or issue trackers.

## 1. API + frontend Web Service

Create **Web Service** (not Private Service) from the GitHub repository
`SUMMER2026SE/swp391-rbl-project-team_5`.

Set **Root Directory** to `vietticket-travel`.

Build command:

```text
npm ci && npm run build && cd backend && npm ci && npx prisma generate
```

Start command:

```text
cd backend && npx prisma migrate deploy && node src/server.js
```

Set the free instance type. Render injects `PORT` automatically.

Required environment variables:

```text
NODE_ENV=staging
SERVE_FRONTEND=true
TRUST_PROXY=true
DATABASE_URL=<Render Internal Database URL>
FRONTEND_URL=<the Render Web Service URL>
BACKEND_URL=<the Render Web Service URL>
COOKIE_SECURE=true
JWT_SECRET=<random string of at least 32 characters>
NEWSLETTER_TOKEN_SECRET=<different random string of at least 32 characters>
ML_SERVICE_URL=<the ML Web Service URL>
ML_SERVICE_API_KEY=<same random string as the ML service, at least 32 characters>
ALLOW_DEMO_AI=true
```

For the defense, payment and email can remain disabled. If the runtime
validator is changed to production mode, configure real VNPay sandbox and
SMTP values instead of placeholders.

After the first deploy, open the service shell and set the two temporary
confirmation variables in Render. They are deliberately required so a demo
reset cannot be run accidentally:

```text
DEPLOYMENT_MODE=defense-demo
ALLOW_REMOTE_DEMO_SEED=true
```

Then run this one-time command from the Web Service root:

```text
cd backend && npm run demo:prepare:remote
```

Confirm the readiness output, then remove `ALLOW_REMOTE_DEMO_SEED` from the
service environment. The seed script only owns and replaces its own
`[DEFENSE_DEMO_V2]` fixture rows; it never drops the database.

## 2. ML Web Service

Create a second **Web Service** from the same repository.

Set **Root Directory** to `vietticket-travel/ml-service`.

Build command:

```text
pip install -r requirements.txt
```

Start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Environment variables:

```text
ENVIRONMENT=development
ML_SERVICE_API_KEY=<same random string used by the API service>
MODEL_DIR=./models
```

The checked-in artifact is a **demo** artifact. It is intentionally accepted
only when `ENVIRONMENT=development`; never promote it to a production
environment. A production revenue model must be retrained from eligible real
booking history and deployed with an integrity-verified artifact.

## 3. Smoke checks

After both services are live:

1. Open `https://<api-service>.onrender.com/api/health` and confirm
   `status: "ok"` and `database: "connected"`.
2. Open the root URL and confirm the React app loads.
3. Register/login with a demo account and verify a protected page.
4. Open the SmartQueue page and confirm live updates and the fallback indicator
   behave correctly.

Free Render web services sleep after inactivity and may take about a minute to
wake. Open both URLs shortly before the defense.
