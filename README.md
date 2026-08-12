# Atmosphere

**The Work Verification Platform** for restoration and construction.

Atmosphere proves that scoped, agreed work was actually done. Every day on a
job can be filmed, checked at the door, read against the scope, and held in a
chain of custody you can hand to an adjuster, a bank, or a subcontractor —
without turning the product into a sales suite, a PM board, or an operations
console.

```
  Office (Verifier)                         Field (Capture)
 ─────────────────                         ────────────────
  Paste / approve scope                     Open invite link on phone
  Publish brief                             Accept brief
  Invite Field Capture / subs               Film the day (video + mic)
  Review clips + AI dictation               Upload through job token
  Share evidence outward                    Optional: claim → My jobs
```

## The product

One path. No money in this loop — handoff and proof only.

| Step | Who | What |
| --- | --- | --- |
| **1. Start a job** | Office | Paste claim/scope text → review drafted lines → approve once |
| **2. Publish the brief** | Office | First revision of facts + in-scope / do-not lines goes live |
| **3. Invite** | Office | Org Field Capture team (preloaded) and/or subcontractors by email |
| **4. Capture** | Crew | Phone opens the link, accepts the brief, films video + microphone |
| **5. Verify** | Office | Verifier watches clips, AI dictation against scope, unknown ≠ pass |
| **6. Hold & share** | Office | Custody log; evidence shares open for a pinned Atmosphere account |

**Field Capture does not run the AI report on the phone.** Capture is record +
upload. Judgment lives in the Verifier.

**Invites are sent by Atmosphere** (platform SMTP), not from the customer’s
Gmail/Microsoft mailbox. The email names the contractor; the From line is
Atmosphere. If the recipient already has an account, they sign in. If not, they
are prompted to create one with that exact address.

## Who it is for

| Audience | What they get |
| --- | --- |
| **General contractors** | Job files, briefs, invites, Verifier library, custody |
| **Field crews / subcontractors** | Token link → film the day; optional My jobs list across GCs |
| **Adjusters / examiners / counsel** | Shared Verifier links pinned to their Atmosphere account |

## Surfaces

### Work Verification (office)

- **Home:** Verifier library — one job, one file of clips and readings
- **Start a job** (`/intake`) — paste → review → approve → invite
- **Job files** (`/shared`) — briefs, parties, proof days, readiness, evidence
- **Verifier** (`/verifier/`) — standalone evidence portal (also embeddable)

### Field Capture (crew)

- **Web:** `fieldcapture/?token=<job-share-token>` — one-button video + mic
- **My jobs** (`/my-jobs`) — after claiming a link with email/phone OTP
- **iOS (App Store path):** `apps/field-ios/` — same upload contract; RoomPlan twin later

## Architecture

```
┌──────────────────────┐         /api/*          ┌──────────────────────┐
│  Frontend (React)    │ ──────────────────────▶ │  Backend (Express)   │
│  Vite + Tailwind     │   httpOnly session      │  BFF + verification  │
│  /intake · /shared   │ ◀────────────────────── │  job-share · proof   │
│  /verifier-library   │                         │  media · geometry    │
└──────────────────────┘                         └──────────┬───────────┘
                                                            │ service role /
                                                            │ user JWT + RLS
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Supabase            │
                                                 │  Auth · Postgres     │
                                                 │  Storage (job-proofs)│
                                                 └──────────────────────┘

  Field Capture (static) ──token──▶ /api/job-share/*/proof/* ──▶ Storage PUT
  Verifier (static)      ──auth──▶ /api/evidence-portal · shared evidence
```

**Why this shape**

- Passwords live in Supabase Auth; the app never stores plaintext.
- Session tokens sit in **httpOnly** cookies — not in page JavaScript.
- Org data is read with the caller’s JWT so **RLS**, not app code, enforces
  tenancy. Field identity / My jobs use a separate session the sub holds, not
  a seat in the GC’s org.

## Project layout

```
Atmosphere/
├── frontend/                 Office console (React)
│   ├── src/pages/
│   │   ├── JobIntakePage.tsx      Paste → approve → invite
│   │   ├── SharedDashboardPage.tsx  Job files
│   │   ├── VerifierLibraryPage.tsx  Embeds the Verifier
│   │   ├── JobSharePage.tsx       Subcontractor job record
│   │   └── MyJobsPage.tsx         Cross-GC claimed jobs
│   └── src/lib/platforms.ts       Visible: Verification + Field only
├── verifier/                 Evidence portal (static HTML)
│   ├── index.html            Clips, integrity, AI vs human, custody
│   └── twin.html             Property twin / floor sketch (office)
├── fieldcapture/             Crew capture app (static)
│   ├── index.html
│   └── js/capture-core.js    Record, hash, GPS, upload
├── apps/field-ios/           Native Field Capture (Swift)
├── backend/                  Express BFF
│   ├── src/routes/
│   │   ├── jobIntake.ts      Propose / approve package + invites
│   │   ├── sharedJobs.ts     Job files + job-share token API
│   │   ├── proofOfWork.ts    Upload URLs, proof filing, narration
│   │   ├── fieldIdentity.ts  Claim codes + My jobs
│   │   ├── evidencePortal.ts Verifier library + shares
│   │   ├── mediaCatalog.ts   Fleet media catalog
│   │   └── geometry.ts       RoomPlan / twin writes
│   ├── src/verifier/         Intake propose, readiness, invite email copy
│   ├── src/lib/systemMail.ts Atmosphere-sent transactional email
│   ├── src/media/            Catalog + storage drivers
│   ├── src/geometry/         Property twins
│   └── supabase/migrations/  Jobs, proof, field identity, media, twins
├── website/                  Marketing site (Work Verification first)
└── docs/                     Deeper notes (media storage, CRM, etc.)
```

Sales, classic operations, and Manager UIs may still exist in the tree. They are
**not** the product on display — the console only surfaces Verification and
Field (`VISIBLE_PLATFORM_IDS` in `frontend/src/lib/platforms.ts`).

## Quick start

### Prerequisites

- Node 18+
- A Supabase project (Auth + Postgres + Storage)
- Optional: SMTP (`SMTP_*` + from address) so Atmosphere can email invites
- Optional: Anthropic (or configured LLM) keys for Verifier dictation

### Backend

```bash
cd backend
cp .env.example .env   # fill SUPABASE_*, FRONTEND_ORIGINS, SMTP_*, etc.
npm install
npm run dev            # default http://localhost:4000
```

Apply migrations for shared jobs, proof-of-work, field identity, media catalog,
and property twins from `backend/supabase/migrations/` (and mirrored copies under
`supabase/migrations/` where present). Create a Storage bucket for proofs
(typically `job-proofs`) with an appropriate size cap.

### Frontend (office)

```bash
cd frontend
npm install
npm run dev            # Vite; point API via env / proxy to :4000
```

Sign in → onboarding (create or join an org) → **Start a job** or **Job files**.

Demo mode (no backend):

```bash
VITE_DEMO=1 npm run dev
# then navigate to /intake (memory router: atmosphere:navigate or localStorage)
```

### Field Capture (crew)

Serve `fieldcapture/` and open with a live token:

```text
/fieldcapture/index.html?token=<access_token>&api=http://localhost:4000
```

Without `token`, live upload is refused (no invented demo day unless `demo=1`).

### Verifier

Open `/verifier/?embed=1` from the office shell, or serve `verifier/` standalone
against the API.

## Core APIs (verification path)

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/api/operations/intake/propose` | Draft job package + preload Field Capture team |
| `POST` | `/api/operations/intake/approve` | Create job, brief, scope, parties; email invites |
| `GET` | `/api/job-share/:token` | Subcontractor job record (no office login) |
| `POST` | `/api/job-share/:token/proof/upload-url` | Signed Storage PUT URL |
| `POST` | `/api/job-share/:token/proof` | File the day after upload |
| `POST` | `/api/field/claim/start` · `/verify` | OTP → field identity → My jobs |
| `GET` | `/api/field/jobs` | Claimed jobs for a field session |
| `GET` | `/api/evidence-portal/library` | Office clip library |
| `POST` | `/api/evidence-portal/shares` | Share evidence to an email (account-pinned) |

## Data the path depends on

Org-scoped tables (RLS) include, among others:

| Area | Tables (illustrative) |
| --- | --- |
| Jobs | `crm_jobs`, `crm_properties`, `job_intake` |
| Brief / scope | `job_briefs`, `job_scope_items` |
| Parties | `job_parties` (per-job `access_token`) |
| Proof | `job_proofs` (+ Storage objects) |
| Field identity | `field_identities`, `job_party_claims`, `field_sessions` |
| Media / twins | `media_*`, `property_twins`, geometry sessions |
| Evidence shares | Verifier share rows + custody / access log |

CRM sync can bring titles and addresses into job files; **it does not bring
scope**. Scope still comes from intake paste/upload or manual lines before the
Verifier can judge against an agreed brief.

## Auth & tenancy (short)

1. Email/password (and optional device PIN) via Supabase Auth through the BFF.
2. After signup: create an organization or join with a code; pick role / work type.
3. Office routes require an org membership cookie/session.
4. Job-share and field-claim routes are **outside** org auth by design — the
   token or field session is the credential.

## Email

| Kind | Sender |
| --- | --- |
| Job / Field Capture / subcontractor invites | **Atmosphere** (`systemMail` + SMTP) |
| Field claim OTP codes | **Atmosphere** |
| Team join invites | **Atmosphere** |
| Sales campaigns | Customer mailbox (later product; not required for verification) |

Configure `CAREERS_FROM_EMAIL` plus either SMTP (`SMTP_HOST`, `SMTP_USER`,
`SMTP_PASS`) or `RESEND_API_KEY`. Invite emails include HTML + plain text and
absolute app links from `FRONTEND_ORIGIN` (prefer a public `https://` origin).
Without mail configured, invites still mint links; the UI falls back to copy-link.

## Development scripts

```bash
# Backend
cd backend && npm run typecheck && npm test && npm run build

# Frontend
cd frontend && npm test && npm run build

# Migration inventory (two trees — see docs/production.md)
cd backend && npm run check:migrations

# Synthetic A/V → frames → catalog → twin (when configured)
cd backend && npm run smoke:synthetic
```

CI runs backend/frontend **tests**, builds, Agent typecheck, migration SQL
suites, migration inventory, and a backend Docker image build on every push.

## Production

See **[`docs/production.md`](docs/production.md)** for the Work Verification
go-live checklist, required env vars, health probes (`/api/health`,
`/api/ready`), migration apply order, and Docker Compose sketch.

```bash
# Production-shaped local stack (needs a filled backend/.env)
docker compose up --build
```

Contact / careers forms default to `jack@jettx.ai`.

### Business Portal (Atmosphere staff only)

Internal analytics lives in the **Business Portal** at **`/business`**. Tabs cover
board-ready ARR / MoM growth, customers & usage, model performance, and product
intelligence. Every figure is Excel-downloadable. Sign in as `jack@jettx.ai`
(or any email in `ANALYTICS_INTERNAL_EMAILS`) and the portal link appears in
the account menu — the BFF upserts `analytics_staff` when the service role key
is configured. Legacy URLs `/analytics` and `/analytics/investor` redirect here.

A/B experiments: seed/manage rows in `public.experiments`, set `status` to
`running`, instrument with `useExperiment()` in the UI. Results appear on the
Business Portal **Product** tab under **A/B tests**.

## Related docs

| Doc | Topic |
| --- | --- |
| [`docs/production.md`](docs/production.md) | Production deploy + go-live checklist |
| [`docs/stripe.md`](docs/stripe.md) | Stripe Checkout, webhooks, `npm run stripe:sync` |
| [`fieldcapture/README.md`](fieldcapture/README.md) | Live capture + token query params |
| [`verifier/README.md`](verifier/README.md) | Evidence portal rules and access model |
| [`apps/field-ios/README.md`](apps/field-ios/README.md) | Native Field Capture / RoomPlan status |
| [`docs/media-storage.md`](docs/media-storage.md) | Fleet media catalog and retention |
| [`docs/synthetic-pipeline.md`](docs/synthetic-pipeline.md) | Synthetic A/V smoke path |
| [`docs/CRM.md`](docs/CRM.md) | CRM mirror (supports job files; not the product) |
| [`website/`](website/) | Public Work Verification site |

## What this repo is not selling

Atmosphere is **not** positioned as a sales platform, project-management suite,
or general operations OS. Those modules may remain in code for a later return;
the shipped story is work verification: **film the day, check it against the
scope, keep the chain of custody.**
