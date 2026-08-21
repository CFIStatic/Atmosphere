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

### 1. Apply the account-file and authenticator migrations

On the production Supabase project, apply **one** copy of each (the two
directories are identical):

- `backend/supabase/migrations/20260821160000_internal_account_detail.sql`
  or `supabase/migrations/20260821160000_internal_account_detail.sql`
- `backend/supabase/migrations/20260821210000_internal_staff_totp.sql`
  or `supabase/migrations/20260821210000_internal_staff_totp.sql`

Without the account-file migration, overview/accounts still load from the
existing analytics RPCs; opening one org (`/accounts/:id`) returns an error.
Without the TOTP table, Microsoft Authenticator sign-in cannot store the
enrolled secret.

### 2. Create the service

Add a service in the **existing** Atmosphere Railway project (the one that
already has `Atmosphere` and `Atmosphere-web`). Do not create a second
Railway project.

1. Railway project canvas → **+ Create → Empty service**.
2. Name it **`Atmosphere-internal`**.
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

Health: `GET https://<internal-host>/healthz` → `ok`. nginx also answers
`/health` and `/api/health` with `ok` so a leftover backend probe cannot
take the replica down.

### 6. Sign in with Microsoft Authenticator

Open the generated domain. The form asks for **first name**, **last name**,
and **email** — not the office-app password.

- Email must be on `ANALYTICS_INTERNAL_EMAILS` (default `jack@jettx.ai`).
- First visit for that email shows a QR code. In Microsoft Authenticator:
  **+ → Other account (Google, Facebook, etc.) → scan the QR**. Enter the
  6-digit code. That enrollment is stored on the BFF (encrypted with
  `DEVICE_PEPPER`). Finish this step in one sitting (about 10 minutes).
- Later visits only ask for the 6-digit code from the same Authenticator
  account.
- The first successful enrollment for an allowlisted email owns that pairing.
  If you close the page before entering the first code, delete the Atmosphere
  Internal account in Authenticator and scan again.

The BFF upserts `analytics_staff` when `SUPABASE_SERVICE_ROLE_KEY` is set,
and stores the name you typed as the staff display name.

Manual grant for someone else:

```bash
cd backend && npm run analytics:grant -- someone@company.com internal
```

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
| `API_UPSTREAM` | `http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}}` |
| Project | same canvas as the `Atmosphere` BFF |

Then **Deploy** again. A passing probe is `GET /healthz` → `ok` in a few
seconds, not five minutes.

### If Continue returns 502

`/healthz` is local nginx. A 502 on **Continue** means `/api` cannot reach
the BFF.

| Check | Must be |
| --- | --- |
| `API_UPSTREAM` on Atmosphere-internal | `http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}}` |
| Not | `http://127.0.0.1:4000` or `https://atmosphere-production.up.railway.app` |
| Atmosphere BFF | deployed with `POST /api/auth/internal-challenge` |
| Supabase | `20260821210000_internal_staff_totp.sql` applied |

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
| `ANALYTICS_INTERNAL_EMAILS` | Auto-grant internal scope (default `jack@jettx.ai`) |
| `DEVICE_PEPPER` | Encrypts Microsoft Authenticator secrets (existing BFF secret) |
| `npm run analytics:grant --prefix backend -- someone@company.com internal` | Manual grant |
| Migration `20260821160000_internal_account_detail.sql` | One-org members/jobs/usage RPC |
| Migration `20260821210000_internal_staff_totp.sql` | Authenticator enrollment table |
