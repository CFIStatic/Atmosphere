# Usage → invoice (job costing)

Firms that job-cost AI work need a clear line next to Settings → Billing:

> This job used **X analysis minutes**

Atmosphere already meters every model call into `token_usage_events` (with
optional `job_id`) and invoices token spend same-day via Stripe. This surface
exposes an **org-facing per-job rollup** of that ledger for Global Admins.

## Units (do not invent)

| Unit | Meaning | Source |
| ---- | ------- | ------ |
| **Analysis minutes** | Minutes of job film that finished AI analysis in the selected window | `Σ job_proofs.duration_seconds / 60` where `analysis_status = 'done'`, `deleted_at` is null, and `analysed_at` falls in the report window when set |
| **Tokens** | Metered model tokens for that job in the window | `token_usage_events` rows with matching `job_id` |
| **Token spend** | Customer billable amount for those events | `price_nanos` (same as Token usage / Stripe same-day usage) |

Analysis minutes are **not** derived from tokens. If analysed film has no
usable `duration_seconds`, the UI shows `—` rather than guessing.

Stripe invoice line “analysis units” ($0.01 qty for leftover AI cents) are a
separate PDF quantity convention — see `docs/stripe.md`. They are not minutes.

## API

`GET /api/billing/token-usage?range=period|30d|90d` (billing managers only)
includes `byJob[]`:

- `jobId`, `title`, `jobNumber`
- `analysisMinutes`, `analysisSeconds` (or null)
- token totals + `byFeature` + `priceNanos`

## UI

Settings → Billing → **Usage by job** (under Token usage). Same range tabs as
the token meter. Empty when no events in the window carry a `job_id`.
