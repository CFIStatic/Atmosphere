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
6. **Computer use** — connect an Anthropic API key, run the agent on any computer, and
   Claude can see its screen and operate it. The whole setup is one key and one command.
7. **Settings** — reached from the account block in the bottom-left corner of the sidebar:
   display name, password, PIN sign-in, role, and per-device preferences (see below).

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
│   │   ├── computer/
│   │   │   ├── protocol.ts       Wire protocol shared with the agent
│   │   │   ├── models.ts         Per-model tool version, beta header, image limits
│   │   │   ├── credentials.ts    Anthropic keys, encrypted at rest (AES-256-GCM)
│   │   │   ├── agentTokens.ts    Pairing codes + HMAC-signed agent tokens
│   │   │   ├── agentHub.ts       WebSocket registry of connected computers
│   │   │   └── runner.ts         The agent loop + live run transcripts
│   │   └── routes/
│   │       ├── auth.ts           signup / login / logout / refresh / me / password
│   │       ├── org.ts            onboarding: me / create / join / members
│   │       ├── profile.ts        the caller's own profile (display name)
│   │       ├── computer.ts       computer use: keys, pairing, runs, SSE
│   │       └── health.ts         liveness probe
│   └── .env.example
├── frontend/         React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── pages/LoginPage.tsx        Branded login + signup screen
│   │   ├── pages/OnboardingPage.tsx   3-step wizard: org → role → work type
│   │   ├── pages/DashboardPage.tsx    Org overview, invite code, linked accounts
│   │   ├── pages/ComputerUsePage.tsx  Live screen, task composer, transcript
│   │   ├── pages/SettingsPage.tsx     Profile, security, organization, preferences
│   │   ├── context/AuthContext.tsx    Session + membership + profile state
│   │   ├── components/AppShell.tsx    Sidebar + bottom-left account block
│   │   ├── components/                Logo, icons, ProtectedRoute
│   │   ├── lib/preferences.ts         Device-local preferences (localStorage)
│   │   └── lib/api.ts                 Typed fetch client (credentials: include)
│   └── .env.example
└── agent/            The computer-use agent (runs on the machine being operated)
    ├── src/
    │   ├── index.ts              CLI: pair once, then stay connected
    │   ├── computer.ts           Action executor + coordinate scaling
    │   ├── image.ts              Screenshot downscale / crop (sharp)
    │   ├── transport.ts          Outbound WebSocket with backoff
    │   └── drivers/              linux (xdotool) · darwin · win32 (PowerShell)
    └── README.md
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
| POST   | `/api/auth/change-password` | cookie | `{ currentPassword, newPassword }` | Change the password of a signed-in user |
| GET    | `/api/profile`       | cookie | —                             | Caller's profile (display name, email)       |
| PATCH  | `/api/profile`       | cookie | `{ fullName }`                | Update the caller's display name             |
| GET    | `/api/org/me`        | cookie | —                             | Caller's membership, or `null` if onboarding |
| PATCH  | `/api/org/me`        | cookie | `{ role, workType }`          | Update the caller's own role / work type     |
| POST   | `/api/org`           | cookie | `{ name, role, workType }`    | Create an org and join as first member       |
| POST   | `/api/org/join`      | cookie | `{ joinCode, role, workType }`| Link to an existing org by join code         |
| GET    | `/api/org/members`   | cookie | —                             | Linked accounts in the caller's org          |
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

### Settings

Every signed-in screen renders inside a shell with a left sidebar. The **account block sits
in the bottom-left corner** — avatar, name, and role, with a gear straight into Settings and
a menu holding the rest of the account actions. On narrow screens the same block is a tap on
the avatar in the top bar. Settings is four sections, each addressable by URL
(`/settings?section=security`):

| Section          | What it does                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| **Profile**      | Display name (`profiles.full_name`), plus read-only account facts.                |
| **Security**     | Change password, turn device PIN on/off, sign out.                                |
| **Organization** | Org name and invite code (read-only), and your own role / kind of work.           |
| **Preferences**  | Sidebar collapse, reduced motion, confirm-before-sign-out.                        |

Two properties are worth calling out:

- **Changing a password requires the current one.** `requireAuth` only proves the browser
  holds a session cookie; an unattended tab must not be enough to rewrite the credential and
  lock the owner out. The re-authentication also mints the session that authorises the
  update, and every *other* session is revoked afterwards. This device keeps its PIN — the
  user proved they know the password here, so there is nothing to distrust about this
  browser (unlike a reset, which assumes compromise and revokes everything).
- **Preferences never leave the device.** They describe how this browser should behave, so
  they live in `localStorage`, not the database — a phone in the field and an office desktop
  should not have to share a layout. Anything belonging to the *account* (name, role,
  password) goes through the API. Role edits are scoped to `user_id = auth.uid()` in the
  query and again by the RLS policy on `org_members`, so a member can only ever rewrite
  their own row. Renaming an organization is not offered: `orgs` has no UPDATE policy.

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
