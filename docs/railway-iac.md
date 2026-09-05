# Railway config-as-code (prep)

Atmosphere already deploys from **per-service `railway.toml` / `railway.json`**
copied over the inert repo-root `railway.toml` by GitHub Actions. That is the
supported IaC surface today.

Do **not** apply a live `.railway/railway.ts` project graph from this repo
yet. Railway’s TypeScript project API is still moving; a wrong graph would
recreate services or rewrite variables. Revisit after **2026-12-01** if the
dashboard still has to be the source of truth for service topology.

## What is already in git

| File | Service |
| --- | --- |
| `backend/railway.toml` | Work Verification BFF (`Atmosphere APIs`) |
| `frontend/railway.toml` | Office console |
| `fieldcapture/railway.toml` | Field Capture static host |
| `internal/railway.toml` + `internal/railway.json` | Staff site |
| `website/railway.toml` + `website/railway.json` | Marketing site |
| `/railway.toml` | Inert fallback — no Dockerfile, no real watch path |

CI copies the matching file to `./railway.toml` before `railway up`. See
`backend/test/applyRailwayConfigFile.test.ts`.

## Variables that must stay out of git

Secrets live in GitHub environment **Keys** and are pushed by
`backend/scripts/syncGithubEnvToRailway.mjs`. Empty values are skipped.

Production Keys sync now:

- sets `NODE_ENV=production`, `MEDIA_BACKEND=supabase`,
  `ENABLE_PLATFORM_APIS=false`, `COMPUTER_USE_ENABLED=false`,
  `BACKUP_ENABLED=false`
- copies `SENTRY_DSN` **only when** the GitHub secret is present
- **deletes** `ALLOW_MOCK_DRIVERS` if it is still on the service

Never commit tokens, service-role keys, or a real Sentry DSN.

## Local / preview leftover APIs

Leftover routers (sales, PM, estimator, …) stay in the tree. Production
unmounts them. To exercise them locally leave `NODE_ENV` unset. To mimic
production:

```bash
ENABLE_PLATFORM_APIS=false npm run dev --prefix backend
```

See `docs/production.md` § Leftover platform APIs.
