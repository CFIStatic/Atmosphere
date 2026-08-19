# Production runbook — Work Verification

Atmosphere’s sold path is **intake → invite → Field Capture → Verifier →
evidence share**. This document is the checklist to run that path safely.
Sales, PM, estimator, and computer-use modules may stay in the tree; keep them
off or mocked until they are staffed and monitored.

## Surfaces to deploy

| Surface | Artifact | Notes |
| --- | --- | --- |
| Backend BFF | `backend/` (`Dockerfile` or `npm run build && npm start`) | Node 22, long-lived process; needs FFmpeg for proof sparse frames. **Railway service `Atmosphere` (override with `RAILWAY_SERVICE`).** |
| Office app | `frontend/` + `verifier/` + `fieldcapture/` | One nginx image; `/api` proxied to the BFF. **Railway service `app`.** |
| Marketing site | `website/` | Already CD’d to GitHub Pages |
| Native Field | `apps/field-ios/` | App Store path; uses the same BFF |

Compose sketch: `docker compose up --build` (see root `docker-compose.yml`). Same shape as Railway: browser hits `:8080`, nginx proxies `/api` to the BFF.

## Host the office app on Railway

The marketing site stays on GitHub Pages. The **product** (office console, Verifier, Field Capture) is a second Railway service next to the BFF, same project.

Same-origin `/api` is the point: session cookies stay `SameSite=Lax`, Field Capture does not need `?api=`, and `VITE_API_BASE_URL` stays empty.

### 1. Empty service in the existing project

In the Railway project that already runs the BFF (`Atmosphere`):

1. **+ Create** → **Empty service**. Name it `app` (or set GitHub secret `RAILWAY_APP_SERVICE` to whatever you named it).
2. Settings → **Config File**: `/frontend/railway.toml`  
   Without this, deploys from the repo root apply `/railway.toml` and build the **backend** image into the app service.
3. Settings → **Root Directory**: `/` (repo root). The Dockerfile copies `verifier/` and `fieldcapture/` as siblings of `frontend/`.
4. Variables:

   | Variable | Value |
   | --- | --- |
   | `API_UPSTREAM` | `http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}}` |

   Replace `Atmosphere` with the BFF service name if you overrode `RAILWAY_SERVICE`.

### 2. Public origin

On the **app** service: Settings → Networking → **Generate domain**, then attach `app.atmosphereteam.com` (or your real app host).

On the **backend** service, `FRONTEND_ORIGIN` must include that https origin (comma-separated if you also keep the `*.up.railway.app` URL):

```text
FRONTEND_ORIGIN=https://app.atmosphereteam.com,https://${{app.RAILWAY_PUBLIC_DOMAIN}}
```

The deploy workflow already defaults `FRONTEND_ORIGIN` to `https://app.atmosphereteam.com` from GitHub Keys. Add the Railway domain in the dashboard if you sign in before the custom domain is live.

### 3. Ship it

`.github/workflows/deploy-production.yml` deploys **both** services (`railway up --service backend` and `--service app`). Needs `RAILWAY_TOKEN` in the `Keys` environment. Optional: `RAILWAY_APP_SERVICE` if the app service is not named `app`.

```bash
# Or from a laptop, after `railway link` (repo root, not frontend/):
railway up --service app
```

Health probe: `GET https://<app-host>/healthz` → `ok`. The SPA is `/`; Field Capture is `/fieldcapture/`; Verifier is `/verifier/`.

### 4. Point the rest of the product at that origin

| Where | What |
| --- | --- |
| GitHub Actions variable `WEBSITE_APP_ORIGIN` | `https://app.atmosphereteam.com` — marketing Sign in / Get started CTAs (see `website/README.md`) |
| GitHub Actions variable `WEBSITE_API_ORIGIN` | Backend’s public https origin — careers/contact forms on Pages |
| GitHub Actions variable `FRONTEND_ORIGIN` | Same as backend `FRONTEND_ORIGIN` (synced onto Railway by the deploy job) |
| Supabase → Auth → URL configuration | Add the app origin; password-reset redirect `{origin}/reset-password` |
| Stripe webhooks | Still `POST https://<backend-public-host>/api/webhooks/stripe` (not the app host) |

Invite emails use the first origin in `FRONTEND_ORIGIN`, so put the public `https://` app URL first.

Local stand-in for this topology:

```bash
docker compose up --build
# app:  http://localhost:8080
# api:  http://localhost:4000  (also reachable as http://localhost:8080/api/…)
```

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
| `SMTP_*` or `RESEND_API_KEY` + `CAREERS_FROM_EMAIL` | Atmosphere-sent invites and field OTPs. Resend From is `hello@invites.jettx.ai` (verified subdomain). Reply-To stays `jack@jettx.ai`. |
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
| App | `GET /healthz` | nginx on the office-app service is serving |

Point the **platform deploy probe** (Railway) at `/api/health` so a brief
Supabase blip cannot roll back a good process. Point a load-balancer
readiness check at `/api/ready` for the BFF and `/healthz` for the office app
when you want to drain traffic that cannot reach Auth. Prefer draining on
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
