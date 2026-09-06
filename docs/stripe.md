# Stripe payments

The product customers pay for is **Work Verification** — a $599/month platform
subscription plus extra processed jobs. Signup Checkout and Settings → Billing
are that bill.

A leftover seat / LLM-credit catalog (`billing_plans`, credit packs) still has
API and webhook handlers so existing Stripe events do not break. It is **not**
shown in the app. Do not add UI for it unless that catalog is product again.

Setting `STRIPE_SECRET_KEY` switches billing to Stripe. Without it the app
falls back to `PAYMENT_PROVIDER=dev` locally (refused in production).

## Keys

| Key | Env var | Required? |
| --- | --- | --- |
| **Secret** (`sk_test_…`) or **restricted** secret (`rk_test_…` with Checkout + Customers + Subscriptions + Invoices + Webhooks) | `STRIPE_SECRET_KEY` | Yes |
| **Webhook signing secret** (`whsec_…`) | `STRIPE_WEBHOOK_SECRET` | Yes (webhooks reject all events without it) |
| **Onboarding price id** (`price_…`) | `STRIPE_ONBOARDING_PRICE_ID` | Recommended fallback for signup |
| Publishable (`pk_test_…`) | — | **Not used** — Checkout is hosted; the browser never talks to Stripe.js |

Prefer **test-mode** keys until go-live. Do not commit real keys.

Also required for settlement: `SUPABASE_SERVICE_ROLE_KEY` — the webhook has no
user session, so it writes subscriptions under the service role.

## Money is minted by the webhook

Checkout endpoints only *open* a session. Credits and subscription changes are
applied when Stripe confirms payment. Returning to a success URL proves nothing.

| Flow | Endpoint | Settled by |
| ---- | -------- | ---------- |
| Work Verification signup | `POST /api/billing/checkout/onboarding` | `customer.subscription.*` |
| Cards / invoices / cancel | `POST /api/billing/portal` | Stripe Customer Portal |
| Period overage (jobs / compute) | `POST /api/metering/period/close` | Creates a Stripe invoice; `invoice.paid` records it |
| Credit packs (no UI) | `POST /api/billing/purchases` | `checkout.session.completed` |
| Seat plans (no UI) | `POST /api/billing/checkout/subscription` | `customer.subscription.*` |

Customer Settings reads `GET /api/billing/workspace`, not the seat/credit
`billing_overview`.

Token usage on that same page is metered separately from the $599
subscription. `token_usage_events.cost_nanos` is the provider/COGS estimate;
`price_nanos` (Token spend) is the customer charge at
`USAGE_CUSTOMER_MARKUP` / `TOKEN_BILLABLE_MARKUP` (default **10×**, ~90%
gross margin). Historical rows that only stored cost were backfilled to
billable = cost × 10 when cost was > 0; $0 rows were left alone. Do not
apply this multiplier to seat or Stripe subscription prices.

Checkout sessions use Stripe idempotency keys so a double-click reuses the
session instead of opening a second charge.

## Catalog sync

Create Products + Prices and print the SQL that links them into Postgres:

```bash
cd backend
# STRIPE_SECRET_KEY, SUPABASE_URL, and SUPABASE_* in .env
npm run stripe:sync
```

Apply the printed `UPDATE` statements in the Supabase SQL editor. Then set
`STRIPE_ONBOARDING_PRICE_ID` to the Work Verification `price_…` the script
prints (also written into `metering_plan_versions.stripe_price_id`).

A price that is not in either catalog is a **hard webhook failure** (500 +
retry). Do not skip unmapped prices — that loses a paid signup.

## Webhook endpoint

Point Stripe at `POST https://<api-host>/api/webhooks/stripe` with events:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`

Copy the endpoint’s signing secret into `STRIPE_WEBHOOK_SECRET`.

Locally:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

The route is mounted with a **raw body parser before `express.json()`** so
signature verification sees the exact bytes Stripe sent.

Failed handlers call `stripe_event_forget` so Stripe's retry is not treated as
a duplicate. That RPC is applied from the production deploy job
(`scripts/applyStripeEventForget.mjs`) because Railway does not run migrations
on boot.

## Env checklist (`backend/.env`)

```bash
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_ONBOARDING_PRICE_ID=price_…   # from npm run stripe:sync
SUPABASE_SERVICE_ROLE_KEY=…
FRONTEND_ORIGIN=http://localhost:5174,http://localhost:5173
# Optional — defaults land on Settings → Billing:
# STRIPE_SUCCESS_URL=http://localhost:5174/settings?section=billing&checkout=success
# STRIPE_CANCEL_URL=http://localhost:5174/settings?section=billing&checkout=cancelled
# STRIPE_PORTAL_RETURN_URL=http://localhost:5174/settings?section=billing
# STRIPE_ONBOARDING_RETURN_URL=http://localhost:5174/signup
```

`/billing` still redirects to `/settings?section=billing` so older return URLs
keep working.

## Migrations

`backend/supabase/migrations/` and `supabase/migrations/` are a **byte-identical
mirror** (CI: `npm run check:migrations --prefix backend`). Apply one tree,
once. Never apply both. See [`docs/production.md`](./production.md).

## Dashboard toggles

1. **Customer portal** — Settings → Billing → Customer portal (the sync script
   tries to create a default configuration).
2. **Email finalized invoices** — so customers get subscription receipts.
3. Stay in **Test mode** until the go-live checklist in
   [`docs/production.md`](./production.md) is done.
