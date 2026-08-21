# Atmosphere Internal — staff data platform

A separately hosted website for Atmosphere staff. **Hosted builds always talk
to the live BFF.** There is no demo-data button and no fixture payload in the
production image. nginx reverse-proxies `/api` to the Atmosphere backend, so
sign-in is a real session cookie and every number is a real RPC.

| Page | Live source | Who |
| --- | --- | --- |
| Overview | `GET /api/analytics/overview` | investor + internal |
| Accounts | overview `accounts` + `GET /api/analytics/accounts/:orgId` | internal |
| Usage | overview `features` | investor + internal |
| Experiments | `GET /api/analytics/experiments` | internal |
| Metering | `GET /api/analytics/metering` | internal |
| System | `GET /api/ready` + `/api/auth/me` | investor + internal |

This is **not** the customer office console and **not** the marketing site.
Named customer accounts never leave `analytics_staff` internal scope (API +
SQL both re-check).

## Host on Railway (real data)

Do this once in the same Railway project that already runs `Atmosphere`
(the BFF) and `Atmosphere-web` (the office app).

### 1. Apply the account-file migration

On the production Supabase project, apply **one** of these (they are identical):

- `backend/supabase/migrations/20260821160000_internal_account_detail.sql`
- `supabase/migrations/20260821160000_internal_account_detail.sql`

Without it, overview/accounts still load from the existing analytics RPCs;
opening one org (`/accounts/:id`) returns an error until this function exists.

### 2. Create the service

1. Railway project canvas → **+ Create → Empty service**.
2. Name it **`Atmosphere-internal`**.
3. Settings → **Source** → `CFIStatic/Atmosphere`, trigger branch **`main`**.
4. Settings → **Root Directory** = `/`.
5. Settings → **Config File** = `/internal/railway.toml`.
6. **Autodeploy** on, **Wait for CI** on.

### 3. Point `/api` at the live BFF

Variables on **Atmosphere-internal** (not GitHub Keys):

```text
API_UPSTREAM=http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}}
```

Leave `VITE_API_BASE_URL` unset. The image is built with an empty API base so
the browser calls same-origin `/api`, and nginx proxies that to the BFF.
Cookies stay `SameSite=Lax`. That is the real connection.

### 4. Public URL + CORS

On **Atmosphere-internal** → Networking → **Generate domain**.

On the **Atmosphere** (backend) service, add that https origin to
`FRONTEND_ORIGIN` (comma-separated with the office app). Example:

```text
FRONTEND_ORIGIN=https://app.atmosphereteam.com,https://atmosphere-web-production.up.railway.app,https://atmosphere-internal-production.up.railway.app
```

CORS also allows `https://atmosphere-internal*.up.railway.app` without that
edit, but putting it on `FRONTEND_ORIGIN` is the durable list. GitHub Actions
syncs Keys → Railway on `main`; the default now includes the internal host.

### 5. Ship it

After this branch is on `main`, GitHub Actions **Deploy Work Verification**
runs `railway up` for service `Atmosphere-internal` whenever `internal/`
changes. Override the name with `RAILWAY_INTERNAL_SERVICE`.

Or click **Deploy** on the service after Autodeploy is on.

Health: `GET https://<internal-host>/healthz` → `ok`.

### 6. Sign in with a real Atmosphere account

Open the generated domain. Sign in as `jack@jettx.ai` (or any email in
`ANALYTICS_INTERNAL_EMAILS` on the BFF). The BFF upserts `analytics_staff`
when `SUPABASE_SERVICE_ROLE_KEY` is set.

Manual grant for someone else:

```bash
cd backend && npm run analytics:grant -- someone@company.com internal
```

You will see **live** orgs, MRR, usage, jobs, and `/api/ready` from
production — empty tiles mean there is no production data yet, not demo data.

Do not send this URL to customers. The site sends `X-Robots-Tag: noindex`.

## Develop against the real backend

```bash
cd backend && npm run dev          # :4000, your real .env / Supabase
cd internal && npm install && npm run dev   # :5175, proxies /api → :4000
```

Sign in with a real staff account. Same cookies as the office app.

## Access

| Knob | Meaning |
| --- | --- |
| `ANALYTICS_INTERNAL_EMAILS` | Auto-grant internal scope (default `jack@jettx.ai`) |
| `npm run analytics:grant --prefix backend -- someone@company.com internal` | Manual grant |
| Migration `20260821160000_internal_account_detail.sql` | One-org members/jobs/usage RPC |
