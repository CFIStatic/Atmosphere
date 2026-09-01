# Production runbook — Work Verification

Atmosphere’s sold path is **intake → invite → Field Capture → Verifier →
evidence share**. This document is the checklist to run that path safely.
Sales, PM, estimator, and computer-use modules may stay in the tree; keep them
off or mocked until they are staffed and monitored.

## Railway auto-deploy

Do this once in the Railway dashboard. GitHub Actions deploys the backend
(`Atmosphere`) and the office app (`Atmosphere-web`) on `main`. GitHub
Autodeploy is the fallback if Actions is skipped; without either, a service
stays on its last successful image.

Databases, Redis, and volumes are not git apps — skip them. iOS is App Store.
The marketing site (`website/`) deploys to the Railway nginx service `website`
from its own workflow (GitHub Pages is an optional second host — see
`.github/workflows/deploy-website.yml`).

| Railway service | Config as Code | Dockerfile | Rebuilds when these paths change |
| --- | --- | --- | --- |
| Backend BFF | `/backend/railway.toml` | `Dockerfile` (repo root) | `backend/**`, `Dockerfile`, `railway.toml` |
| Office console | `/frontend/railway.toml` | `frontend/Dockerfile` | `frontend/**`, `verifier/**`, `fieldcapture/**`, `frontend/Dockerfile` |
| Corporate site (`website`) | `/website/railway.toml` | `website/Dockerfile` | `website/**`, `.dockerignore`, `.github/workflows/deploy-website.yml` |
| Internal staff site | `/internal/railway.json` | `internal/Dockerfile` | `internal/**`, `internal/Dockerfile` |

**The repo-root `/railway.toml` is not in that table on purpose.** It is an
inert fallback: `builder` only, no `dockerfilePath`, no `startCommand`, no
probe, and a watch path (`.railway-root-config-is-inert`) that cannot match.
Every service whose Config File is unset resolves that file, and it used to be
the backend's — which is how Corporate Website came to build the BFF image
from a `backend/`-only merge. Now such a service **skips** the autodeploy
instead of shipping the wrong image, and a manual Redeploy (which ignores
watch paths) builds from that service's own `RAILWAY_DOCKERFILE_PATH`. Each
Actions job copies its surface's config over the root file before
`railway up`, so the CLI path is unchanged. Keep it inert; put per-service
config in that service's own file.

All git-backed services use **Root Directory `/`**. The console must not use
`/frontend` as root — Vite copies sibling `verifier/` and `fieldcapture/`
into the build — and `website/Dockerfile` also copies from the repo root.

> **Heads-up:** Railway has deprecated config-as-code files. Existing
> (legacy) services keep reading their `railway.toml` until the hard cutoff
> on **2026-12-01**; new services cannot opt in at all. Before the cutoff,
> mirror each service's settings above (start command, healthcheck path,
> watch paths, Dockerfile path) into its dashboard Settings, or migrate to
> Railway's Infrastructure as Code (`.railway/railway.ts`). See
> https://docs.railway.com/infrastructure-as-code.

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

Healthcheck is `/api/health` via `railway.toml`.

#### Frontend variables

The office image reverse-proxies `/api` at runtime. Set this on the office
service **before** the first Autodeploy:

```text
API_UPSTREAM=http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}
```

Leave `VITE_API_BASE_URL` empty so the SPA uses same-origin `/api` and
httpOnly cookies just work. `FRONTEND_ORIGIN` on the backend must include
the office app’s public origin or cookies/CORS fail.

Healthcheck is `/healthz`. nginx listens on Railway’s `PORT`.

#### Corporate website variables

The marketing image is nginx, not Node. Settings → **Config File** =
`/website/railway.toml` so Autodeploy does not inherit `node dist/index.js`
and `/api/health` from the repo-root file. Healthcheck is `GET /health`
(also answered at `/api/health` so a leftover API probe still passes).

#### `API_UPSTREAM` on every front door

The office console and the marketing site are nginx front doors onto the
same BFF. They take the **same** private-mesh upstream from one file at the
repo root:

```bash
cat api.upstream
# http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}
```

Plain `http://`, private domain, no public host. Set to
`https://atmosphere-production.up.railway.app` instead, a `/api` request
leaves the private network and comes back in through the edge (jfk1 → ams1),
which 502s for a few seconds. What that looks like from the outside is a front
door reporting the Atmosphere API as unreachable while the BFF is perfectly
healthy — the office console spinning on `/login`, the site’s careers and
contact forms failing to post.

**The service name in that reference must match the Railway canvas exactly.**
Railway resolves a reference to a service that is not there as an *empty
string* rather than failing, so the container receives `API_UPSTREAM=http://:`.
The BFF is `Atmosphere APIs`; `${{Atmosphere.…}}` matched nothing, and on
2026-08-22 the office app came up with

```text
[emerg] invalid port in upstream ":" in /etc/nginx/conf.d/default.conf:27
```

crash-looping until the deploy failed its healthcheck — the login page and
dashboard down over a variable only `/api` needs. Two things stop that from
recurring, and neither replaces setting the variable correctly:

- Each nginx image normalises the value before nginx sees it
  (`frontend/nginx/15-validate-app-env.envsh` and its siblings): an empty,
  unresolved or host-less upstream falls back to something nginx accepts, and
  the replica serves its static pages with `/api` answering
  `503 backend_unreachable` until the variable is fixed. These are `.envsh`
  because the nginx entrypoint *sources* those and *executes* `.sh` in a child
  process, where an exported value would never reach `envsubst`.
- The office and marketing images proxy through a variable
  (`set $api_upstream …; proxy_pass $api_upstream$request_uri;`) with a
  `resolver`, so the BFF is resolved per request. A literal `proxy_pass` host
  is resolved once at startup and nginx refuses to start when it is not in DNS
  yet — a redeploying BFF would otherwise take the console with it.

The office deploy job also prefers the BFF's *resolved* private domain
(`scripts/resolveApiUpstream.mjs`) over the reference, because a literal that
was read back from the BFF's own variables cannot come out empty.

The staff site (`internal/`, Railway service `Internal Growth Metrics`) is
the exception: its nginx 504s on the private mesh, so the deploy job points
it at the public BFF host.

The deploy workflows keep these in sync, so a fix here does not need a
dashboard visit:

| Service | Set by |
| --- | --- |
| `Atmosphere-web` | `deploy-production.yml` → office app job (`api.upstream`) |
| `website` | `deploy-website.yml` (override with the `API_UPSTREAM` Actions variable only if the site ever moves out of this project) |
| `Internal Growth Metrics` | `deploy-production.yml` → internal site job (public BFF; name it with `RAILWAY_INTERNAL_SERVICE`) |

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
- **Wrong office service name.** The live office service is `Atmosphere-web`,
  not `app`. Deploy Work Verification logs `Service not found` when the job
  targets a name that is not on the canvas.
- **Watch paths.** Autodeploy skips commits that miss that service’s
  `watchPatterns`. In Deployments, turn on **Show skipped**.
- **Wait for CI.** A failing GitHub Actions run skips the Railway deploy.
- **GitHub App.** Re-accept permissions; reconnect the repo on the service.
- **Config as Code.** Frontend still using `/railway.toml` will try to start
  `node dist/index.js` and healthcheck `/api/health`. Point it at
  `/frontend/railway.toml`. The corporate site must use `/website/railway.toml`
  for the same reason. The internal site is the same trap: Config File
  must be `/internal/railway.json`. A ~5 minute Network healthcheck is the
  backend 300s `/api/health` probe, not nginx. The deploy job also applies
  that json onto the service with `internal/scripts/apply-railway-config.sh`.

### Get the corporate website working

The marketing site is already hosted. Three different hostnames are in play
and only one of them is live:

| URL | What you get today |
| --- | --- |
| `https://website-production-7e3f.up.railway.app` | **Live** Corporate Website (`website/`) |
| `https://atmosphere-website-production.up.railway.app` | Railway `Application not found` — that hostname was never generated |
| `https://atmosphereteam.com` / `www` | Squarespace **Coming Soon** parking page (DNS still on Squarespace) |

Until DNS moves, share the Railway URL. To put `atmosphereteam.com` on this
site:

1. Railway → **Corporate Website** → Settings → Networking → **Custom Domain**
   → add `atmosphereteam.com` and `www.atmosphereteam.com`. Railway prints
   the CNAME / ALIAS records it wants.
2. Squarespace → Domains → DNS → remove the parking A records
   (`198.185.159.*`, `198.49.23.*`) and the `ext-sq.squarespace.com` CNAME.
   Put Railway's records in their place. Apex domains need an ALIAS/ANAME
   (or Railway's nameservers); `www` is a CNAME onto the Railway hostname.
3. Wait for TLS to go **Active** on the Railway domain row. Then set
   `SITE_ORIGIN` on the website service (and in `website/Dockerfile` if you
   want it baked into sitemap/robots) to `https://atmosphereteam.com`.

GitHub Pages is optional and **not configured** on this repo. The Railway
service is the production host.

### If the website service fails its healthcheck on every main push

Symptom: the `website` (Corporate Website) service shows **Deployment failed
during network process → Healthcheck failure** after ~5 minutes, on commits
that never touched `website/`, and the deployment says **via GitHub**.

Cause: the service's Config File was never set, so GitHub autodeploys resolve
the repo-root `/railway.toml` (the backend's). The nginx image then deployed
with the backend's settings and never answered the probe. The CLI deploys from
`deploy-website.yml` worked because that job copies `website/railway.toml`
over the upload root — which masked the missing setting.

A second, later failure mode: `railwayUp.sh` treated Railway's in-window
`Attempt #N failed with service unavailable. Continuing to retry` lines as a
finished failure, aborted, then retried and hit `no changes detected in
watch paths` and marked the job green. The replica never took the new image.
The script now ignores those retry lines, website deploys stamp
`website/.railway-up-stamp` so a retry rebuilds, and `website-start.sh`
boots through the nginx image entrypoint (same as the staff site).

Fix, once, on the `website` service:

1. Settings → **Config-as-code** → Config File = `/website/railway.toml`.
   That brings its nginx start command, `GET /health` probe, and the
   `website/**` watch paths onto GitHub autodeploys too.
2. Or, if GitHub autodeploy on this service is unwanted (Actions already
   ships it via CLI on website changes), Settings → **Disable Autodeploy**.

The repo also no longer sets a `startCommand` in the root `railway.toml`
(the backend Dockerfile's CMD is the same command), so even a service still
inheriting the root config boots its own image instead of crash-looping.

### The same fault, wearing a pre-deploy failure

Symptom: Corporate Website shows **Deployment failed during the deploy
process → Deploy › Pre deploy command**, failing in about four seconds, on a
commit that only touched `backend/`. Initialization and Build both pass, so
it reads like a broken command rather than a misrouted service.

Read the **build log**, not the deploy log. If it says

```
modified file: backend/src/routes/evidencePortal.ts
build  COPY backend/src ./src
build  RUN npm run build     > tsc -p tsconfig.json
runtime RUN apt-get install ... ffmpeg ...
```

then the marketing site just built the Work Verification BFF, and this is the
Config File fault above — same cause, later stage. The root `/railway.toml`
watches `backend/**`, so a backend commit triggers the build; it also sets
`build.dockerfilePath = Dockerfile`, so the image is the backend's. The
service's own pre-deploy command is an nginx path that does not exist in a
`node:22-bookworm-slim` image, so it exits non-zero immediately.

Two things follow from that:

- **The pre-deploy command is not the bug.** Clearing it only moves the
  failure to the healthcheck, because the wrong image would still deploy.
  Fix the Config File; the pre-deploy command is collateral.
- **Stamped settings cannot save you here.** `railway environment edit
  --service-config` writes `build.dockerfilePath`, `deploy.startCommand` and
  the probe onto the service, and config-as-code outranks every one of them.
  `RAILWAY_DOCKERFILE_PATH` loses the same way.

`backend/scripts/applyRailwayConfigFile.mjs` sets the Config File path itself
(the one setting the CLI cannot reach), and both
`website/scripts/apply-railway-config.sh` and
`internal/scripts/apply-railway-config.sh` call it. `deploy-production.yml`
runs the website one on every production push — including the backend-only
pushes that trip this, which `deploy-website.yml` never sees. All of it warns
rather than fails: a config repair must never be what breaks a ship. If the
warning shows up in the log, set the field by hand.

Nothing in this repo wants a Railway pre-deploy command at all. The BFF's
real pre-deploy work — Keys sync, the Resend sending domain, the Supabase
`memory_events` repair — runs as GitHub Actions steps before `railway up`.

### If Field Capture fails GitHub Autodeploy

Symptom: the GitHub commit status **Atmosphere - Field Capture** is
**Deployment failed** about 15 seconds after a `main` push, while GitHub
Actions CI and Deploy Work Verification are green. Production
`/fieldcapture/` on the office app still serves the capture app.

Cause: a leftover Railway canvas service named **Field Capture** still has
GitHub Autodeploy. Crew capture already ships inside **Login & Dashboard**
(`frontend/Dockerfile` copies `fieldcapture/`). Until #157 (hold-5s) no
recent `main` commit touched `fieldcapture/**`, so that service skipped
("No deployment needed"). The first matching commit tried to build a static
folder with no image of its own and failed; Railway then retried the failed
deploy on every later `main` push — including office-rail-only merges.

That service is now the live Field Capture web host
(`https://field-capture-production.up.railway.app/`). It must proxy `/api`
to the Atmosphere BFF. A static-only nginx answers `POST /api/field-app/join`
with 405 HTML, which the connect screen shows as **Request failed.**

Fix:

1. Settings → **Config-as-code** → Config File = `/fieldcapture/railway.toml`
   and Root Directory = `/`. `.github/workflows/repair-field-capture-config.yml`
   stamps this and `railway up`s the nginx image.
2. Optional: set `API_UPSTREAM` to the Atmosphere APIs private HTTP URL
   (`api.upstream`). Unset or broken values fall back to the public BFF so
   the connect screen still works.
3. Backend CORS already allows `https://field-capture*.up.railway.app`.
4. Office fallback stays
   `https://atmosphere-web-production.up.railway.app/fieldcapture/`.

Official references: [GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys),
[PR Environments](https://docs.railway.com/guides/preview-deployments-with-pr-environments),
[Monorepos](https://docs.railway.com/deployments/monorepo).

## Surfaces to deploy

| Surface | Artifact | Notes |
| --- | --- | --- |
| Backend BFF | `backend/` (`Dockerfile` or `npm run build && npm start`) | Node 22, long-lived process; needs FFmpeg for proof sparse frames. **Railway service `Atmosphere APIs` (override with `RAILWAY_SERVICE`).** |
| Office app | `frontend/` + `verifier/` + `fieldcapture/` | One nginx image; `/api` proxied to the BFF. **Railway service `Atmosphere-web` (override with `RAILWAY_APP_SERVICE`).** |
| Marketing site | `website/` | nginx image on Railway service **Corporate Website**; live URL `https://website-production-7e3f.up.railway.app`; GitHub Pages optional (`deploy-website.yml`); nginx proxies `/api` for the careers and contact forms |
| Internal staff site | `internal/` | Accounts, analytics, system health. **Railway service `Internal Growth Metrics` (override with `RAILWAY_INTERNAL_SERVICE`).** Staff-only; `noindex`. |
| Native Field | `apps/field-ios/` | App Store path; uses the same BFF |

Compose sketch: `docker compose up --build` (see root `docker-compose.yml`). Same shape as Railway: browser hits `:8080`, nginx proxies `/api` to the BFF.

## Host the office app on Railway

The marketing site ships separately to the Railway `website` service (see `.github/workflows/deploy-website.yml`). The **product** (office console, Verifier, Field Capture) is a second Railway service next to the BFF, same project.

Same-origin `/api` is the point: session cookies stay `SameSite=Lax`, Field Capture does not need `?api=`, and `VITE_API_BASE_URL` stays empty.

### 1. Empty service in the existing project

In the Railway project that already runs the BFF (`Atmosphere`):

1. **+ Create** → **Empty service**. Name it `Atmosphere-web` (or set GitHub secret `RAILWAY_APP_SERVICE` / `RAILWAY_WEB_SERVICE` to whatever you named it). There is no service named `app` in this project — targeting `app` makes GitHub Actions fail with `Service not found` and the office URL stays on the last successful image.
2. Settings → **Config File**: `/frontend/railway.toml`  
   Without this, deploys from the repo root apply `/railway.toml` and build the **backend** image into the app service.
3. Settings → **Root Directory**: `/` (repo root). The Dockerfile copies `verifier/` and `fieldcapture/` as siblings of `frontend/`.
4. Variables:

   | Variable | Value |
   | --- | --- |
   | `API_UPSTREAM` | `http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}` |

   Replace `Atmosphere` with the BFF service name if you overrode
   `RAILWAY_SERVICE`. Same value on every front door — see
   [`API_UPSTREAM` on every front door](#api_upstream-on-every-front-door).

### 2. Public origin

On the **Atmosphere-web** service: Settings → Networking → **Generate domain**, then attach `platform.atmosphereteam.com` (or your real app host).

On the **backend** service, `FRONTEND_ORIGIN` must include that https origin (comma-separated if you also keep the `*.up.railway.app` URL):

```text
FRONTEND_ORIGIN=https://platform.atmosphereteam.com,https://${{Atmosphere-web.RAILWAY_PUBLIC_DOMAIN}}
```

Production CORS already allows `https://platform.atmosphereteam.com` even if `FRONTEND_ORIGIN` is stale — without that, login shows **Origin not allowed**. The deploy workflow defaults `FRONTEND_ORIGIN` to the platform host plus the Railway office and staff hosts. If GitHub Actions variable `FRONTEND_ORIGIN` is set, it must include `https://platform.atmosphereteam.com` or the next Keys sync will drop it.

### 3. Ship it

`.github/workflows/deploy-production.yml` deploys **both** services (`railway up --service Atmosphere` and `--service Atmosphere-web`). Needs `RAILWAY_TOKEN` in the `Keys` environment. Optional: `RAILWAY_APP_SERVICE` if the office service is not named `Atmosphere-web`.

```bash
# Or from a laptop, after `railway link` (repo root, not frontend/):
railway up --service Atmosphere-web
```

Health probe: `GET https://<app-host>/healthz` → `ok`. The SPA is `/`; Field Capture is `/fieldcapture/`; Verifier is `/verifier/`.

### 4. Point the rest of the product at that origin

| Where | What |
| --- | --- |
| GitHub Actions variable `WEBSITE_APP_ORIGIN` | `https://platform.atmosphereteam.com` — marketing Sign in / Get started CTAs (see `website/README.md`) |
| GitHub Actions variable `WEBSITE_API_ORIGIN` | Backend’s public https origin — careers/contact forms on Pages |
| GitHub Actions variable `FRONTEND_ORIGIN` | Same as backend `FRONTEND_ORIGIN` (synced onto Railway by the deploy job) |
| Supabase → Auth → URL configuration | Site URL = live office origin (never `http://localhost:3000`). Also allow `{origin}/reset-password`. Recovery mail is sent by Atmosphere with a `token_hash` link, so a leftover localhost Site URL cannot hijack the click. |
| Stripe webhooks | Still `POST https://<backend-public-host>/api/webhooks/stripe` (not the app host) |

Invite emails use the first origin in `FRONTEND_ORIGIN`, so put the public `https://` app URL first.

### Host the internal staff site on Railway

Atmosphere Internal (`internal/`) is a third Railway service next to the BFF and office app. Same-origin `/api` again: staff sign in with the same Atmosphere account; `analytics_staff` gates named accounts.

1. **+ Create → Empty service** in the **existing** Atmosphere project. Name it `Internal Growth Metrics` (or set `RAILWAY_INTERNAL_SERVICE`). Do not create a second Railway project.
2. Settings → **Config File**: `/internal/railway.json` (same settings as `internal/railway.toml`). New services that cannot set Config File still get those values from `internal/scripts/apply-railway-config.sh` on deploy.
3. Settings → **Root Directory**: `/`
4. Trigger branch must contain `internal/` (until this is on `main`, use the branch that added it). Deploying `main` before that merge cannot see `/internal/railway.json`.
5. Variable `API_UPSTREAM=http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}`
6. Networking → **Generate domain**. Add that https origin to backend `FRONTEND_ORIGIN`. Production CORS already allows the live staff host `https://melodious-inspiration-production-5ad9.up.railway.app`.
7. Health probe: `GET /healthz` → `ok` (also `/health` and `/api/health`). nginx starts with `startCommand` from `internal/railway.json`, not `node dist/index.js`.

Do not point customers here. The site sends `X-Robots-Tag: noindex`. The
hosted image has no demo-data path — sign-in and every report hit the live
BFF. Grant access with `ANALYTICS_INTERNAL_EMAILS` or `npm run analytics:grant --prefix backend -- someone@company.com internal`.

See [`internal/README.md`](../internal/README.md).

Local stand-in for this topology:

```bash
docker compose up --build
# app:       http://localhost:8080
# internal:  http://localhost:8081
# api:       http://localhost:4000  (also reachable as http://localhost:8080/api/…)
```

## Supabase

1. Dedicated **production** project (never the shared demo URL from `.env.example`).
2. Apply migrations — see [Migration apply order](#migration-apply-order).
3. Auth → URL configuration: set Site URL to the live office origin (not
   `http://localhost:3000`) and allow `{origin}/reset-password`. Atmosphere
   mails recovery links itself (`token_hash` on `/reset-password`) as
   Atmosphere, never as Supabase Auth. The dashboard values are unused for
   this flow.
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
| `DEVICE_PEPPER` | PIN hashing and internal-site Authenticator secrets (never store in the DB) |
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

Production deploy also runs `backend/scripts/applyOldProductTables.mjs`, which
applies `20260828220000_drop_old_product_tables.sql`. That removes leftover
CRM/sales/finance/estimator/web-access tables. It does **not** drop `crm_jobs`,
`crm_properties`, Stripe/metering, Field Capture, verification, or HomeOwner
Report tables.

```bash
npm run check:migrations --prefix backend
```

`db/*.sql` are reference/installers — prefer the timestamped migrations.

### Internal analytics access

`/analytics` is gated by `public.analytics_staff`. Atmosphere staff emails in
`ANALYTICS_INTERNAL_EMAILS` (default: `jack@jettx.ai`) are **auto-granted** on
the next `/api/analytics/access` probe when `SUPABASE_SERVICE_ROLE_KEY` is set —
no SQL step in preview.

The internal staff site (`internal/`) signs in with first name, last name,
and email (`POST /api/auth/internal-challenge`), then a 6-digit Microsoft
Authenticator code (`POST /api/auth/internal-login`). After that first
setup, email + the Authenticator code is the password — no office-app
password. Allowlisted emails enroll immediately. Other employees are queued
on **Access** until an internal admin approves them
(`GET/POST /api/analytics/access-requests`). Apply
`20260821210000_internal_staff_totp.sql`,
`20260822170000_internal_access_requests.sql`, and
`20260822181000_internal_staff_totp_names.sql` on production Supabase.
Secrets are encrypted with `DEVICE_PEPPER`.

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
| Marketing | `GET /health` | nginx on the corporate-site service is serving |

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
