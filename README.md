# Atmosphere

Authentication, organization onboarding, and **computer use** for **Atmosphere** — a React
UI backed by an Express BFF (Backend-for-Frontend) that mediates **Supabase Auth**, a
Row-Level-Security protected Postgres schema, and Claude's computer-use tool.

```
┌────────────────────┐      /api/*        ┌────────────────────┐    Supabase JS (JWT)   ┌──────────────────┐
│  Frontend (React)  │ ─────────────────▶ │  Backend (Express) │ ─────────────────────▶ │  Supabase        │
│  Vite + Tailwind   │  httpOnly cookies  │  BFF / auth proxy  │   anon key + user JWT  │  Auth + Postgres │
└────────────────────┘ ◀───────────────── └─────────┬──────────┘ ◀───────────────────── └──────────────────┘
                            SSE transcript          │  ▲
                                                    │  │  Messages API (computer tool)
                                                    ▼  │
                                          ┌────────────────────┐
                                          │   Anthropic API    │
                                          └────────────────────┘
                                                    ▲
                        WebSocket (outbound-only)   │  screenshots ↓ / clicks + keys ↑
                                          ┌─────────┴──────────┐
                                          │  Atmosphere agent  │  ← runs on the computer
                                          │  macOS/Win/Linux   │     being operated
                                          └────────────────────┘
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
6. **Mitigation Estimator** — reads a DocuSketch scan, a MICA report, iPhone photos and field
   notes, and builds a priced, documented Xactimate estimate from them: classified against
   IICRC S500, written to the carrier's program terms, and reviewed for work that was
   performed but never billed (see below).
7. **Computer use** — connect an Anthropic API key, run the agent on any computer, and
   Claude can see its screen and operate it. The whole setup is one key and one command.

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
| `estimator_jobs` / `estimator_estimates` | Estimating jobs and immutable estimate snapshots. |
| `estimator_settings` | Per-org margin, O&P, tax and cost-basis assumptions.           |
| `xactimate_connections` | One row per user: consent grant + optional encrypted credential. |
| `xactimate_audit`  | Append-only record of what was done in a user's Xactimate account.   |
| `xactimate_price_lists` | Synced price lists, shared across the org.                     |
| `carrier_agreements` | Per-org carrier program terms — one set per carrier + program.   |
| `carrier_deviations` | Documented, evidence-backed exceptions to a term, per job.       |

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
│   │   │   ├── estimator.ts      build / save / export / settings / catalog
│   │   │   ├── xactimate.ts      connect / disconnect / price lists / push
│   │   │   ├── computer.ts       computer use: keys, pairing, runs, SSE
│   │   │   └── health.ts         liveness probe
│   │   ├── computer/
│   │   │   ├── protocol.ts       Wire protocol shared with the agent
│   │   │   ├── models.ts         Per-model tool version, beta header, image limits
│   │   │   ├── credentials.ts    Anthropic keys, encrypted at rest (AES-256-GCM)
│   │   │   ├── agentTokens.ts    Pairing codes + HMAC-signed agent tokens
│   │   │   ├── agentHub.ts       WebSocket registry of connected computers
│   │   │   └── runner.ts         The agent loop + live run transcripts
│   │   └── estimator/            The Mitigation Estimator agent
│   │       ├── agent.ts          The pipeline, end to end
│   │       ├── types.ts          Canonical domain model
│   │       ├── ingest/           DocuSketch / MICA / photos / notes → assessment
│   │       ├── lib/              Geometry + IICRC S500 psychrometrics
│   │       ├── rules/            Scope derivation, then scope → line items
│   │       ├── standards/        IICRC citation registry + compliance review
│   │       ├── carrier/          Carrier identification, program terms, deviations
│   │       ├── catalog/          Seed line items + price-list reconciliation
│   │       ├── pricing.ts        Subtotal, O&P, tax, margin
│   │       ├── profitability.ts  Findings: unbilled work, evidence gaps, margin
│   │       ├── xactimate/        Consent, credential vault, drivers (mock/api/web)
│   │       ├── export/           CSV / XML / scope sheet, for manual import
│   │       ├── fixtures/         A worked example
│   │       └── demo.ts           npm run estimator:demo
│   └── .env.example
├── frontend/         React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── pages/LoginPage.tsx        Branded login + signup screen
│   │   ├── pages/OnboardingPage.tsx   3-step wizard: org → role → work type
│   │   ├── pages/DashboardPage.tsx    Org overview, invite code, linked accounts
│   │   ├── pages/EstimatorPage.tsx    Estimator workspace
│   │   ├── pages/ComputerUsePage.tsx  Live screen, task composer, transcript
│   │   ├── context/AuthContext.tsx    Session + membership state
│   │   ├── components/estimator/      Sources, results, program terms, consent card
│   │   └── lib/api.ts                 Typed fetch client (credentials: include)
│   └── .env.example
├── agent/            The computer-use agent (runs on the machine being operated)
│   ├── src/
│   │   ├── index.ts              CLI: pair once, then stay connected
│   │   ├── computer.ts           Action executor + coordinate scaling
│   │   ├── image.ts              Screenshot downscale / crop (sharp)
│   │   ├── transport.ts          Outbound WebSocket with backoff
│   │   └── drivers/              linux (xdotool) · darwin · win32 (PowerShell)
│   └── README.md
└── supabase/migrations/               Estimator schema + RLS (apply before use)
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
| POST   | `/api/estimator/build` | cookie | `{ docusketch?, mica?, photos?, notes? }` | Build an estimate; saves nothing |
| POST   | `/api/estimator/estimates` | cookie | same as `build`         | Build and persist                            |
| GET    | `/api/estimator/estimates/:id` | cookie | —                   | A saved estimate                             |
| GET    | `/api/estimator/estimates/:id/export` | cookie | `?format=csv\|xml\|scope` | Download for manual import      |
| GET    | `/api/estimator/jobs` | cookie | —                            | The org's estimating jobs                    |
| GET/PUT| `/api/estimator/settings` | cookie | margin/O&P/tax/cost knobs | Org estimating assumptions               |
| GET    | `/api/estimator/catalog` | cookie | —                         | Line-item catalog + which prices are verified |
| GET    | `/api/estimator/standards` | cookie | —                       | The IICRC citation registry + confidence of each |
| GET    | `/api/estimator/carriers` | cookie | —                        | Carriers and assignment networks recognised   |
| GET/PUT| `/api/estimator/agreements` | cookie | agreement terms        | The org's carrier program agreements          |
| POST   | `/api/estimator/agreements/fetch` | cookie | `{ carrierId, programId? }` | Pull terms from the contractor portal |
| GET/POST | `/api/estimator/jobs/:jobId/deviations` | cookie | `{ ruleId, reason, evidenceIds }` | Documented deviations from program terms |
| GET    | `/api/estimator/demo-sources` | cookie | —                    | A worked example, for evaluation             |
| GET    | `/api/xactimate/status` | cookie | —                          | Connection, scopes, expiry — never a credential |
| POST   | `/api/xactimate/connect` | cookie | `{ username, password, scopes, storageMode, acknowledgedTerms }` | Sign in under an explicit grant |
| POST   | `/api/xactimate/disconnect` | cookie | —                      | Revoke and destroy any stored credential     |
| POST   | `/api/xactimate/resume` | cookie | —                          | Re-establish a session from a stored credential |
| GET    | `/api/xactimate/price-lists` | cookie | —                     | Price lists the account can see              |
| POST   | `/api/xactimate/price-lists/sync` | cookie | `{ priceListId }` | Pull a price list and make it the org's     |
| POST   | `/api/xactimate/price-lists/upload` | cookie | `{ id, name, entries }` | Upload an exported price list — no login  |
| POST   | `/api/xactimate/push` | cookie | `{ estimate, confirmedFindings }` | Write the estimate into the account   |
| GET    | `/api/xactimate/activity` | cookie | —                        | What was done in the account, under the grant |
| GET    | `/api/computer/status` | cookie | —                           | Key status, online computers, model options  |
| PUT    | `/api/computer/credentials` | cookie | `{ apiKey }`           | Connect the org's Anthropic key              |
| DELETE | `/api/computer/credentials` | cookie | —                      | Disconnect it                                |
| POST   | `/api/computer/agents/pair-code` | cookie | —                 | Mint a one-time code to enrol a computer     |
| POST   | `/api/computer/agents/pair` | —      | `{ code, name, platform }` | Agent redeems a code for a durable token |
| GET    | `/api/computer/agents` | cookie | —                           | Computers currently online                   |
| GET    | `/api/computer/agents/:id/screen` | cookie | —                | One fresh frame (read-only)                  |
| POST   | `/api/computer/runs` | cookie | `{ agentId, instruction, … }` | Give a computer a task                       |
| GET    | `/api/computer/runs` | cookie | —                             | Recent runs                                  |
| GET    | `/api/computer/runs/:id/events` | cookie | `?after=<seq>`      | SSE transcript, replayable from a sequence   |
| POST   | `/api/computer/runs/:id/stop` | cookie | —                     | Hand control back to the operator            |

Agents also hold a WebSocket open at `/api/computer/agent-socket`, authenticated with the
token from pairing rather than a session cookie.

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

## Mitigation Estimator

An agent that turns the record of a water-damage job into a priced, documented Xactimate
scope. It reads a **DocuSketch** scan, a **MICA** report, **iPhone photos** and the
technician's **field notes**; classifies the loss against **IICRC S500**; derives the scope;
maps it to Xactimate line items; prices it against the org's real price list; and reviews the
result for work that was performed but never billed.

```
DocuSketch ┐
MICA       ├─▶ normalise ─▶ assess ─▶ scope ─▶ line items ─▶ price ─▶ profitability review
photos     │   (fuse)      (S500)   (rules)   (catalog)    (list)    (findings)
notes      ┘                                                              │
                                                                          ▼
                                          Xactimate  ◀── API │ browser │ file export
```

Try it without a database, a network, or an Xactimate account:

```bash
cd backend && npm run estimator:demo            # full run against a worked example
cd backend && npm run estimator:demo -- --scope-sheet   # the adjuster-facing document
```

### It knows which carrier it is writing for, and estimates to their terms

A franchise on a national account is not free to write whatever scope the
documentation supports. The program agreement — negotiated between the franchisor and
the carrier, binding on every franchise in the network — sets the price list, whether
overhead and profit is payable, what needs pre-approval, how many equipment days go
unquestioned, what documentation must accompany the invoice, and how fast each milestone
must happen. Estimating outside those terms produces chargebacks, delayed payment and
eventually removal from the program, and the franchise wears all three.

So the agreement is a **hard constraint**, and the profitability engine optimises inside
it rather than around it.

**Identifying the carrier.** Read from the MICA carrier field first, then from notes and
photo captions, then from claim-number shape. The result carries *how* it knows —
`stated`, `inferred` or `unknown` — because a wrong carrier applies the wrong price list
and the wrong terms to the whole job. An inferred identification is offered for
correction rather than presented as settled, and when several carriers appear in the
sources it says so instead of picking. The **program** (Contractor Connection, Alacrity,
Sedgwick, a direct national account) is identified separately, because that is what
actually carries the terms — the same carrier can pay differently depending on which
network assigned the job.

**Applying them.** Pricing terms — the mandated price list, O&P eligibility, a negotiated
concession — are applied *before* the estimate is priced, so no intermediate the reviewer
reads is ever non-compliant. Scope terms — quantity caps, prohibited codes, approval
thresholds, documentation, timelines — are checked after. Nothing is silently trimmed to
fit a cap: quietly reducing equipment days would hide the exact fact the franchise needs
to raise with the carrier.

**Breaking them, in writing.** Real jobs exceed program limits legitimately — a structure
that has not reached its drying goal on the day the equipment allowance expires is the
obvious case. A term may be exceeded only through a deviation carrying a written reason
**and evidence already in the job**. A reason with no evidence is an assertion, not
documentation, and is rejected — by the API, and by a database constraint behind it.

The agent goes looking for those grounds itself. When the allowance is exceeded it
searches the moisture log for readings still above their goal after the cap expired, and
assembles the argument with the evidence ids attached. It never accepts its own proposal:
agreeing to exceed a carrier's terms is a commercial decision with a relationship behind
it, so a human makes it. Accepted deviations print on the estimate that goes to the
carrier.

An unexcused breach of a binding term **blocks the push to Xactimate** outright. That one
is not a confirmation the user can click past — the carrier will not pay a line the
agreement prohibits.

**Where the terms come from.** Hand-entered is the default and the only source guaranteed
to match what the franchise signed. A portal adapter speaks a documented JSON contract
that a franchisor endpoint (or a small internal shim in front of one) can serve. There is
deliberately **no browser scraper** for a contractor portal: a scraper written against
markup nobody has seen would not fail loudly when the page changed — it would return
plausible terms, and an estimate built on a plausible-but-wrong equipment cap is worse
than one built on no cap at all, because it is trusted. The failure would surface weeks
later as a chargeback.

### It cites the standard, and it is honest about how firmly

Every scope decision, line item and compliance check names the IICRC requirement it rests on.
Rules reference a **stable id** in `estimator/standards/s500.ts`; nothing anywhere else types
a section number. That indirection is not ceremony — before it existed, one plausible-looking
clause number had been attached to five unrelated requirements, which is exactly the kind of
thing an adjuster notices once and then checks everywhere.

Each citation carries **how firmly it is anchored**, and that changes what prints:

| Confidence | Renders as | Means |
| ---------- | ---------- | ----- |
| `clause` | `ANSI/IICRC S500-2021 §12.2.4` | A numbered clause. |
| `chapter` | `ANSI/IICRC S500-2021, Cleaning and antimicrobial agents` | Located to a chapter — deliberately **no number**, rather than inventing one to look precise. |
| `convention` | `… — industry practice, not a requirement of S500` | Standard practice the standard itself leaves to the restorer's judgement. |

That last row does real work. Several things restorers say "the S500 requires" are convention:
the 48/72-hour category thresholds, the class percentage bands, the initial-water-load divisor
table, air-mover coverage ranges, the 2-foot flood cut, and the idea that antimicrobial is
mandatory on any Cat 2. The estimator still uses all of them — they are what the industry
runs on — but it labels them, and lists them under "what this estimate does not claim". An
estimator arguing a scope is better off knowing which of their citations is a clause and which
is custom.

**The standards are not reproduced.** ANSI/IICRC S500 and S520 are copyrighted publications
sold by the IICRC. Every requirement in the registry is a paraphrase written for this
codebase; what the estimate carries is a pointer, so a reader with their own copy can turn
to it. `GET /api/estimator/standards` publishes the whole registry.

### It checks the estimate back against the standard

Separate from the profitability review, and asking a different question: the findings ask
what is *unbilled*, the standards review asks what is *indefensible*. Eighteen checks, each
citing its requirement and carrying a remedy — dry standard established from unaffected
material, drying verified to that goal before demobilising, porous material removed on
Category 3, wet cavities opened or dried, cleaning before chemistry, containment held under
negative pressure, dehumidification sized to the class, and so on.

`undetermined` is a real outcome. When the sources do not say, the check says it does not
know — scoring a missing MICA report as "met" would make the whole report worthless.

The two reviews overlap constantly, which is the point: an obligation a job skipped is
usually one it also failed to bill for. Checks that are both are marked *also unbilled work*.

### How the sources are fused

Four inputs describe one loss and they disagree. The rule is **measured beats recorded beats
written**: DocuSketch measured the room, so its geometry wins; MICA recorded the drying, so
its equipment log wins over prose; the notes fill what nothing else covered.

Water **category** is the deliberate exception — it takes the *worst* value any source
reports, not the highest-priority one. Under-calling contamination produces an estimate that
omits required work and a job that gets re-opened; over-calling it is caught at review.
Category also degrades with time (S500 §10.5.4): clean water that stood 48 hours is scoped as
Category 2, and the estimate says so in writing.

Every quantity traces back through a line item to a scope rule to the reading or photo that
produced it. The pipeline is deterministic — the same sources always produce the same
estimate — which is what lets you re-run one in front of an adjuster and defend a disputed
number line by line.

### What "making jobs profitable" means here

Mitigation jobs lose money in a few well-understood ways, and almost none of them are "the
prices were too low":

- work performed and never written down — monitoring hours, content manipulation, PPE,
  debris haul;
- equipment logged out late, so billed days understate days on site;
- the generic selector used where a specific, better-paying one applied (`WTRDHM` where an
  LGR was running);
- lines written without documentation, which get struck after the work is already sunk cost.

Every finding the review produces is one of those. What it will **not** do is add quantity the
measurements do not support, or bill work nobody performed. That is not scruple bolted on
afterwards: an inflated estimate gets re-priced, the carrier relationship degrades, and the
next ten jobs get scrutinised. Where the review can only see a *possibility*, it says what
would have to be confirmed and leaves the line off.

The counterweight is real — the review also flags lines that should come *off*, and refuses
to push an estimate with critical findings outstanding.

### Prices are not real until you sync

Xactimate selectors and prices vary by version, by region, and by carrier program. The
catalog in `catalog/lineItems.ts` is a **seed**, and every entry ships `verified: false`.
Reconciliation matches it against the price list on your own account — by code first, then by
description — and until that runs, every line is flagged and the UI says so. Three ways to get
real prices in:

| Route | Needs | Notes |
| ----- | ----- | ----- |
| **API** | A Verisk integration agreement | Best option. Supported, stable, never replays a password. |
| **Browser** | Your Xactimate Online login | For orgs without API access. Replays a password and breaks when the UI moves. |
| **File** | Nothing | Export the price list, upload it; download a CSV, import it by hand. Works everywhere. |

### Connecting an Xactimate account

Signing in as a user, in a system holding their carrier relationships and their customers'
claim data, is not something a settings checkbox should authorise forever. So:

- **Consent is explicit, scoped, and expiring.** Reading a price list is a different
  permission from writing an estimate; `write_estimate` and `submit_estimate` are *not*
  granted by default. Grants lapse after 30 days.
- **Not storing the password is the default.** Session-only mode uses it for one operation
  and zeroes the buffer — nothing reaches disk, so a database leak yields nothing. At-rest
  storage is opt-in, for unattended runs that cannot prompt.
- **The encryption key never touches the database.** `XACTIMATE_ENC_KEY` is env-only, the
  same separation that keeps the PIN table inert on its own. Leave it unset and at-rest
  storage is simply unavailable.
- **Revocation is immediate and destroys the credential** in the same statement that marks
  the grant revoked, with a database constraint behind it.
- **Every action is logged** against the grant that allowed it, visible to the user. A
  permission you cannot inspect the use of is not really a permission.
- **Browser automation is off unless explicitly enabled.** Whether it is permitted for a
  given account depends on that account's terms with Verisk — the account holder's call, not
  this software's. It will not solve a CAPTCHA or work around a block; when Xactimate asks
  for a second factor it stops and asks the user.

Xactimate sign-in attempts are rate-limited harder than the app's own login (5 per 15
minutes): a retry loop here walks a real company's account into a lockout mid-job.

### Setting it up

1. Apply the migrations in `supabase/migrations/` (via `supabase db push`, or paste them
   into the SQL editor) — `0001_mitigation_estimator.sql` then
   `0002_carrier_agreements.sql`. Until they are applied the estimator routes return a 503
   saying exactly that.
2. Leave `XACTIMATE_DRIVER` unset to run the mock driver, which needs nothing else.
3. For a real connection set `XACTIMATE_DRIVER=api` plus `XACTIMATE_API_BASE_URL` and
   `XACTIMATE_API_KEY`, or `XACTIMATE_DRIVER=web` plus `XACTIMATE_WEB_AUTOMATION=true` and
   `npm install playwright` in `backend/`.

### Two caveats worth stating plainly

**Prices.** The IICRC calculations, the scope rules and the fusion logic are implemented from
the standards and are unit-consistent. The **selectors and placeholder prices in the seed
catalog are not authoritative** — they follow Xactimate's conventions but have not been
reconciled against a real price list, which is exactly why nothing is billable until a sync
marks it verified. Have an estimator review the first few jobs against your own price list
before anything goes to a carrier.

**Citations.** Every entry in the registry currently sits at `chapter` or `convention`
confidence, never `clause`. That is deliberate rather than incomplete: precise clause numbers
were not corroborable without the copyrighted text in hand, and a confident wrong §-number is
worse on a submitted estimate than an honest chapter reference. If you hold a copy of the
S500, pinning a requirement to its clause is a one-line change — set `section` and flip
`confidence` to `'clause'` — and the estimate, the exports and the UI all start printing the
number with no other edit.
## Computer use

Claude sees a screenshot of a real machine, asks for a click or a keystroke, and the
result comes back as the next screenshot. Atmosphere supplies the three pieces that turns
into a product: somewhere to put the API key, something to run on the computer, and a
console to watch it work.

### Setting it up

1. Open **Dashboard → Computer Use** and paste an Anthropic API key
   ([console.anthropic.com](https://console.anthropic.com/settings/keys)). That is the
   only configuration step — no database migration, no extra service.
2. Click **Add a computer** and run the printed command on the machine you want operated:

   ```bash
   npx atmosphere-agent --server https://your-atmosphere --code ABCD-EFGH
   ```

3. The computer appears in the console with its screen live. Type a task and press
   **Start task**.

Prerequisites per platform (Node 18+, and on Linux `xdotool` plus a screenshot tool) are
in [`agent/README.md`](agent/README.md). The agent checks them at startup and names
anything missing.

### How a task runs

Each turn, the backend sends Claude the conversation so far plus the `computer` tool, and
Claude replies with an action. The backend forwards that action to the agent over the
WebSocket the agent already opened, waits for the result, and feeds it back as a
`tool_result`. The browser watches the whole thing over SSE — text, reasoning summary,
each action, and every screenshot.

**Coordinates are the part that has to be exactly right.** Claude answers in the
coordinate space of the image it was shown. If a screenshot exceeds the model's per-image
limits the API downscales it server-side, and then the model's coordinates are in a scale
nothing on our side computed — so every click misses. Atmosphere therefore downscales on
the agent, keeps the factor, and multiplies coordinates back up before moving the mouse.
The backend derives that factor from the selected model's real limits (2576 px on the long
edge for Opus 5, Sonnet 5 and Opus 4.8; 1568 px for older models) and tells the agent what
to capture at *before* declaring the tool, so the tool's `display_width_px` always matches
what the model will actually see.

Screenshots also dominate the token bill, so the **quality** setting picks a target
(economical ≈ 1366 px, balanced ≈ 1080p, detailed = the model's maximum) and old tool
results are cleared from the context automatically as the run goes on.

### Guard rails

Handing a model the mouse of a real machine deserves limits that do not depend on anyone
paying attention:

- **The operator holds the off switch.** Access exists only while the agent process is
  running on that computer. Ctrl+C revokes it instantly.
- **Every run is bounded** — 60 steps and 15 minutes by default, both configurable — and
  **Stop** ends it immediately from the console.
- **One run per computer.** A second task cannot claim a machine that is already busy;
  two runs interleaving clicks would produce nonsense.
- **The screen is always visible.** Watching the run is what makes it trustworthy rather
  than alarming, and it is how you know when to stop it.
- The system prompt tells Claude it is on a real machine: don't delete files, change system
  settings, or send messages unless the task asked for it, and stop and ask rather than
  guess at a credential or a payment.

### Security

- **API keys are encrypted at rest** with AES-256-GCM under `AI_CREDENTIALS_KEY`, and are
  never returned to the browser — the UI only ever sees a masked hint like `sk-ant-api0…9f2a`.
- **Pairing codes are single-use**, expire in 10 minutes, are drawn from an alphabet with
  no ambiguous characters, and the redemption endpoint is rate-limited to 20 attempts per
  15 minutes, which is what makes an 8-character code safe.
- **Agent tokens are HMAC-signed** and scoped to one organization. Rotating
  `AGENT_TOKEN_SECRET` unpairs every computer at once — the right blunt instrument for a
  suspected leak. There is deliberately no per-agent revocation list; stopping the agent
  is the immediate control, and `agentTokens.ts` is the seam to add a list behind if you
  later need one.
- **Agents dial out only.** Nothing listens on the operator's machine, so no inbound port
  or public address is needed.
- **Model-supplied text never reaches a shell.** Every platform driver invokes commands
  with an argument array, and the Windows driver passes its payload as base64 — a page
  containing `$(…)` or a stray quote cannot execute anything.

### Deployment note

The registry of connected computers lives in the backend process, because that is what a
live WebSocket already is — a connection cannot outlive the process holding it. Running
**multiple backend instances behind a load balancer** therefore needs sticky routing (so
a browser reaches the instance holding its agent's socket) or a shared relay between
instances. A single instance needs nothing.

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
- `XACTIMATE_ENC_KEY` — **server-only secret**, optional. Encrypts stored Xactimate
  credentials and, like `DEVICE_PEPPER`, is deliberately kept out of the database. Leave it
  unset and at-rest storage is unavailable: users connect in session-only mode, their
  password is never written down, and there is nothing for a database leak to yield. Only set
  it if you need unattended runs that cannot prompt for a password.
- `XACTIMATE_DRIVER` — `mock` (default), `api`, or `web`. See the estimator section above.
- `ANTHROPIC_API_KEY` — optional **server-only secret**. A server-wide default for computer
  use, so a deployment can ship with it already working. A key connected in the UI takes
  priority over it.
- `AI_CREDENTIALS_KEY` — **server-only secret**, required in production. Encrypts each
  organization's Anthropic key at rest. Generate with `openssl rand -base64 48`. Rotating
  it invalidates stored keys, which organizations simply re-enter.
- `AGENT_TOKEN_SECRET` — **server-only secret**, required in production. Signs the tokens
  paired computers reconnect with. Rotating it unpairs every computer.
- `FRONTEND_ORIGIN` — comma-separated allowed CORS origins.
- `COOKIE_SAMESITE` — set to `none` (with HTTPS on both sides) if the frontend and backend
  are on different sites in production.

## Production notes

- Serve both over **HTTPS**; cookies are automatically marked `Secure` when
  `NODE_ENV=production`.
- Prefer serving the frontend and backend under the **same origin** (reverse-proxy the API
  at `/api`) so cookies stay `SameSite=Lax`. If you must split origins, set
  `COOKIE_SAMESITE=none` and configure `FRONTEND_ORIGIN`.
- Build: `npm run build` in each package (`backend` → `dist/`, `frontend` → `dist/`,
  `agent` → `dist/`).
- Set `DEVICE_PEPPER` to a generated secret, and add the reset-password URL to the Supabase
  redirect allowlist — password reset fails silently without it.
- Set `AI_CREDENTIALS_KEY` and `AGENT_TOKEN_SECRET` before enabling computer use, and make
  sure your reverse proxy forwards **WebSocket upgrades** on `/api/computer/agent-socket`
  and does not buffer the SSE responses on `/api/computer/runs/*/events`.
- **Configure custom SMTP** before launch. Supabase's built-in mailer is rate-limited to a
  handful of messages per hour, which is fine for testing and will not carry real password
  resets.
- Apply both migrations in `supabase/migrations/` before the estimator is used; its routes
  return a clear 503 until you do.
- Load each carrier program agreement your franchise works under before estimating on it.
  Working a program job blind to its terms is the usual route to a chargeback, and the
  estimate says so when no agreement is loaded.
- Leave `XACTIMATE_DRIVER` on `mock` until an estimator has checked the seed catalog against
  your own price list. A verified sync is what turns placeholder prices into real ones.
