# Connect — agent credentials

Atmosphere Connect (`/settings?section=connect`, legacy `/crm` redirects) stores **username + password** so an **agent**
can sign into JobNimbus, AccuLynx, Salesforce, and ServiceTitan to pull and
update jobs, contacts, and claims.

This is **not** the old API-key / OAuth Connect UX. Atmosphere-native job fields
live on the job file elsewhere — they are not a row on Connect.

## Threat model

| Asset | Handling |
| --- | --- |
| CRM password | AES-256-GCM sealed before insert (`password_cipher` / `iv` / `tag`). Key is only `CRM_CREDENTIAL_KEY`. Production refuses to start if it is unset. |
| Username | Stored plaintext so the UI can show “Signed in as …”. |
| Logs | Never log plaintext passwords. Connect logs org + system + username only. |
| RLS | `crm_agent_credentials` deny-all for authenticated; service role only. |
| Ask tools | Soft-fail when not connected; never throw the Ask turn. |

Rotating the seal key invalidates stored passwords — users must reconnect.

## APIs

- `GET /api/crm-credentials` — status for four systems (no passwords)
- `POST /api/crm-credentials/connect` — `{ system, username, password, notes? }`
- `DELETE /api/crm-credentials/:system`
- `POST /api/crm-credentials/:system/verify`

Legacy `/api/crm-sync` and `/api/integrations` remain **removed** (404).

## Agent / adapters (real vs stub)

| CRM | Verify | Search / pull | Notes |
| --- | --- | --- | --- |
| JobNimbus | Tries Bearer API with password; else `agent_session` | Live API search/pull when key works | Full-ish when password is an API key |
| AccuLynx | API probe if password looks like a bearer; else agent session | Stub soft-fail | Browser login queued |
| Salesforce | Agent session stub | Stub | No OAuth on this page |
| ServiceTitan | Agent session stub | Stub | Browser login queued |

`crm_agent_jobs` is the durable queue. Connect runs `verify_login` inline so
status flips without a separate worker. Browser automation for true portal
logins is intentionally stubbed in this PR.

## Env

```bash
# Required in production. No fallback to INTEGRATIONS_CREDENTIAL_KEY or DEVICE_PEPPER.
# Railway sets this as a reference to DEVICE_PEPPER so existing rows still open.
CRM_CREDENTIAL_KEY=
# DEVICE_PEPPER=   # device PIN and internal TOTP only — not read for CRM passwords

# Optional API bases for probes
# JOBNIMBUS_API_BASE=https://app.jobnimbus.com/api1
# ACCULYNX_API_BASE=https://api.acculynx.com/api/v2
```

## Migration

Apply `20260920010000_crm_agent_credentials.sql` (tables `crm_agent_credentials`,
`crm_agent_jobs`).
