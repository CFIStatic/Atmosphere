# Production runbook — Work Verification

Atmosphere’s sold path is **intake → invite → Field Capture → Verifier →
evidence share**. This document is the checklist to run that path safely.
Sales, PM, estimator, and computer-use modules may stay in the tree; keep them
off or mocked until they are staffed and monitored.

## Railway auto-deploy

The backend on Railway is **not** driven by “any git branch”. Two different
mechanisms exist; using both on `main` double-deploys production.

### What happens today

`.github/workflows/deploy-production.yml` is the production path:

1. Push (or merge) to **`main`** that touches `backend/**` (or the workflow file).
2. GitHub Actions reads the `Keys` environment, copies those values onto the
   Railway service, then runs `railway up`.
3. Feature branches and PRs **do not** deploy. Pointing this workflow at every
   branch would overwrite production.

Manual fallback: **Actions → Deploy Work Verification → Run workflow**.

### Branch / PR previews (the missing piece)

Railway will spin up an isolated copy of the stack for each pull request if
**PR Environments** are on. That is how a branch update gets a live URL without
touching production.

1. In Railway, open the project → **Settings → Environments**.
2. Enable **PR Environments**.
3. For this monorepo, also enable **Focused PR Environments** so a frontend-only
   PR does not rebuild the BFF. Watch paths already live in `railway.toml`
   (`backend/**` plus the root Dockerfile).
4. Confirm the GitHub repo is linked on the backend service
   (**Settings → Source**) and that Autodeploy is **Enable**d for PRs.
5. Open a PR from a workspace member whose GitHub account is connected to
   Railway. The Railway GitHub bot comments with the preview URL. Closing or
   merging the PR deletes the environment.

Railway will **not** deploy a PR from someone outside the workspace unless they
are invited with that GitHub account connected.

Optional: **Enable Bot PR Environments** if Dependabot (or similar) PRs should
get previews too. Leave it off to avoid paying for bot stacks.

### Production on every `main` update (GitHub Autodeploy)

If you want Railway itself to deploy `main` instead of (or in addition to)
`railway up` from Actions:

1. Backend service → **Settings → Source**.
2. Connect this GitHub repository. Set the trigger branch to **`main`**.
3. Set **Root Directory** to `/` (root `Dockerfile` builds `backend/`) **or**
   to `backend` and point **Config as Code** at `/backend/railway.toml`.
4. Click **Enable** on Autodeploy.
5. Turn on **Wait for CI** so a red `.github/workflows/ci.yml` run skips the
   deploy. CI already runs on every branch, including `main`.
6. **Pick one producer for production deploys.** Either:
   - keep the Actions `railway up` (it is what syncs GitHub `Keys`) and
     **Disable** Autodeploy on the service, or
   - enable Autodeploy + Wait for CI and remove the `railway up` step from
     `deploy-production.yml`, leaving the workflow as Keys → Railway variables
     only (`--skip-deploys` is already used during the sync).

Healthcheck is already `/api/ready` in `railway.toml`. Railway holds the old
deployment until that returns 200, then cuts over.

### If a push did not deploy

- **Wrong branch.** Only `main` is production. Other branches need a PR + PR
  Environments (or a manual Actions run, which still deploys **production**).
- **Path filter.** Actions skips `main` pushes that did not touch `backend/**`.
  GitHub Autodeploy skips commits that miss `watchPatterns` in `railway.toml`.
- **GitHub App.** At least one Railway project member needs a connected GitHub
  account with contributor access. Re-accept pending Railway GitHub App
  permissions if Autodeploy is greyed out.
- **Skipped deployments.** In the service’s Deployments tab, show skipped
  deploys. “Wait for CI” skips when CI fails.

Official references: [GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys),
[PR Environments](https://docs.railway.com/guides/preview-deployments-with-pr-environments).

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
