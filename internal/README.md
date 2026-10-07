# Atmosphere Analytics — staff reporting site

A separately hosted website for Atmosphere staff (Jettx LLC ops). **Hosted
builds always talk to the live BFF.** There is no demo-data button and no
fixture payload in the production image. nginx reverse-proxies `/api` to the
Atmosphere backend, so sign-in is a real session cookie and every number is a
real RPC.

This is not customer-facing product marketing. Atmosphere is the product; Work
Verification is the sold activity; Platform / Field Capture are the office and
crew apps. Integrity agent / computer-use / estimator are not live surfaces.

Navigation is grouped like a report's table of contents. On wide screens the
left sidebar can be collapsed to an icon rail (button at the bottom of the
sidebar; the choice is remembered in `localStorage` under
`atmosphere-analytics.sidebar`, and collapsed icons show their name as a
tooltip on hover or keyboard focus). Below 1024px the sidebar becomes a
slide-in drawer opened from the header menu button.

| Group | Page | Live source | Who |
| --- | --- | --- | --- |
| Summary | Overview (`/overview`) | `GET /api/analytics/overview` + `GET /api/analytics/product-health` | investor + internal |
| Summary | North star (`/north-star`) | product-health `northStar` | investor + internal |
| Growth & revenue | Revenue & customers (`/growth`) | overview `summary`, `monthly`, `planMix` | investor + internal |
| Growth & revenue | Organizations (`/accounts`) | overview `accounts` + `GET /api/analytics/accounts/:orgId` | internal |
| Growth & revenue | Experiments | `GET /api/analytics/experiments` | internal |
| Product | Feature usage (`/usage`) | overview `features` | investor + internal |
| Product | Capture pipeline (`/capture`) | `GET /api/analytics/product-health` | investor + internal |
| Product | Ask quality (`/ai`) | `GET /api/analytics/product-health` | investor + internal |
| Product | Motion clips | `GET /api/motion-clips/staff` | internal |
| AI cost & usage | Token usage, Cost reconciliation, AI budgets, Metering, Computer practice | `/api/analytics/token-usage`, `/ai-reconciliation`, `/ai-budgets`, `/metering`, computer-practice routes | internal |
| Contacts & campaigns | Contacts (`/contacts`) | `GET /api/analytics/contacts` | internal |
| Contacts & campaigns | Campaigns (`/campaigns`, `/campaigns/:id`) | `/api/analytics/campaigns*` | internal |
| System & access | Access, Legal holds, System status | existing routes | internal (System: both) |

### Excel downloads

Every table, chart and headline-figure strip has a **Download** button that
saves an `.xlsx` workbook named `atmosphere-<table>-YYYY-MM-DD.xlsx`. The
workbook is built in the browser from the same data the page loaded (all rows,
not just the visible page, and respecting the current filter/sort). Columns
have header rows, an autofilter, and real number, currency, percent and date
cells. Where the page only shows a slice of a longer list (legal user actions,
motion clips), the export re-fetches the longer list from the API first.

Workbooks are written with SheetJS Community Edition 0.20.3, installed from
the official SheetJS CDN tarball (`cdn.sheetjs.com`), not the stale npm
`xlsx@0.18.5`, which has CVE-2023-30533 and CVE-2024-22363. The library is
only used to write files (never to parse uploads) and is loaded as a separate
chunk the first time someone clicks Download. Strings are written as text
cells, so a value such as `=HYPERLINK(...)` is never evaluated as a formula.
Code: `src/lib/excel.ts`, `src/lib/excelWriter.ts`,
`src/components/DownloadButton.tsx`.

### Metrics on the Overview

| Metric | Definition | Source |
| --- | --- | --- |
| North star: hours filmed per paying seat | Weekly (Mon–Sun UTC) capture hours from paying orgs ÷ their billed seats. Paying = latest billing event active or past due with MRR > 0. | `job_proofs.duration_seconds`, `received_at`; `org_billing_events` |
| Upload completion | completed ÷ (started − in flight), plus failed, abandoned, retried and top error codes | `capture_upload_attempts` (new; recorded by the upload routes) |
| Time to analysis | median and p90 of `received_at → analysed_at` | `job_proofs` |
| Evidence delivered | proofs analysed, daily reports sent, evidence downloads, share links created / opened | `job_proofs`, `daily_job_reports`, `evidence_downloads`, `verifier_shares` |
| Ask quality | questions, turns, error / refusal / stop rates, median and p90 latency, time to first token | `job_proof_questions`, `ask_turn_events` (new; recorded by job and progress-share Ask) |

Not tracked yet, and shown as such: Ask answer feedback (no rating control
exists), per-period share-link opens (only a lifetime counter and the latest
open are kept), and upload / Ask history before the release that adds the
tracking tables. All comparisons are last 4 weeks vs the prior 4 weeks unless
labelled otherwise.

### Contacts and campaigns

- Contacts are read from Stripe **on the server** with the existing
  `STRIPE_SECRET_KEY`; the browser never sees a key. They are cached in memory
  for five minutes and are not stored in Supabase. Sources are pluggable
  (`backend/src/analytics/contacts/`): Stripe is live, and a disabled
  "CRM (coming soon)" source is registered with no integration behind it.
  Contacts are de-duplicated by email across sources.
- Campaign drafts live in `analytics_campaigns`; addresses actually emailed go
  to `analytics_campaign_sends` with a per-recipient unsubscribe token;
  unsubscribes, bounces and complaints go to `analytics_email_suppressions` and
  are always skipped. All three tables are RLS-on with no grants to
  `anon` / `authenticated`; every RPC re-checks internal staff scope.
- Every email carries an unsubscribe link (`/api/unsubscribe?t=…`) and a
  one-click `List-Unsubscribe` header, and is sent through the platform mail
  path (Resend).
- **Sending is off by default.** `POST /api/analytics/campaigns/:id/send`
  answers 403 `campaign_sending_disabled` unless the API has
  `CAMPAIGN_SENDING_ENABLED=true`. Outside production it additionally requires
  `SYSTEM_MAIL_DRIVER=log`, so dev and staging only write to `backend/.mail/`.
  In production it also requires `CAMPAIGN_POSTAL_ADDRESS` (CAN-SPAM). The
  request must repeat the recipient count the person confirmed, and the
  server recomputes it before sending.

### Local development with TEST DATA

```bash
cd internal
node scripts/mock-api.mjs   # TEST DATA API on :4000 (dev only, never sends email)
npm run dev                 # http://localhost:5175, proxies /api to :4000
```

The mock answers every report with invented organizations and `@example.test`
addresses and sets `x-atmosphere-test-data: 1`; the UI then shows a TEST DATA
ribbon. It is not imported by `src/`, so it is never in the production build.

This is **not** the customer office console and **not** the marketing site.
Named customer accounts never leave `analytics_staff` internal scope (API +
SQL both re-check).

## Host on Railway (real data)

Do this once in the same Railway project that already runs `Atmosphere`
(the BFF) and `Atmosphere-web` (the office app).

### 1. Apply the migrations

Atmosphere Analytics adds two (both in `supabase/migration-manifest.json`):

- `20261002210000_atmosphere_analytics_health.sql` — upload and Ask tracking
  tables, `record_capture_upload`, `analytics_product_health`
- `20261002211000_atmosphere_analytics_campaigns.sql` — campaigns, sends,
  suppressions, their RPCs, and a fixed `record_unsubscribe`

Earlier staff-site migrations:

On the production Supabase project, apply **one** copy of each (the two
directories are identical):

- `backend/supabase/migrations/20260821160000_internal_account_detail.sql`
  or `supabase/migrations/20260821160000_internal_account_detail.sql`
- `backend/supabase/migrations/20260822170000_internal_access_requests.sql`
  or `supabase/migrations/20260822170000_internal_access_requests.sql`
- (optional / legacy) `20260821210000_internal_staff_totp.sql` and
  `20260822181000_internal_staff_totp_names.sql` — no longer required for login

Without the account-file migration, overview/accounts still load from the
existing analytics RPCs; opening one org (`/accounts/:id`) returns an error.
Legacy TOTP migrations may still be present in the database; staff login
no longer uses Authenticator secrets. Without the access-request table,
unknown employees cannot be queued for admin approval.

### 2. Create the service

Add a service in the **existing** Atmosphere Railway project (the one that
already has `Atmosphere` and `Atmosphere-web`). Do not create a second
Railway project.

1. Railway project canvas → **+ Create → Empty service**.
2. Name it **`Internal Growth Metrics`** (override with `RAILWAY_INTERNAL_SERVICE`).
3. Settings → **Source** → `CFIStatic/Atmosphere`.
4. Settings → **Root Directory** = `/`.
5. Settings → **Config File** = `/internal/railway.json` (same values as
   `internal/railway.toml`). New Railway services often cannot set this field;
   the deploy job runs `internal/scripts/apply-railway-config.sh` so the
   service still gets nginx + `GET /healthz` instead of `node dist/index.js`
   and `/api/health`.
6. Trigger branch: a commit that contains `internal/` (this folder). Until
   that is on `main`, point the service at `cursor/internal-data-platform-e19d`.
   A GitHub deploy of today's `main` cannot use this config file — it is not
   on `main` yet — so it builds the BFF image instead.
7. **Autodeploy** on, **Wait for CI** on.

### 3. Point `/api` at the live BFF

Variables on **Internal Growth Metrics** (not GitHub Keys):

```text
API_UPSTREAM=http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}
```

Leave `VITE_API_BASE_URL` unset. The image is built with an empty API base so
the browser calls same-origin `/api`, and nginx proxies that to the BFF.
Cookies stay `SameSite=Lax`. That is the real connection.

### 4. Public URL + CORS

On **Internal Growth Metrics** → Networking → **Generate domain**.
The live host is `https://melodious-inspiration-production-5ad9.up.railway.app`.

On the **Atmosphere** (backend) service, add that https origin to
`FRONTEND_ORIGIN` (comma-separated with the office app). Example:

```text
FRONTEND_ORIGIN=https://platform.atmosphereteam.com,https://atmosphere-web-production.up.railway.app,https://atmosphere-internal-production.up.railway.app
```

CORS also allows `https://atmosphere-internal*.up.railway.app` without that
edit, but putting it on `FRONTEND_ORIGIN` is the durable list. GitHub Actions
syncs Keys → Railway on `main`; the default now includes the internal host.

### 5. Ship it

After this branch is on `main`, GitHub Actions **Deploy Work Verification**
runs `railway up` for service `Internal Growth Metrics` whenever `internal/`
changes. Override the name with `RAILWAY_INTERNAL_SERVICE`.

Or click **Deploy** on the service after Autodeploy is on.

Health: `GET https://<internal-host>/healthz` → `ok`. nginx also answers
`/health` and `/api/health` with `ok` so a leftover backend probe cannot
take the replica down.

### 6. Sign in (invite-only, Platform password)

Open the generated domain. Sign in with the **same email + password** as
Atmosphere Platform (Supabase Auth). Microsoft Authenticator codes are **not**
used.

- **Invite-only.** Allowlisted emails (`ANALYTICS_INTERNAL_EMAILS`, default
  `jack@jettx.ai` / `Jack@jettx.ai`) can sign in immediately. Email matching is
  case-insensitive.
- Anyone else taps **Need access? Request an invite**, enters name + work email,
  and is queued on **Access** for an internal admin to approve (or deny).
  After approval they sign in with their Platform password.
- Staff must already have a Platform account (or create one on
  platform.atmosphereteam.com). Internal does not store a parallel password.

#### How to invite staff

1. **Env allowlist (ops):** add the email to `ANALYTICS_INTERNAL_EMAILS` on the
   Atmosphere APIs service (comma-separated). Default includes `jack@jettx.ai`.
2. **Access page (admin UI):** an internal admin opens **Access**, approves the
   pending request. The employee then signs in with Platform email + password.
3. **CLI grant (existing Auth user):**
   ```bash
   cd backend && npm run analytics:grant -- someone@company.com internal
   ```
   Prefer (1) or (2) for Internal Growth Metrics login; the allowlist / Access
   approval is what the invite gate checks before Platform password verification.

The BFF upserts `analytics_staff` on successful internal sign-in when
`SUPABASE_SERVICE_ROLE_KEY` is set.

You will see **live** orgs, MRR, usage, jobs, and `/api/ready` from
production — empty tiles mean there is no production data yet, not demo data.

Do not send this URL to customers. The site sends `X-Robots-Tag: noindex`.

### If Network → Healthcheck fails (~5 minutes)

That timeout is the **backend** probe: `/api/health` with
`healthcheckTimeout = 300` from `/railway.toml`. The internal site is nginx.

| Check | Must be |
| --- | --- |
| Config File | `/internal/railway.json` (or `/internal/railway.toml`) |
| Root Directory | `/` |
| Branch | a commit that has `internal/Dockerfile` |
| Start command | `/docker-entrypoint.sh nginx -g 'daemon off;'` |
| `API_UPSTREAM` | `http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}` |
| Project | same canvas as the `Atmosphere` BFF |

Then **Deploy** again. A passing probe is `GET /healthz` → `ok` in a few
seconds, not five minutes.

### If Continue returns 502

`/healthz` is local nginx. A 502 on **Continue** means `/api` cannot reach
the BFF.

| Check | Must be |
| --- | --- |
| `API_UPSTREAM` on Internal Growth Metrics | `http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}` |
| Not | `http://127.0.0.1:4000` or `https://atmosphere-production.up.railway.app` |
| Atmosphere BFF | deployed with `POST /api/auth/internal-login` (Platform password) |
| Supabase | staff allowlist / access-request tables; Platform Auth users |

The public https BFF URL hairpins across Railway edges and 502s. Loopback
is inside the nginx container, where nothing is listening.

## Develop against the real backend

```bash
cd backend && npm run dev          # :4000, your real .env / Supabase
cd internal && npm install && npm run dev   # :5175, proxies /api → :4000
```

Sign in with a real staff account. Same cookies as the office app.

## Access

| Knob | Meaning |
| --- | --- |
| `ANALYTICS_INTERNAL_EMAILS` | Invite allowlist / auto-grant internal scope (default `jack@jettx.ai`) |
| **Access** page | Internal admin queue — approve one employee or approve all |
| Platform password | Same Supabase email + password as platform.atmosphereteam.com |
| `npm run analytics:grant --prefix backend -- someone@company.com internal` | Manual analytics_staff grant |
| Migration `20260821160000_internal_account_detail.sql` | One-org members/jobs/usage RPC |
| Migration `20260822170000_internal_access_requests.sql` | Employee access-request queue |
