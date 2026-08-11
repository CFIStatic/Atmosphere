# Stripe payments setup

Setting `STRIPE_SECRET_KEY` switches billing to Stripe automatically. Without it
the app falls back to `PAYMENT_PROVIDER=dev` locally (refused in production).

## Keys to use

| Key | Env var | Required? |
| --- | --- | --- |
| **Secret** (`sk_test_…`) or **restricted** secret (`rk_test_…` with Checkout + Customers + Subscriptions + Webhooks permissions) | `STRIPE_SECRET_KEY` | Yes |
| **Webhook signing secret** (`whsec_…`) | `STRIPE_WEBHOOK_SECRET` | Yes (webhooks reject all events without it) |
| **Onboarding price id** (`price_…`) | `STRIPE_ONBOARDING_PRICE_ID` | Recommended fallback for signup |
| Publishable (`pk_test_…`) | — | **Not used** — Checkout is hosted; the browser never talks to Stripe.js |

Prefer **test-mode** keys until go-live. Do not commit real keys; put them in
`backend/.env` (gitignored) or your host’s secret store.

Also required for settlement: `SUPABASE_SERVICE_ROLE_KEY` — the webhook has no
user session, so it writes credits / subscriptions under the service role.

## Money is minted by the webhook, never by the browser

Checkout endpoints only *open* a session. Credits and subscription changes are
applied when Stripe confirms payment, authenticated with the service-role key.
Returning to a success URL proves nothing.

| Flow | Endpoint | Settled by |
| ---- | -------- | ---------- |
| Credit packs | `POST /api/billing/purchases` | `checkout.session.completed` |
| Seat plans (`billing_plans`) | `POST /api/billing/checkout/subscription` | `customer.subscription.*` |
| Work Verification signup | `POST /api/billing/checkout/onboarding` | `customer.subscription.*` (metering price) |
| Cards / invoices / cancel | `POST /api/billing/portal` | Stripe Customer Portal |

## One-time catalog sync

Create Products + Prices in your Stripe account and print the SQL that links
them into Postgres:

```bash
cd backend
cp .env.example .env   # if you do not already have one
# Put STRIPE_SECRET_KEY=sk_test_… (and SUPABASE_* ) in .env
npm run stripe:sync
```

Apply the printed `UPDATE` statements in the Supabase SQL editor. Then set
`STRIPE_ONBOARDING_PRICE_ID` to the Work Verification `price_…` the script
prints (also written into `metering_plan_versions.stripe_price_id` by the SQL).

Credit packs do **not** need Stripe Price objects — Checkout builds
`price_data` ad hoc.

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

## Env checklist (`backend/.env`)

```bash
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_ONBOARDING_PRICE_ID=price_…   # from npm run stripe:sync
SUPABASE_SERVICE_ROLE_KEY=…
FRONTEND_ORIGIN=http://localhost:5174,http://localhost:5173
# Optional overrides — defaults derive from FRONTEND_ORIGIN:
# STRIPE_SUCCESS_URL=http://localhost:5173/billing?checkout=success
# STRIPE_CANCEL_URL=http://localhost:5173/billing?checkout=cancelled
# STRIPE_PORTAL_RETURN_URL=http://localhost:5173/billing
# STRIPE_ONBOARDING_RETURN_URL=http://localhost:5174/signup
```

## Dashboard toggles

1. **Customer portal** — Settings → Billing → Customer portal (the sync script
   tries to create a default configuration).
2. **Email finalized invoices** — so customers get subscription receipts.
3. Stay in **Test mode** until the go-live checklist in
   [`docs/production.md`](./production.md) is done.
