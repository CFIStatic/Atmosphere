# Atmosphere Internal — staff data platform

A separately hosted website for Atmosphere staff (Jettx LLC ops). **Hosted
builds always talk to the live BFF.** There is no demo-data button and no
fixture payload in the production image. nginx reverse-proxies `/api` to the
Atmosphere backend, so sign-in is a real session cookie and every number is a
real RPC.

This is not customer-facing product marketing. Atmosphere is the product; Work
Verification is the sold activity; Platform / Field Capture are the office and
crew apps. Integrity agent / computer-use / estimator are not live surfaces.

| Page | Live source | Who |
| --- | --- | --- |
| Overview | `GET /api/analytics/overview` | investor + internal |
| Accounts | overview `accounts` + `GET /api/analytics/accounts/:orgId` | internal |
| Access | `GET /api/analytics/access-requests` | internal admin |
| Usage | overview `features` | investor + internal |
| Experiments | `GET /api/analytics/experiments` | internal |
| Metering | `GET /api/analytics/metering` | internal |
| Token usage | `GET /api/analytics/token-usage` | internal |
| System | `GET /api/ready` + `/api/auth/me` | investor + internal |

This is **not** the customer office console and **not** the marketing site.
Named customer accounts never leave `analytics_staff` internal scope (API +
SQL both re-check).

## Host on Railway (real data)

Do this once in the same Railway project that already runs `Atmosphere`
(the BFF) and `Atmosphere-web` (the office app).

### 1. Apply the account-file and access-request migrations

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
Legacy TOTP migrations may still be present in the database; Internal login
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
