# Atmosphere Internal — staff data platform

A separately hosted website for Atmosphere staff. It reads the existing BFF
(`/api/auth/*`, `/api/analytics/*`, `/api/ready`) and shows:

| Page | Source | Who |
| --- | --- | --- |
| Overview | `GET /api/analytics/overview` | investor + internal |
| Accounts | overview `accounts` + `GET /api/analytics/accounts/:orgId` | internal |
| Usage | overview `features` | investor + internal |
| Experiments | `GET /api/analytics/experiments` | internal |
| Metering | `GET /api/analytics/metering` | internal |
| System | `GET /api/ready` + staff identity | investor + internal |

This is **not** the customer office console and **not** the marketing site.
Named customer accounts never leave `analytics_staff` internal scope (API +
SQL both re-check).

## Develop

Needs the backend on `:4000` (same cookie session as the office app).

```bash
cd backend && npm run dev          # :4000
cd internal && npm install && npm run dev   # :5175
```

Sign in as `jack@jettx.ai` (or any email in `ANALYTICS_INTERNAL_EMAILS`).
The BFF upserts `analytics_staff` when the service role key is set.

Preview without a live backend:

```bash
# On the login page: "Preview with demo data"
# or
VITE_DEMO=1 npm run dev
```

## Host on Railway

Same shape as the office app: nginx serves the SPA and reverse-proxies `/api`
to the BFF so httpOnly cookies stay SameSite=Lax.

1. In the Railway project that already runs `Atmosphere`, **+ Create → Empty
   service**. Name it `Atmosphere-internal`.
2. Settings → **Config File** = `/internal/railway.toml`
3. Settings → **Root Directory** = `/`
4. Variable:

   ```text
   API_UPSTREAM=http://${{Atmosphere.RAILWAY_PRIVATE_DOMAIN}}:${{Atmosphere.PORT}}
   ```

5. Networking → **Generate domain**. Put that https origin on the backend
   `FRONTEND_ORIGIN` list (comma-separated with the office app). Production
   CORS already allows `https://atmosphere-internal*.up.railway.app`.
6. Autodeploy from `main`, Wait for CI on, watch paths `internal/**`.

GitHub Actions deploys this service on `main` when `internal/` changes
(`.github/workflows/deploy-production.yml`, service name override
`RAILWAY_INTERNAL_SERVICE`).

Health probe: `GET /healthz` → `ok`.

Local production-shaped stack:

```bash
docker compose up --build internal
# http://localhost:8081
```

## Access

| Knob | Meaning |
| --- | --- |
| `ANALYTICS_INTERNAL_EMAILS` | Auto-grant internal scope (default `jack@jettx.ai`) |
| `npm run analytics:grant --prefix backend -- someone@company.com internal` | Manual grant |
| Migration `20260821160000_internal_account_detail.sql` | One-org members/jobs/usage RPC |
