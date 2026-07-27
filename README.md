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
| `billing_plans` / `credit_packs` | Public catalog: subscription tiers and prepaid credit packs. |
| `model_rate_card` | Public **sell** prices per model. Derived from the private cost table. |
| `org_billing`  | One row per org: plan, seats, period, auto-reload, spend limit.       |
| `credit_lots`  | The live balance. Consumed soonest-expiry-first.                      |
| `credit_ledger`| Append-only audit trail of every credit movement.                     |
| `credit_purchases` | Prepaid top-ups and their settlement state.                       |
| `usage_events` / `usage_daily` | Every metered call, plus a trigger-maintained daily rollup. |

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
│   │   │   ├── validation.ts     zod schemas (credentials, org, billing, usage)
│   │   │   ├── money.ts          Nanodollar arithmetic — no floats for money
│   │   │   ├── anthropic.ts      Authoritative token measurement (+ tests)
│   │   │   ├── billing.ts        DB error → HTTP mapping, response shaping
│   │   │   └── errors.ts         Typed HTTP errors
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts    Verify access token; transparent refresh
│   │   │   ├── requireOrg.ts     Resolve caller's org from their own membership
│   │   │   └── errorHandler.ts   404 + central JSON error handler
│   │   └── routes/
│   │       ├── auth.ts           signup / login / logout / refresh / me
│   │       ├── org.ts            onboarding: me / create / join / members
│   │       ├── billing.ts        catalog / plan / credits / settings / ledger
│   │       ├── usage.ts          quote / record / events / daily rollup
│   │       ├── ai.ts             Metered model calls (authorize-then-capture)
│   │       └── health.ts         liveness probe
│   └── .env.example
├── supabase/
│   └── migrations/               Billing schema, pricing engine, RLS policies
└── frontend/         React + Vite + TypeScript + Tailwind
    ├── src/
    │   ├── pages/LoginPage.tsx        Branded login + signup screen
    │   ├── pages/OnboardingPage.tsx   3-step wizard: org → role → work type
    │   ├── pages/DashboardPage.tsx    Org overview, invite code, linked accounts
    │   ├── pages/BillingPage.tsx      Plans, credit packs, spend controls, rate card
    │   ├── pages/UsagePage.tsx        Spend charts, per-model breakdown, request log
    │   ├── context/AuthContext.tsx    Session + membership state
    │   ├── components/                Logo, icons, ProtectedRoute
    │   └── lib/api.ts                 Typed fetch client (credentials: include)
    └── .env.example
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
| GET    | `/api/billing/catalog` | —    | —                             | Plans, credit packs, model rate card         |
| GET    | `/api/billing/overview`| cookie | —                           | Plan, balance, settings, month-to-date usage |
| POST   | `/api/billing/plan`  | cookie | `{ planCode, billingInterval, seats }` | Change subscription tier            |
| PATCH  | `/api/billing/settings`| cookie | `{ autoReload…, monthlySpendLimitNanos }` | Auto-reload and spend cap    |
| GET    | `/api/billing/ledger`| cookie | —                             | Credit history (append-only)                 |
| POST   | `/api/billing/purchases` | cookie | `{ packCode }` or `{ amountCents }` | Start a credit purchase          |
| POST   | `/api/billing/purchases/:id/confirm` | cookie | —         | Settle a purchase (dev provider only)        |
| POST   | `/api/ai/count-tokens` | cookie | `{ model, messages, system }` | Exact pre-flight token count + input price |
| POST   | `/api/ai/messages`   | cookie | `{ model, messages, maxTokens, … }` | Run a model call and meter it          |
| POST   | `/api/usage/quote`   | cookie | `{ modelId, …tokens }`        | Price a call without charging                |
| POST   | `/api/usage/record`  | cookie | `{ modelId, requestId, …tokens }` | Meter caller-supplied counts (off by default) |
| GET    | `/api/usage/events`  | cookie | —                             | Recent metered calls                         |
| GET    | `/api/usage/daily`   | cookie | `?days=30`                    | Daily rollup for the usage chart             |

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

## Pricing, credits and metering

Atmosphere resells model capacity. Customers pay a **monthly plan** that includes
a usage allowance, and can **prepay credits** on top of it — the same shape
Anthropic and OpenAI use.

### The money rules

- **1 credit = $1 USD.** Internally every amount is an integer count of
  **nanodollars** (1e-9 USD). Never floats — a ledger that doesn't reconcile to
  the penny is worthless — and never cents, because one cached-read token on the
  cheapest model costs 200 nanodollars and would round to zero, letting a
  customer read cache for free.
- **Sell price = 2 × cost.** The markup lives in one column
  (`private.model_costs.markup`). Change it there and the customer-facing rate
  card is regenerated; nothing else needs editing.
- **Margin never reaches the browser.** What we pay sits in `private.model_costs`,
  in a schema PostgREST does not expose. What we charge sits in
  `public.model_rate_card`, projected through the markup by
  `private.sync_rate_card()`. A customer can read the rate card and can never
  read the cost basis.

Rates carry the provider's own structure, so the ratio holds across every
component: cache writes cost 1.25× the input rate (5-minute TTL) or 2× (1-hour),
cached reads 0.1×, and batch requests are half price.

| Model | We pay (in/out per MTok) | We charge |
| ----- | ------------------------ | --------- |
| Atmosphere Apex  | $10 / $50 | $20 / $100 |
| Atmosphere Pro   | $5 / $25  | $10 / $50  |
| Atmosphere Core  | $3 / $15  | $6 / $30   |
| Atmosphere Lite  | $1 / $5   | $2 / $10   |

### Plans

`rate_multiplier` is what "5x" and "20x" mean — throughput relative to Pro.
Included credits sit at 1.25× the plan price, so an allowance burned to the last
credit still clears a **37.5% gross margin** at a 2× markup.

| Plan | Price | Included credits | Throughput |
| ---- | ----- | ---------------- | ---------- |
| Free    | $0             | $3/mo          | 0.2× |
| Pro     | $20 ($17 annual) | $25/mo       | 1×   |
| Max 5x  | $100           | $125/mo        | 5×   |
| Max 20x | $200           | $250/mo        | 20×  |
| Team    | $30/seat ($25 annual) | $40/seat/mo | 5× |
| Enterprise | custom      | custom         | —    |

### How a request gets billed

Token counts decide revenue, so they come from exactly one place: **the model
provider's own `usage` object**. Not an estimate, not a character heuristic, not
a third-party tokenizer, and never a number supplied by the client. `POST
/api/ai/messages` runs **authorize-then-capture**, the shape a card payment uses:

1. **Count** the input exactly via the provider's tokenizer (`count_tokens`).
2. **Authorize** the worst case — that input plus a full `maxTokens` of output —
   and refuse with `402` if the balance can't cover it. This happens *before* the
   upstream call, so we never buy tokens we can't bill for.
3. **Call** the model.
4. **Capture** the actual usage from the response, which is almost always less
   than was authorized.

The provider reports four *disjoint* token classes — `input_tokens` excludes
cached tokens, which are counted separately as reads and writes — so summing them
double-counts nothing, but dropping one silently under-bills. Cache writes are
split by TTL because the tiers price differently; when the provider omits the
breakdown the whole amount is attributed to the cheaper 5-minute tier.
`extractUsage` is covered by tests (`npm test` in `backend/`) for exactly these
cases, including a breakdown that fails to reconcile with its own aggregate.

`POST /api/usage/record`, which takes caller-supplied counts, is **disabled in
production** (`ALLOW_CLIENT_METERING`). A browser reporting its own token counts
could under-report and spend our margin.

### Credits, in order

Charges draw down `credit_lots` **soonest-expiry-first**, which spends the plan
allowance a customer would otherwise lose before the credits they paid cash for.
Purchased credits never expire. Every movement is mirrored into `credit_ledger`,
so the ledger always sums to the live lot balances.

Three things protect the balance: a **spend limit** per period, an idempotent
`requestId` so a retried request is never billed twice, and the fact that every
balance-changing write goes through a `SECURITY DEFINER` function that validates
`auth.uid()` internally. The billing tables carry `SELECT` policies only — there
is no way to mint credits by POSTing to a table.

Billing periods roll forward on read, granting each elapsed period's credits, so
the system stays correct without a scheduler.

### Wiring a payment processor

Credit purchases are provider-agnostic. `PAYMENT_PROVIDER=dev` (the development
default) lets a billing manager settle their own purchase so the flow is
exercisable end-to-end; it is **refused at boot in production**, where it would
let anyone mint credits.

To go live: create the charge in `POST /api/billing/purchases`, return its client
secret, and have the processor's webhook call `complete_credit_purchase` with the
**service-role key**. That function only mints credits for a non-`dev` provider
when the caller holds the service role, and `credit_purchases` has a unique index
on `(provider, provider_ref)` so a redelivered webhook cannot double-credit.

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
