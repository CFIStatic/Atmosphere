# Atmosphere

**Work verification / Field Capture** for field and office teams on construction
and trade jobs.

Crews film the day on site. The office opens a job file — Chat, Happening Now,
videos, packet, evidence — with timed analysis of people, speech, objects, and
moments. Atmosphere is not a sales suite, PM board, or general operations OS.

```
  Field (Capture)                         Office (Platform)
 ─────────────────                       ──────────────────
  Record on phone (web or iOS)            Open job file → Chat by default
  Upload / stream parts                   Analysis auto-queues on finalize
  Sign in or job-share token              Ask the job; review Videos / Packet
                                          Share evidence outward
```

## Surfaces

| Surface | Role | Production host (typical) |
| --- | --- | --- |
| **Field Capture** | On-site record + upload (web PWA + iOS) | `https://app.atmosphereteam.com` |
| **Platform** | Office console — job files, intake, settings | `https://platform.atmosphereteam.com` |
| **Atmosphere APIs** | Express BFF (Railway) | Railway service `Atmosphere APIs` |
| **Corporate website** | Marketing / docs site | `https://atmosphereteam.com` (`website/`) |
| **Internal Growth Metrics** | Staff analytics (not customer-facing) | Railway service `Internal Growth Metrics` (`internal/`) |
| **Verifier** | Evidence portal (embed + standalone) | Served with Platform (`verifier/`) |

Field Capture and Platform share one Atmosphere login. Job-share links still
work without an office seat (invitees / subs). Production ships on **Railway**
(see [`docs/production.md`](docs/production.md)).

## How it works

1. **Start a job** — Office **Start a job** (`/intake`) pastes or drafts a brief
   and invites crew; Field Capture can also name a job on the phone. Same org +
   normalized title **reuses** an open job — do not mint duplicate folders.
2. **Capture** — Field Capture (web or `apps/field-ios/`) records video + mic,
   streams parts when online, files the day through the BFF into Storage.
3. **Analysis** — On successful upload finalize, vision + speech **auto-queue**.
   Readings reconstruct timed people / speech / objects / moments. Stuck or
   failed rows are reclaimed by a sweep (same queues as new uploads). A thin
   transcript alone must not clear a still-running or failed analysis — pending
   / failed vision outranks mic-only text.
4. **Job file** — Office opens the file at `/job-progress` (bookmarks to
   `/jobs/:id` redirect here). Section bar (office):
   - **Chat** (default on open) — job-scoped Ask
   - **Happening Now** — live progress / on-site story
   - **Access** — who has the file (hidden for some grant viewers)
   - **Videos** — filed film
   - **Packet** — claim-ready packet
   - **Evidence report** — evidence locker
   - **Job history** — scope, crew, documents
5. **Playback** — Safari-hostile WebM originals get a sibling `.play.mp4`
   derivative for Platform playback.
6. **Share** — Evidence shares and progress links open for pinned Atmosphere
   accounts / guests as designed on those routes.

**Field Capture does not run the full office analysis on the phone.** Capture is
record + upload. Judgment and Ask live in Platform / Verifier.

## Ask (Chat)

Job-scoped assistant under the **Chat** tab:

- Grounded in that job’s brief, film, and analysis; live web search for topical
  outside questions when configured.
- Professional prose formatting for the office.
- No model-name chrome in the UI (no “Live model” labels).
- Machine citation trailers are stripped for display — never leave raw
  `[[web:…]]` junk in the bubble.

## Connect (Settings)

**Settings → Connect** (`/settings?section=connect`; legacy `/crm` redirects
here). Users store **CRM username + password** so an Atmosphere **agent** can
sign into:

- JobNimbus
- AccuLynx
- Salesforce
- ServiceTitan

…to pull / push jobs, contacts, and claims.

This is **not** OAuth / API-key Connect as the primary UX. Atmosphere-native job
fields (title, address, notes, etc.) stay always-on on the job file elsewhere —
they are **not** listed as a Connect CRM row. Details:
[`docs/crm-agent-credentials.md`](docs/crm-agent-credentials.md).

## Product principles (contributor-facing)

- **No Delete** for filed evidence / videos in the customer app UI (API returns
  gone / removed paths for those surfaces). Global Admin purge is a separate
  staff path — do not reintroduce kebab Delete for end users.
- **Child privacy blur is always on** for every org — no opt-out.
- **Motion clips** are internal / staff only (Internal tooling) — not a job-file
  section for customers.
- **Do not auto-create duplicate jobs** — reuse open jobs with the same
  normalized title in the org (`findOpenCrmJobByTitle`).
- **Brand lockup** — Atmosphere wordmark + five bars (orange base `#F2670C`)
  across Platform, Field Capture, corporate site, and Internal. Do not restore
  retired Saturn / tile / split-Atmo marks (`frontend/src/components/Logo.tsx`).

Atmosphere is **not** selling a sales platform, estimator, computer-use agent,
or general ops OS. Those products were removed from the tree; git history keeps
them.

## Who it is for

| Audience | What they get |
| --- | --- |
| **Global Admin** | Company account, invites Employees, full access including **billing** |
| **Employees** | Same workspace (record / open jobs) — **no billing** |
| **Invited workers** | Job-share link — brief, film, upload for that job |
| **Adjusters / examiners / counsel** | Shared Verifier / progress links pinned to an Atmosphere account |

## Architecture

```
┌──────────────────────┐         /api/*          ┌──────────────────────┐
│  Platform (React)    │ ──────────────────────▶ │  Backend (Express)   │
│  Vite + Tailwind     │   httpOnly session      │  BFF + verification  │
│  /verifier-library   │ ◀────────────────────── │  job-share · proof   │
│  /job-progress · …   │                         │  Ask · media · CRM   │
└──────────────────────┘                         └──────────┬───────────┘
                                                            │ service role /
                                                            │ user JWT + RLS
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Supabase            │
                                                 │  Auth · Postgres     │
                                                 │  Storage (job-proofs)│
                                                 └──────────────────────┘

  Field Capture (static + iOS) ──▶ /api/field-app · job-share proof ──▶ Storage
  Verifier (static)            ──▶ /api/evidence-portal · shared evidence
```

- Passwords live in Supabase Auth; the app never stores plaintext login
  passwords.
- Session tokens sit in **httpOnly** cookies — not in page JavaScript.
- Org data is read with the caller’s JWT so **RLS** enforces tenancy. Field
  identity / My jobs use a separate session the invitee holds.
- Invites and OTPs are sent by **Atmosphere** (Resend preferred /
  `hello@invites.atmosphereteam.com`), not the customer’s Gmail/Microsoft
  mailbox. See [`docs/email-deliverability.md`](docs/email-deliverability.md).

## Project layout

```
Atmosphere/
├── frontend/                 Platform — office console (React + Vite)
│   ├── src/pages/            Intake, Dashboard shell, job file, Settings, …
│   └── src/components/Logo.tsx   Brand lockup (wordmark + orange bar)
├── fieldcapture/             Crew capture web app (static)
├── apps/field-ios/           Native Field Capture (Swift)
├── verifier/                 Evidence portal (static HTML)
├── backend/                  Express BFF
│   ├── src/routes/           Auth, intake, shared jobs, proof, field-app, …
│   ├── src/shared/           Ask, analysis sweep, proof helpers
│   ├── src/verification/     Durable video work-verification pipeline
│   └── supabase/migrations/  Schema (mirrored under supabase/migrations/)
├── website/                  Corporate marketing site
├── internal/                 Staff Growth Metrics site (Railway)
├── docs/                     Production, CRM Connect, privacy, pipelines, …
├── scripts/host-phone.sh     HTTPS tunnel for phone testing
└── docker-compose.yml        Local production-shaped stack
```

Office nav (Verification platform): **Start a job** (`/intake`), **Dashboard**
(`/verifier-library`), **Settings** (`/settings`). Field platform home:
`/field`. Job list path `/jobs` redirects to the Dashboard; open files use
`/job-progress`.

## Local development

### Prerequisites

- **Node 20+** (`backend` engines)
- A Supabase project (Auth + Postgres + Storage)
- Optional: Resend (`RESEND_API_KEY`) or SMTP so invites / OTPs send
- Optional: vision / transcription keys for analysis and captions (see
  `backend/.env.example` and [`docs/video-work-verification.md`](docs/video-work-verification.md))

### Backend

```bash
cd backend
cp .env.example .env   # SUPABASE_*, FRONTEND_ORIGIN, RESEND_* / SMTP_*, etc.
npm install
npm run dev            # default http://localhost:4000
```

Apply migrations from `backend/supabase/migrations/` (and mirrored copies under
`supabase/migrations/` where present). Create a Storage bucket for proofs
(typically `job-proofs`) with an appropriate size cap.

Useful scripts (from `backend/package.json`):

```bash
npm run typecheck && npm test && npm run build
npm run check:migrations
npm run smoke:synthetic   # when synthetic A/V path is configured
```

### Platform (office)

```bash
cd frontend
npm install
npm run dev            # Vite; proxy / API via env (see vite config)
```

Sign in → onboarding (create or join an org) → **Start a job** or **Dashboard**.

Demo mode (no backend):

```bash
VITE_DEMO=1 npm run dev
```

### Field Capture

Serve `fieldcapture/` next to the API, or use the Platform Vite app which also
mounts `/fieldcapture`:

```text
/fieldcapture/index.html?token=<access_token>&api=http://localhost:4000
```

Without `token`, sign in with the same email/password as Platform. Live upload
is refused without credentials (no invented demo day unless `demo=1`).

### Phone (HTTPS)

```bash
# Backend :4000 and Vite app :5174 already running
bash scripts/host-phone.sh
```

Open the printed Field Capture and Office HTTPS URLs. Safari → Share → **Add to
Home Screen**. The native iPhone app is `apps/field-ios/` (Xcode → device); it
talks to the live BFF, not localhost.

### Verifier

Open `/verifier/?embed=1` from the office shell, or serve `verifier/` standalone
against the API.

### Docker (production-shaped local)

```bash
cp backend/.env.example backend/.env   # fill real values
docker compose up --build
# App: http://localhost:8080  · Internal: http://localhost:8081  · API: :4000
```

## Production

See **[`docs/production.md`](docs/production.md)** for Railway services
(Atmosphere APIs, Platform, Field Capture, Corporate Website, Internal Growth
Metrics), required env, health probes (`/api/health`, `/api/ready`, `/healthz`),
migration order, and auto-deploy on `main`.

CI runs backend/frontend tests and builds, migration checks, and Docker image
builds on push (see `.github/workflows/`).

## Related docs

| Doc | Topic |
| --- | --- |
| [`docs/production.md`](docs/production.md) | Deploy + go-live checklist |
| [`docs/crm-agent-credentials.md`](docs/crm-agent-credentials.md) | Settings → Connect agent credentials |
| [`docs/video-work-verification.md`](docs/video-work-verification.md) | Analysis / verification pipeline |
| [`docs/child-privacy-redaction.md`](docs/child-privacy-redaction.md) | Always-on child blur |
| [`docs/motion-clips.md`](docs/motion-clips.md) | Motion clips (staff / Internal) |
| [`docs/stripe.md`](docs/stripe.md) | Stripe Checkout + webhooks |
| [`docs/email-deliverability.md`](docs/email-deliverability.md) | Resend / invites domain |
| [`fieldcapture/README.md`](fieldcapture/README.md) | Live capture + query params |
| [`verifier/README.md`](verifier/README.md) | Evidence portal access model |
| [`apps/field-ios/README.md`](apps/field-ios/README.md) | Native Field Capture status |
| [`internal/README.md`](internal/README.md) | Staff Growth Metrics site |
| [`website/`](website/) | Corporate site |
