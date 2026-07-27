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
6. **Construction Estimator** — an agent that signs in to DocuSketch, reads the scan and
   the field photos, identifies the matching job in a CRM (Dash), reads the mitigation
   estimate, and builds the construction/rebuild estimate for Xactimate (see below).

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
| `estimator_credentials` | One row per org per vendor (DocuSketch / Dash / Xactimate). Holds only AES-256-GCM ciphertext. |
| `estimator_runs` | One row per estimator run: the scan, the matched job, the observations, the estimate, and the event log. |

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
│   │   ├── estimator/            Construction Estimator agent
│   │   │   ├── pipeline.ts       Stage orchestration; pauses for human review
│   │   │   ├── credentials.ts    AES-256-GCM vault for vendor credentials
│   │   │   ├── store.ts          Supabase persistence (runs + credentials)
│   │   │   ├── types.ts          Vendor-neutral domain model
│   │   │   ├── connectors/       DocuSketch / Dash / Xactimate + fixtures
│   │   │   ├── ai/               Photo reading and job-note reading
│   │   │   ├── matching/         Scan ↔ CRM job matcher
│   │   │   ├── scope/            Quantity maths, scope rules, rebuild rules
│   │   │   ├── pricing/          Xactimate category/selector catalog
│   │   │   └── estimate/         Estimate assembly, import, and export
│   │   └── routes/
│   │       ├── auth.ts           signup / login / logout / refresh / me
│   │       ├── org.ts            onboarding: me / create / join / members
│   │       ├── estimator.ts      Estimator setup, runs, review, export
│   │       └── health.ts         liveness probe
│   ├── test/                     node:test suites for the estimator's logic
│   └── .env.example
├── supabase/migrations/          SQL for the estimator tables + RLS policies
└── frontend/         React + Vite + TypeScript + Tailwind
    ├── src/
    │   ├── pages/LoginPage.tsx        Branded login + signup screen
    │   ├── pages/OnboardingPage.tsx   3-step wizard: org → role → work type
    │   ├── pages/DashboardPage.tsx    Org overview, invite code, linked accounts
    │   ├── pages/EstimatorPage.tsx    Connections, runs, job review, estimate review
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
| GET    | `/api/estimator/status` | cookie | —                          | What is connected, and what the server can do |
| PUT    | `/api/estimator/credentials/:provider` | cookie | credential | Store/replace vendor credentials    |
| DELETE | `/api/estimator/credentials/:provider` | cookie | —          | Disconnect a vendor                          |
| POST   | `/api/estimator/credentials/:provider/test` | cookie | —     | Sign in without starting a run               |
| GET    | `/api/estimator/projects` | cookie | —                        | DocuSketch scans available to estimate       |
| POST   | `/api/estimator/runs` | cookie | `{ scanProjectId, mitigationText? }` | Start a run (202; work continues behind it) |
| GET    | `/api/estimator/runs` | cookie | —                            | Runs in the caller's org                     |
| GET    | `/api/estimator/runs/:id` | cookie | —                        | One run, with its estimate and event log     |
| POST   | `/api/estimator/runs/:id/job` | cookie | `{ jobId }`          | Answer the matcher and resume the run        |
| POST   | `/api/estimator/runs/:id/approve` | cookie | —                | Approve the estimate and write it to Xactimate |
| GET    | `/api/estimator/runs/:id/export` | cookie | `?format=csv\|xml` | Download the estimate without sending it    |

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

## Construction Estimator

An agent that turns a 3D scan into a construction (rebuild) estimate. It signs in to
**DocuSketch** and reads the scan's rooms, measurements, and field photos; identifies the
matching job in a CRM (**Dash**) and reads its notes; reads the **mitigation estimate** when
there is one; and assembles the line items for **Xactimate**.

```
DocuSketch ──▶ rooms, measurements, photos ─┐
Dash (CRM) ──▶ the job, its notes           ├──▶ scope engine ──▶ estimate ──▶ Xactimate
Mitigation ──▶ what was already torn out  ──┘        ▲                  ▲
                                                     │                  │
                                              you pick the job    you approve the send
```

### The pipeline

`connecting → fetching_scan → matching_job → analyzing_photos → reading_mitigation →
building_scope → pricing → awaiting_review` — and then it stops.

Every stage persists what it produced, so a run that pauses for review resumes without
re-downloading the scan or re-reading forty photos.

**Two deliberate stops.** Writing an estimate into a customer's Xactimate account is
outward-facing and awkward to undo, so no run ever does it on its own: a person approves the
export. And if the matcher cannot separate two candidate jobs, the run parks with the
candidates and their scoring rather than picking one — building an estimate against the wrong
claim is the worst thing this agent could do.

### Where the scope comes from

Three sources, and the merge rules encode which to believe:

- **The mitigation estimate wins on existence.** It is a written, already-approved record of
  what was physically removed. Photos taken after mitigation show a gutted room — they cannot
  tell you it had carpet, because the carpet is in a dumpster. Removals map to replacements
  (`Remove carpet` → carpet + pad; a 2′ flood cut billed in LF becomes the SF that has to be
  re-hung, taped, and painted), and dryout lines — air movers, dehumidifiers, antimicrobial,
  monitoring, technician hours — are excluded by rule so they cannot be billed twice.
- **The scan wins on quantity.** A photo cannot measure a room. Where both sources produce the
  same line, the larger quantity is kept and both pieces of evidence stay attached.
- **The job notes win on inclusion.** A room the PM wrote "homeowner declined" against is
  dropped, whatever the photos show. Approved flood-cut heights and named materials come from
  the notes too.

Photos are read one per request so that every observation names the photo that produced it and
carries a confidence. Low-confidence findings reach the estimate **flagged**, not dropped —
and every line item carries the rationale and the evidence that justified it, which is what
makes the estimate defensible to an adjuster.

Quantities follow trade practice rather than raw geometry: openings above ~10 SF are deducted
from wall area and smaller ones are not, baseboard runs the perimeter less doorways but not
windows, a doorway shared between two scoped rooms is cased once, and paint is measured wall to
wall even when only a 2′ band of drywall was replaced.

### Line item codes

`backend/src/estimator/pricing/catalog.ts` maps semantic keys (`drywall_half`) to Xactimate
category/selector pairs (`DRY 1/2-`), units, trades, and waste allowances. **Selectors vary
between Xactimate versions, regions, and carrier price lists** — validate the catalog against
your own list before submitting. When they differ, the fix is that one table; the scope rules,
the quantity maths, and the export are unaffected.

### Credentials

The agent holds real vendor logins, so:

- Secrets are sealed with **AES-256-GCM** before they reach Postgres. The key lives only in
  `ESTIMATOR_CREDENTIAL_KEY` and is deliberately absent from the database — the same separation
  the PIN pepper relies on, and it means a database leak alone yields ciphertext.
- Nothing travels back to the browser. The API returns which providers are connected and a
  short fingerprint, never the secret — not even to the person who stored it.
- Only a **project manager** or **office manager** can connect a vendor, enforced both in the
  API and in the RLS policy.

### Running it without vendor accounts

`ESTIMATOR_CONNECTOR_MODE=sandbox` (the default outside production) serves built-in fixtures:
a water loss with four rooms, two CRM jobs at nearly the same address so the matcher has to
discriminate, a mitigation estimate mixing removals with dryout equipment, and a note putting
one room out of scope. Nothing is written to any vendor.

```bash
cd backend && npm test    # 64 tests: quantity maths, rebuild rules, matching, import/export
```

### Database

Apply `supabase/migrations/0001_construction_estimator.sql` (via `supabase db push`, or paste
it into the SQL editor). It creates both tables with RLS enabled and is safe to re-run.

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
- `ESTIMATOR_CREDENTIAL_KEY` — **server-only secret**, required to connect any vendor account.
  Encrypts DocuSketch/Dash/Xactimate credentials at rest and never reaches the database.
  Generate with `openssl rand -base64 32`. Rotating it invalidates every stored credential.
- `ANTHROPIC_API_KEY` — enables reading damage off photos and directions out of job notes.
  Optional: without it the estimator still builds scope from the measurements and the
  mitigation estimate, and says so in the run log.
- `ESTIMATOR_CONNECTOR_MODE` — `sandbox` (fixtures) or `live`. Defaults to `live` in
  production so a deploy cannot accidentally serve sample data.
- `DOCUSKETCH_BASE_URL` / `DASH_BASE_URL` / `XACTIMATE_BASE_URL` — vendor API roots. No
  defaults: an unset host makes that connector report itself unconfigured rather than guess.
  An organization can override any of them alongside its own credentials.
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
- Set `ESTIMATOR_CREDENTIAL_KEY` before anyone connects a vendor account, and back it up
  somewhere separate from the database — losing it means every stored credential has to be
  re-entered. Apply `supabase/migrations/0001_construction_estimator.sql` first.
- Confirm `ESTIMATOR_CONNECTOR_MODE` is `live` (its production default) and that the vendor
  base URLs point at your tenants before the first real run.
- **Configure custom SMTP** before launch. Supabase's built-in mailer is rate-limited to a
  handful of messages per hour, which is fine for testing and will not carry real password
  resets.
