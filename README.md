# Atmosphere

A platform for restoration and construction organizations — a React UI backed by an
Express BFF (Backend-for-Frontend) that mediates **Supabase Auth** and a Row-Level-Security
protected Postgres schema, plus a **reinforcement learning layer** that makes the platform
measurably better at executing work over time.

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
6. **Executes work, and learns from it** — drafts scopes, builds estimates, extracts
   document fields, writes customer updates. Every run is scored, and the routing policy
   improves from those scores. See [Learning layer](#learning-layer) below.

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
| `ai_arms`      | The action space: model × prompt variant per task type.              |
| `ai_arm_stats` | Learned posteriors per (arm × context). Aggregates only, no content.  |
| `ai_runs`      | The episode log — every task execution, its cost and its outcome.    |
| `ai_exemplars` | Accepted past outputs, mined into few-shot examples. Org-scoped.     |
| `ai_golden_cases` | Regression suite that gates any change to the serving policy.     |

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
│   │   ├── config.ts             Validated config (Supabase, cookies, CORS, model providers)
│   │   ├── app.ts                Express app assembly (helmet, cors, cookies, routes)
│   │   ├── index.ts              Server bootstrap + graceful shutdown
│   │   ├── lib/
│   │   │   ├── supabase.ts       Anon + per-request user-scoped client factories
│   │   │   ├── session.ts        httpOnly session-cookie set/clear
│   │   │   ├── validation.ts     zod schemas (credentials, org create/join)
│   │   │   └── errors.ts         Typed HTTP errors
│   │   ├── ai/                   Learning layer — see docs/reinforcement-learning.md
│   │   │   ├── policy.ts         Thompson sampling + hierarchical context backoff
│   │   │   ├── reward.ts         The definition of "executed correctly"
│   │   │   ├── verifiers.ts      Deterministic checks + the serving gate
│   │   │   ├── executor.ts       route → execute → verify → record, with failover
│   │   │   ├── learn.ts          Promotion gate, exemplar mining, training export
│   │   │   └── providers/        OpenAI · Anthropic · Google · xAI · open weights
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts    Verify access token; transparent refresh
│   │   │   └── errorHandler.ts   404 + central JSON error handler
│   │   ├── scripts/learn.ts      Offline learning cycle (cron entry point)
│   │   └── routes/
│   │       ├── auth.ts           signup / login / logout / refresh / me
│   │       ├── org.ts            onboarding: me / create / join / members
│   │       ├── ai.ts             task execution / feedback / policy visibility
│   │       └── health.ts         liveness probe
│   └── .env.example
├── db/migrations/    SQL schema (RLS policies + SECURITY DEFINER write path)
├── docs/             Architecture notes
└── frontend/         React + Vite + TypeScript + Tailwind
    ├── src/
    │   ├── pages/LoginPage.tsx        Branded login + signup screen
    │   ├── pages/OnboardingPage.tsx   3-step wizard: org → role → work type
    │   ├── pages/DashboardPage.tsx    Org overview, invite code, linked accounts
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
| GET    | `/api/ai/tasks`      | cookie | —                             | Task catalog and how each one is judged      |
| POST   | `/api/ai/tasks/:type/run` | cookie | `{ input, workType? }`   | Execute a task; returns `runId`              |
| POST   | `/api/ai/runs/:id/feedback` | cookie | `{ disposition? , editedOutput? }` | Close the learning loop         |
| GET    | `/api/ai/policy`     | cookie | —                             | Every arm, its posterior, cost and status    |
| GET    | `/api/ai/runs`       | cookie | —                             | Recent episodes for the caller's org         |

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

## Learning layer

Full architecture: **[docs/reinforcement-learning.md](docs/reinforcement-learning.md)**.

Most AI features are static — pick a model, write a prompt, ship it, and it performs
identically forever. This one closes the loop instead: every task the platform executes
produces evidence, and that evidence changes how the next one is executed.

It is a **contextual bandit** over *executor configurations*, not model training. The
action space is `provider × model × prompt variant`; the reward is a scalar in `[0,1]` from
deterministic verifiers, human accept/edit signals, cost and latency. We learn which setup
does each kind of work best — so the platform improves the moment a better model ships
anywhere in the industry, with no retraining and no migration.

**Multi-provider — OpenAI, Anthropic, Google, xAI (Grok) and open weights — is the
mechanism, not vendor hedging.** With one model there is no routing decision to learn and
the ceiling is fixed at whatever that vendor is good at this quarter. With five, model
specialisation becomes discoverable per task type, cheap arms can win the work that does
not need a frontier model, and a price rise or deprecation is just an arm's posterior
moving rather than a migration project. Every API key is optional: an unset key removes
that vendor's arms and nothing else changes.

Quality is **monotone by construction**:

- Deterministic checks gate every output — money that does not add up, a quoted span that
  is not in the source document, or a promise the job record cannot support never reaches
  a customer, no matter which arm produced it.
- ~90% of traffic stays on the proven champion; challengers are capped at a small,
  configurable exploration budget.
- Promotion requires the challenger's *lower confidence bound* to beat the champion's
  *mean*, plus a clean run of a fixed regression suite. An arm cannot be promoted on a
  lucky streak.
- If an experiment fails verification the run is still recorded — that is real evidence —
  and the champion produces what the user actually receives. Exploration costs us money;
  it does not cost the user a wrong answer.
- Vendor outages and timeouts fail over **without** recording a reward, so a bad afternoon
  at one provider never teaches the policy to abandon a good model.

Learning happens at two tiers with two privacy postures. **Global** tables hold aggregates
only — no customer content — so every org's work improves the routing every other org
benefits from. **Org** tables hold real job content and are RLS-scoped, exactly like the
rest of this schema. Accepted outputs are mined into per-org few-shot exemplars, which is
how the platform learns *one company's* house style without training any weights.

Because every run is a labelled comparison scored by the same verifier and the same people,
the episode log is also a preference dataset — generated as a by-product of doing the work.
Export it to fine-tune an open-weights model, which then re-enters the pool as an ordinary
candidate arm and has to win on the same evidence as everyone else.

```bash
cd backend
npm test                                    # verify the decision logic
npm run learn                               # offline cycle: promotions + exemplar mining
npm run learn -- --export draft_scope       # preference pairs as JSONL, for fine-tuning
```

Apply the schema with `psql "$DATABASE_URL" -f db/migrations/0002_reinforcement_learning.sql`.
Start with `AI_EXPLORATION_ENABLED=false` — runs are still recorded and scored, so you
accumulate the evidence that makes exploration informed before it touches real users.

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
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `XAI_API_KEY` / `OSS_BASE_URL`
  — **server-only secrets**, all optional. Each unset key removes that vendor's arms from
  the routing pool; the loop still runs on whatever remains. With one key it learns over
  prompt variants, with several it also learns which vendor suits which kind of work.
- `AI_EXPLORATION_ENABLED` / `AI_CANDIDATE_TRAFFIC_SHARE` — the exploration budget. Runs
  are recorded and scored either way; this only controls whether challengers get traffic.
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
