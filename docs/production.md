# Production runbook — Work Verification

Atmosphere’s sold path is **intake → invite → Field Capture → Verifier →
evidence share**. This document is the checklist to run that path safely.
Sales, PM, estimator, and computer-use modules may stay in the tree; keep them
off or mocked until they are staffed and monitored.

## Railway auto-deploy

Do this once in the Railway dashboard. GitHub Actions currently deploys **only
the backend**, and only on `main`. Every other Railway service stays stale
until it is linked to this repo with Autodeploy on.

Databases, Redis, and volumes are not git apps — skip them. The marketing site
is GitHub Pages (`website/`), not Railway. iOS is App Store.

| Railway service | Config as Code | Dockerfile | Rebuilds when these paths change |
| --- | --- | --- | --- |
| Backend BFF | `/railway.toml` | `Dockerfile` (repo root) | `backend/**`, `Dockerfile`, `railway.toml` |
| Office console | `/frontend/railway.toml` | `Dockerfile.frontend` | `frontend/**`, `verifier/**`, `fieldcapture/**`, `Dockerfile.frontend` |

Both services use **Root Directory `/`**. The console must not use `/frontend`
as root — Vite copies sibling `verifier/` and `fieldcapture/` into the build.

### Step 0 — GitHub App (once)

1. Railway dashboard → your account → **GitHub**.
2. Install / authorize the Railway GitHub App on **CFIStatic/Atmosphere**.
3. If Autodeploy is greyed out later, GitHub → **Settings → Applications →
   Railway** → accept pending permission updates, wait a few minutes, then
   disconnect and reconnect the repo on the service.

At least one Railway project member must have that GitHub account connected
and **contributor** access to the repo.

### Step 1 — Repeat for every git-backed service

Open the project canvas. For **backend**, then again for **frontend**, then
again for any other service that builds from this repo:

1. Click the service → **Settings**.
2. **Source** → connect **CFIStatic/Atmosphere** (same repo for all of them).
3. **Trigger branch** = `main`.
4. **Root Directory** = `/`.
5. **Config as Code** = the path in the table above (required on the console so
   it does not pick up the backend `railway.toml` at the repo root).
6. **Autodeploy** → **Enable**.
7. **Wait for CI** → on. Railway holds the deploy until
   `.github/workflows/ci.yml` is green on that commit. If CI is red, the
   deploy is skipped and the previous version keeps serving.
8. **Networking** → **Generate Domain** if the service should be public.
9. Click **Deploy** (or wait for the next push to `main`).

#### Backend variables

Leave these on the backend service (Actions can still sync them from GitHub
`Keys` — see Step 3). Required set is in [Required environment (BFF)](#required-environment-bff).

Healthcheck is `/api/ready` via `railway.toml`.

#### Frontend variables

These are Docker **build args**. Set them on the frontend service **before**
the first Autodeploy, then redeploy after changing them (a variable-only
change does not always rebuild the Vite bundle).

```text
VITE_API_BASE_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}
```

Use your real backend public URL or custom domain instead of the reference
if you already have one (for example `https://api.atmosphereteam.com`).
`FRONTEND_ORIGIN` on the backend must include the frontend’s public origin
or cookies/CORS fail.

Healthcheck is `/`. nginx listens on Railway’s `PORT`.

#### Any extra service you added later

Same loop: Source = this repo, branch `main`, Root `/` or the folder that
owns the app, Config as Code pointing at **that** service’s `railway.toml`,
Autodeploy Enable, Wait for CI on, watch paths so a backend-only commit does
not rebuild it.

### Step 2 — PR / branch previews (once per project)

This is how a **feature branch** gets a live URL without touching production.

1. Project → **Settings → Environments**.
2. Enable **PR Environments**.
3. Enable **Focused PR Environments** (monorepo: only services whose watch
   paths changed are copied).
4. Leave **Bot PR Environments** off unless you want Dependabot stacks.
5. Open a PR from a workspace member whose GitHub is connected to Railway.
   The Railway bot comments when the preview URL is ready. Merging or closing
   the PR deletes that environment.

Railway will not deploy a PR from someone outside the workspace unless they
are invited with that GitHub account connected.

### Step 3 — Stop double-deploying production

`.github/workflows/deploy-production.yml` still runs `railway up` for the
**backend** on every `main` push that touches `backend/**`. If Step 1 enabled
Autodeploy on the backend, you get two production deploys per push.

Pick one:

- **Recommended for multiple services:** Autodeploy + Wait for CI on every
  git-backed service. Keep the Actions job only to copy GitHub `Keys` onto
  the backend (`--skip-deploys` is already used during the sync) and delete
  or skip the final `railway up` step.
- **Actions remains the backend ship path:** Disable Autodeploy on the
  backend only. Frontend and any other services still use Autodeploy.

Do **not** point the Actions workflow at every branch. That `railway up`
always deploys production.

Manual backend fallback: **Actions → Deploy Work Verification → Run workflow**.

### Step 4 — Prove it

1. Merge a no-op or real change to `backend/` on `main` → backend service
   **Deployments** shows a new deploy (or a skip if CI failed). Frontend
   should **not** rebuild (watch paths).
2. Merge a change under `frontend/`, `verifier/`, or `fieldcapture/` →
   frontend rebuilds; backend does not.
3. Open a PR that touches `backend/` → a PR environment appears with the
   backend (and skipped frontend if Focused is on).

### If a push did not deploy

- **Wrong branch.** Production is `main` only. Other branches need a PR
  (Step 2).
- **Watch paths.** Autodeploy skips commits that miss that service’s
  `watchPatterns`. In Deployments, turn on **Show skipped**.
- **Wait for CI.** A failing GitHub Actions run skips the Railway deploy.
- **GitHub App.** Re-accept permissions; reconnect the repo on the service.
- **Config as Code.** Frontend still using `/railway.toml` will try to start
  `node dist/index.js` and healthcheck `/api/ready`. Point it at
  `/frontend/railway.toml`.

Official references: [GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys),
[PR Environments](https://docs.railway.com/guides/preview-deployments-with-pr-environments),
[Monorepos](https://docs.railway.com/deployments/monorepo).

## Surfaces to deploy

| Surface | Artifact | Notes |
| --- | --- | --- |
| Backend BFF | `backend/` (`Dockerfile` or `npm run build && npm start`) | Node 22, long-lived process; needs FFmpeg for proof sparse frames |
| Office console | `frontend/` static build | Point `VITE_API_BASE_URL` at the BFF |
| Field Capture | `fieldcapture/` static | Served under the same origin as the console or with `?api=` |
| Verifier | `verifier/` static | Embedded by the frontend build; also standalone |
| Marketing site | `website/` | Already CD’d to GitHub Pages |
| Native Field | `apps/field-ios/` | App Store path; uses the same BFF |

Compose sketch: `docker compose up --build` (see root `docker-compose.yml`).

## Supabase

1. Dedicated **production** project (never the shared demo URL from `.env.example`).
2. Apply migrations — see [Migration apply order](#migration-apply-order).
3. Auth → URL configuration: add the production frontend origin and password-reset redirect.
4. Storage: ensure `job-proofs` exists (migration
   `20260815180000_job_proofs_storage_bucket.sql`) with an appropriate size cap.
5. Store `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` only
   on the BFF. The browser never receives the service role.

## Required environment (BFF)

Fail-loud at boot when `NODE_ENV=production` (see `backend/src/lib/productionGuards.ts`):

| Variable | Why |
| --- | --- |
| `NODE_ENV=production` | Enables guards, secure cookies, strips error detail |
| `FRONTEND_ORIGIN` | CORS allowlist (comma-separated) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Auth + RLS-backed reads |
| `SUPABASE_SERVICE_ROLE_KEY` | PIN unlock, signed uploads, media catalog, schedulers |
| `DEVICE_PEPPER` | PIN hashing (never store in the DB) |
| `CONTACT_TO_EMAIL` / `CAREERS_TO_EMAIL` | Public site forms — defaults to `jack@jettx.ai` |
| `SMTP_*` or `RESEND_API_KEY` + `CAREERS_FROM_EMAIL` | Atmosphere-sent invites and field OTPs |
| `MEDIA_BACKEND=supabase` | Do not use `memory` or the `s3` stub in prod |

Strongly recommended:

- `ANTHROPIC_API_KEY` and/or `GOOGLE_API_KEY` for Verifier dictation
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_ONBOARDING_PRICE_ID`) — see [`docs/stripe.md`](./stripe.md)
- `COOKIE_SECURE=true` (default when `NODE_ENV=production`)
- `BACKUP_ENCRYPTION_KEY` if `BACKUP_ENABLED` is on
- `LOG_LEVEL=info` (structured JSON logs)

Escape hatches (explicit only):

- `ALLOW_MOCK_DRIVERS=true` — silences warnings for mock Xactimate / CRM / email marketing
- `ALLOW_S3_STUB=true` — permits `MEDIA_BACKEND=s3` stub (integration tests only)

Full catalogue: `backend/.env.example`.

## Migration apply order

The two directories are a **byte-identical mirror** (CI enforces this):

- `backend/supabase/migrations/`
- `supabase/migrations/`

Apply **one** of them, once, in filename order. Never apply both.

```bash
npm run check:migrations --prefix backend
```

`db/*.sql` are reference/installers — prefer the timestamped migrations.

### Internal analytics access

`/analytics` is gated by `public.analytics_staff`. Atmosphere staff emails in
`ANALYTICS_INTERNAL_EMAILS` (default: `jack@jettx.ai`) are **auto-granted** on
the next `/api/analytics/access` probe when `SUPABASE_SERVICE_ROLE_KEY` is set —
no SQL step in preview.

Optional manual grant for others:

```bash
cd backend && npm run analytics:grant -- someone@company.com internal
```

A/B experiments live in `public.experiments` (see migration
`20260816090000_product_experiments_and_verification_catalog.sql`). Flip
`status` to `running` to start assigning variants; results appear on
`/analytics` under **A/B tests**.

## Health checks

| Probe | Path | Use |
| --- | --- | --- |
| Liveness | `GET /api/health` | Process up (no deps) |
| Readiness | `GET /api/ready` | Supabase Auth reachable; admin/storage reported |

Point the load balancer readiness check at `/api/ready`. Prefer draining on
`SIGTERM` (schedulers and the HTTP server shut down cleanly).

## Observability

- Access logs and errors are **JSON lines** (`requestId`, `path`, `status`,
  `durationMs`). Forward stdout to your aggregator.
- Honor inbound `x-request-id` or accept the generated one on the response.
- Product telemetry (`/api/telemetry`) is not a substitute for error tracking —
  wire Sentry/OTel when you have a sink.

## CI expectations

`.github/workflows/ci.yml` runs:

- Backend typecheck, **tests**, build
- Frontend **tests**, build
- Agent typecheck
- Migration SQL suites + migration inventory script

Lint is still noisy across the monorepo; `npm run verify` remains the local bar.

## Go-live smoke (manual)

1. `GET /api/ready` → `status: "ready"`.
2. Sign up / sign in on the office console → create or join an org.
3. **Start a job** → approve package → send a Field Capture invite.
4. Open the invite on a phone → accept brief → record a short clip → upload.
5. Open **Verifier library** → clip appears; run dictation if keys configured.
6. Create an evidence share → open as the pinned account.
7. Confirm custody / access log entries for the share.

## What this runbook deliberately does not cover yet

- Merging the two migration trees into one (tracked as follow-up; inventory
  script prevents silent drift).
- Durable workers for proof/verification queues (still in-process `RetryQueue`).
- Real S3 multipart driver (stub only).
- Counsel-reviewed privacy/terms copy on the marketing site.
