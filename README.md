# Atmosphere

Authentication and organization onboarding for **Atmosphere** — a React UI backed by an
Express BFF (Backend-for-Frontend) that mediates **Supabase Auth** and a Row-Level-Security
protected Postgres schema.

```
┌────────────────────┐      /api/*        ┌────────────────────┐    Supabase JS (JWT)   ┌──────────────────┐
│  Frontend (React)  │ ─────────────────▶ │  Backend (Express) │ ─────────────────────▶ │  Supabase        │
│  Vite + Tailwind   │  httpOnly cookies  │  BFF / auth proxy  │   anon key + user JWT  │  Auth + Postgres │
└────────────────────┘ ◀───────────────── └────────────────────┘ ◀───────────────────── └──────────────────┘
```

## What it does

1. **Sign up / sign in** with email + password (Supabase Auth).
2. **Onboarding**, immediately after account creation or first sign-in:
   - **Create a new organization** _or_ **link to an existing one** with a join code.
   - Pick an **account type**: Project Manager, Field Technician, Accountant, Office
     Manager, or Sales.
   - Choose the **kind of work**: Mitigation or Construction.
3. **Dashboard** — once linked, everyone in an organization can see and communicate with the
   other linked accounts. Members share the org's join code to bring on teammates.
4. **Password recovery** — a reset link by email, with the token exchange performed on the
   server so no Supabase token is ever exposed to page JavaScript.
5. **PIN sign-in** — an optional 4-digit PIN for fast repeat sign-in, bound to a single
   device (see below).
6. **Growth analytics** — two internal dashboards (one for the team, one for investors)
   covering user growth, seats, MRR/ARR, average spend, growth rates and which parts of the
   product are actually used, measured by time spent. Every figure downloads as Excel.

## Why this shape?

- **Passwords are never stored by us.** Supabase Auth stores only a bcrypt hash in the
  secure `auth.users` table. The app never sees or persists a plaintext password.
- **Tokens never touch browser JavaScript.** The backend exchanges credentials for a
  Supabase session and puts the access/refresh tokens in **httpOnly** cookies, which
  mitigates token theft via XSS. The frontend holds no tokens.
- **Every org query runs under the caller's identity.** The backend calls Postgres with the
  user's JWT (never the service-role key), so **Row Level Security** — not application code —
  is the source of truth for who can see what. Cross-organization data is invisible at the
  database layer.

## Data model

All tables live in `public` with **RLS enabled** and are reached only through the caller's
JWT:

| Table          | Purpose                                                              |
| -------------- | ------------------------------------------------------------------- |
| `profiles`     | One row per auth user (`id` → `auth.users`), carries email/name.     |
| `orgs`         | An organization; owns a unique `join_code`.                          |
| `org_members`  | Links a user to an org with their `role` and `work_type`.            |
| `device_credentials` | One row per PIN-enrolled device. Holds only hashes — no secret and no session token. |
| `analytics_staff` | Allow-list for the growth dashboards, with an `investor` / `internal` scope. |
| `feature_catalog` | Every instrumented tool. The denominator that makes "least used" answerable. |
| `feature_usage_sessions` | Foreground time per user, per tool. Written only by `feature_heartbeat`. |
| `feature_usage_daily` | Per-day rollup of the above, maintained by trigger. |
| `org_billing_events` | Append-only subscription history, so past months' MRR is real rather than back-projected. |

Membership checks used by the policies live in a **private schema** (not exposed as RPCs) to
avoid recursive-policy issues and to keep the API surface minimal. Onboarding writes go
through two `SECURITY DEFINER` functions that validate `auth.uid()` internally:

- `create_org(name, role, work_type)` — creates an org + adds the caller as its first member.
- `join_org(code, role, work_type)` — links the caller to an existing org by join code.
- `enroll_device(…)` / `revoke_my_devices()` — manage PIN enrollments for `auth.uid()`.
- `device_lookup(…)` / `device_verify_pin(…)` — the only two functions reachable by `anon`,
  because PIN unlock necessarily runs before the user has a session. Both are inert without
  the device secret, and `device_verify_pin` owns the lockout counters.

## Project layout

```
Atmosphere/
├── backend/          Express + TypeScript BFF
│   ├── src/
│   │   ├── config.ts             Validated config (Supabase URL, keys, cookies, CORS)
│   │   ├── app.ts                Express app assembly (helmet, cors, cookies, routes)
│   │   ├── index.ts              Server bootstrap + graceful shutdown
│   │   ├── lib/
│   │   │   ├── supabase.ts       Anon + per-request user-scoped client factories
│   │   │   ├── session.ts        httpOnly session-cookie set/clear
│   │   │   ├── validation.ts     zod schemas (credentials, org create/join)
│   │   │   └── errors.ts         Typed HTTP errors
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts    Verify access token; transparent refresh
│   │   │   └── errorHandler.ts   404 + central JSON error handler
│   │   ├── routes/
│   │   │   ├── auth.ts           signup / login / logout / refresh / me
│   │   │   ├── org.ts            onboarding: me / create / join / members
│   │   │   ├── analytics.ts      growth reports + Excel export
│   │   │   ├── telemetry.ts      feature-timing ingest
│   │   │   └── health.ts         liveness probe
│   │   └── scripts/
│   │       ├── grantAnalyticsAccess.ts  Grant/revoke dashboard access
│   │       └── seedAnalyticsDemo.ts     Reversible demo data
│   └── .env.example
├── frontend/         React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── pages/LoginPage.tsx        Branded login + signup screen
│   │   ├── pages/OnboardingPage.tsx   3-step wizard: org → role → work type
│   │   ├── pages/DashboardPage.tsx    Org overview, invite code, linked accounts
│   │   ├── pages/analytics/           Internal + investor dashboards
│   │   ├── components/analytics/      SVG chart kit, tiles, tables, palette
│   │   ├── hooks/useFeatureTimer.ts   Foreground time-on-tool measurement
│   │   ├── context/AuthContext.tsx    Session + membership state
│   │   ├── components/                Logo, icons, ProtectedRoute
│   │   └── lib/api.ts                 Typed fetch client (credentials: include)
│   └── .env.example
└── supabase/migrations/               Versioned SQL (analytics schema + reports)
```

## Prerequisites

- Node.js **18+** (built and tested on Node 22)
- A Supabase project. This repo ships with the public **Atmosphere** project URL + anon key
  as defaults, so it runs out of the box. Override via env vars for your own project.

## Running locally

Open two terminals.

**1. Backend** (port 4000):

```bash
cd backend
npm install
cp .env.example .env    # optional — safe defaults are baked in
npm run dev
```

**2. Frontend** (port 5173):

```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api/*` to the backend,
so the browser talks to a single origin and the session cookies work seamlessly.

## API

| Method | Path                 | Auth   | Body                          | Description                                  |
| ------ | -------------------- | ------ | ----------------------------- | -------------------------------------------- |
| GET    | `/api/health`        | —      | —                             | Liveness probe                               |
| POST   | `/api/auth/signup`   | —      | `{ email, password }`         | Create account; sets cookies if confirmed    |
| POST   | `/api/auth/login`    | —      | `{ email, password }`         | Authenticate; sets session cookies           |
| POST   | `/api/auth/logout`   | —      | —                             | Revoke session + clear cookies               |
| POST   | `/api/auth/refresh`  | cookie | —                             | Exchange refresh token for a new session     |
| GET    | `/api/auth/me`       | cookie | —                             | Current user (auto-refreshes if expired)     |
| POST   | `/api/auth/forgot-password` | — | `{ email }`                | Email a reset link; always the same response |
| POST   | `/api/auth/reset-password`  | — | `{ password, …credential }`| Set a new password from a recovery link      |
| GET    | `/api/auth/pin/status`      | device cookie | —              | Whether this device has a PIN enrolled       |
| POST   | `/api/auth/pin/enroll`      | cookie | `{ pin }`             | Set a 4-digit PIN for this device            |
| POST   | `/api/auth/pin/unlock`      | device cookie | `{ pin }`      | Exchange a correct PIN for a session         |
| POST   | `/api/auth/pin/disable`     | cookie | —                     | Remove every PIN enrollment for the user     |
| GET    | `/api/org/me`        | cookie | —                             | Caller's membership, or `null` if onboarding |
| POST   | `/api/org`           | cookie | `{ name, role, workType }`    | Create an org and join as first member       |
| POST   | `/api/org/join`      | cookie | `{ joinCode, role, workType }`| Link to an existing org by join code         |
| GET    | `/api/org/members`   | cookie | —                             | Linked accounts in the caller's org          |
| POST   | `/api/telemetry/feature` | cookie | `{ featureKey, sessionId, deltaMs }` | Record foreground time in a tool  |
| GET    | `/api/analytics/access`  | cookie | —                         | Caller's analytics scope, or `null`          |
| GET    | `/api/analytics/overview` | scope | `?from&to&months`          | Everything both dashboards render            |
| GET    | `/api/analytics/summary` \| `/monthly` \| `/features` \| `/plan-mix` \| `/retention` | scope | `?from&to&months` | Individual reports |
| GET    | `/api/analytics/accounts` | internal | `?from&to`               | Per-customer detail                          |
| GET    | `/api/analytics/export`   | scope | `?dataset&from&to`         | `.xlsx` download of any of the above         |

`role` ∈ `project_manager | field_technician | accountant | office_manager | sales`.
`workType` ∈ `mitigation | construction`.

All endpoints validate input with zod. `signup` and `login` are rate-limited
(20 attempts / 15 min / IP). Login failures return a generic message so the API does not
reveal whether an email is registered.

### Email confirmation

If the Supabase project requires email confirmation, `signup` returns
`{ needsEmailConfirmation: true }` and no session — the UI asks the user to confirm via
email, then sign in. If the project auto-confirms, `signup` logs the user straight in and
routes them into onboarding.

### Password recovery

`forgot-password` returns an identical response whether or not the address is registered, so
it cannot be used to discover which employees have accounts. The recovery token is exchanged
**on the server** — the usual client-side pattern would put an access token in page
JavaScript, which would undo the httpOnly cookie design above. Supabase emits recovery links
in three shapes (`token_hash`, a PKCE `code`, or a `#access_token=…` fragment from the stock
email template); all three are accepted, so reset works before any template customisation.

Saving a new password signs out the user's other sessions and revokes every enrolled PIN,
since a reset is the usual response to a suspected compromise.

### PIN sign-in

A 4-digit PIN is 10,000 combinations, so it is **never** a standalone credential — `email +
PIN` cannot sign in from anywhere. A PIN unlocks only a device that already completed a full
email + password login, and three separate things must combine before a session is issued:

1. a 32-byte **device secret**, held only in an httpOnly cookie — the database stores just
   its SHA-256, never the secret itself;
2. the **PIN**, compared against a scrypt hash inside the database;
3. a **server pepper** (`DEVICE_PEPPER`) that never touches the database.

A database leak alone therefore yields nothing usable, and no session token is stored at
rest — unlock mints a fresh session instead.

The guess budget is enforced in the database, inside the same transaction as the comparison
so concurrent attempts cannot outrun it: **5** wrong PINs freeze the device for 15 minutes,
and a **third** freeze deletes the enrollment outright. A stolen device gets at most 15
guesses, ever. Common PINs (`1234`, `0000`, repeats, sequences) are rejected at enrollment,
which is what keeps that budget meaningless rather than a coin flip.

Signing out deliberately does **not** clear the PIN — returning to the PIN pad instead of the
password form is the whole point. Enrollment is per-device, capped at 5 devices per user.

## Growth analytics

Two dashboards, same numbers, different surface:

| Route | Who | What it adds |
| ----- | --- | ------------ |
| `/analytics` | Atmosphere team (`internal` scope) | Everything below, plus named accounts, unit economics (model cost and gross margin), seat utilisation and churn |
| `/analytics/investor` | Investors (`investor` scope) and the team | ARR, MRR, growth rates, seats, plan mix, retention cohorts and feature engagement — **aggregate only** |

Both cover user growth, seat counts, average monthly spend, MRR, ARR, ARR on annual
contracts, month-over-month growth rates, and which tools are used most and least by **time
spent**. Every table and chart is downloadable as `.xlsx`, with a definitions sheet in every
file.

### Granting access

Nobody sees company-wide revenue by default. `analytics_staff` has no INSERT policy, so the
only way in is a server-side script holding the service-role key:

```bash
cd backend
npm run analytics:grant -- someone@atmosphere.app internal   # full dashboard
npm run analytics:grant -- partner@fund.com      investor    # aggregate only
npm run analytics:grant -- someone@atmosphere.app revoke
```

The separation is enforced in three places, not one: the UI hides what the scope may not
see, the API refuses the route, and the `SECURITY DEFINER` reporting functions re-check
`auth.uid()` before returning a row. An investor-scope session cannot obtain per-customer
data by editing a URL — the payload behind that page never contains it.

### How "time spent" is measured

The browser sends a heartbeat every 30 seconds for the tool on screen, carrying the
milliseconds since the last one. That number is never trusted:

- only the **foreground** counts — a backgrounded tab stops accumulating immediately;
- **idle time is not usage** — after five minutes without a pointer, key or scroll event the
  timer pauses and resumes on the next interaction;
- each delta is **clamped to five minutes** in the API and again in the database, so a laptop
  that wakes from sleep contributes one interval rather than the whole gap.

Tools with **no** recorded time still appear in the reports. That is deliberate: a feature
that vanishes when nobody opens it cannot show up as least-used.

### Where the money numbers come from

- **MRR** — each active or past-due subscription at its plan price, times seats on per-seat
  plans. Annual plans use `billing_plans.annual_price_cents`, which is the per-month rate
  when billed annually (matching `billing_overview()`). Trials are excluded and reported
  separately as pipeline.
- **ARR** — MRR × 12. A run-rate, not trailing revenue; trailing 12-month cash is reported
  alongside it so the two are never confused.
- **Average monthly spend** — cash collected in the range, normalised to a 30-day month,
  divided by paying accounts (or seats), so changing the date filter does not change what the
  metric means.
- **Historical months** — reconstructed from `org_billing_events`, an append-only log written
  by trigger on every plan, seat or status change. Months before that log existed show the
  state captured at its backfill.

### Seeing it with data

A new project has no customers, so the dashboards render zeros. To review them with a
plausible 18-month history:

```bash
cd backend
npm run analytics:seed            # demo customers, revenue and usage
npm run analytics:seed -- --wipe  # remove every trace of it
```

Demo organizations are named `Demo · …` and their users live on the reserved
`atmosphere.invalid` domain, which is how `--wipe` finds them. The script refuses to run if
the project already holds organizations it did not create, so demo figures cannot quietly mix
into real aggregates.

## Configuration

See `backend/.env.example` and `frontend/.env.example`. Key points:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — public, safe to expose. Baked-in defaults target
  the Atmosphere project.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only secret**. All *data* access still runs under
  the caller's JWT; this key is used for exactly one thing: minting a session during PIN
  unlock, which happens before the user has a session to act under. Leave it unset and PIN
  sign-in stays hidden — password login is unaffected. Never commit or expose it.
- `DEVICE_PEPPER` — **server-only secret**, required in production. Mixed into every PIN
  hash and deliberately kept out of the database, so a database leak alone cannot be used to
  sweep the small 4-digit PIN space offline. Generate with `openssl rand -base64 48`.
  Rotating it invalidates every enrolled device.
- `PASSWORD_RESET_REDIRECT_URL` — where recovery emails land. Defaults to
  `<FRONTEND_ORIGIN>/reset-password`. This URL must **also** be allowlisted in the Supabase
  dashboard under **Authentication → URL Configuration**, or the emailed link is rejected.
- `FRONTEND_ORIGIN` — comma-separated allowed CORS origins.
- `COOKIE_SAMESITE` — set to `none` (with HTTPS on both sides) if the frontend and backend
  are on different sites in production.

## Production notes

- Serve both over **HTTPS**; cookies are automatically marked `Secure` when
  `NODE_ENV=production`.
- Prefer serving the frontend and backend under the **same origin** (reverse-proxy the API
  at `/api`) so cookies stay `SameSite=Lax`. If you must split origins, set
  `COOKIE_SAMESITE=none` and configure `FRONTEND_ORIGIN`.
- Build: `npm run build` in each package (`backend` → `dist/`, `frontend` → `dist/`).
- Set `DEVICE_PEPPER` to a generated secret, and add the reset-password URL to the Supabase
  redirect allowlist — password reset fails silently without it.
- **Configure custom SMTP** before launch. Supabase's built-in mailer is rate-limited to a
  handful of messages per hour, which is fine for testing and will not carry real password
  resets.
