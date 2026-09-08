# Stripe payments

Self-serve Atmosphere plans are **Starter** ($399/mo, 1 Field Capture seat),
**Work Verification** ($849/mo, 3 seats, the default), and **Scale** ($1,999/mo,
10 seats). Extra Field Capture seats are **$125/month** each. Token/AI usage is
invoiced **the day it is used**. Signup Checkout and Settings → Billing are that
bill. Enterprise is contact-sales only — there is no fourth self-serve SKU. The
Field Capture Chest Mount is a one-time **$49.99** Payment Link on the website.

A leftover seat / LLM-credit catalog (`billing_plans`, credit packs) still has
API and webhook handlers so existing Stripe events do not break. It is **not**
shown in the app. Do not add UI for it unless that catalog is product again.

Setting `STRIPE_SECRET_KEY` switches billing to Stripe. Without it the app
falls back to `PAYMENT_PROVIDER=dev` locally (refused in production).

Railway may store the live secret as `Stripe_Secret_Key` (mixed case). The
backend accepts that name as an alias; `STRIPE_SECRET_KEY` wins if both are
set. `STRIPE_WEBHOOK_SECRET` stays the only webhook signing-secret name.

## Keys

| Key | Env var | Required? |
| --- | --- | --- |
| **Secret** (`sk_test_…`) or **restricted** secret (`rk_test_…` with Checkout + Customers + Subscriptions + Invoices + Webhooks) | `STRIPE_SECRET_KEY` (alias: `Stripe_Secret_Key`) | Yes |
| **Webhook signing secret** (`whsec_…`) | `STRIPE_WEBHOOK_SECRET` | Yes (webhooks reject all events without it) |
| **Work Verification onboarding price** (`price_…`) | `STRIPE_ONBOARDING_PRICE_ID` | Default signup plan. Live Jettx Work Verification is `price_1UDGIZ1b5twUY3LyO0culT5W` (`prod_VDVR9rM3g9Tkpg`) — Railway is set by the human. |
| **Starter price** (`price_…`) | `STRIPE_STARTER_PRICE_ID` | Set on Railway. Live Starter is `price_1UDGIY1b5twUY3Ly7UlLMYBW` (`prod_VDZ3e7oBJWIYSE`, $399/mo, 1 seat). Checkout falls back to this id if the env is unset. |
| **Scale price** (`price_…`) | `STRIPE_SCALE_PRICE_ID` | Set on Railway. Live Scale is `price_1UDGIb1b5twUY3LyUuZeyp75` (`prod_VDZ3SMytTKoxc5`, $1,999/mo, 10 seats). Checkout falls back to this id if the env is unset. |
| **Extra Field Capture seat** (`price_…`) | `STRIPE_EXTRA_SEAT_PRICE_ID` | Optional. Defaults to live `price_1UDGIc1b5twUY3Ly0cEsD5Pr` ($125/mo). |
| Publishable (`pk_test_…`) | — | **Not used** — Checkout is hosted; the browser never talks to Stripe.js |
| **Billing exempt emails** | `BILLING_EXEMPT_EMAILS` | No. Comma-separated, case-insensitive. Empty (default) = no exemptions. Example: `jack@jettx.ai`. |

Prefer **test-mode** keys until go-live. Do not commit real keys.

Also required for settlement: `SUPABASE_SERVICE_ROLE_KEY` — the webhook has no
user session, so it writes subscriptions under the service role.

## Money is minted by the webhook

Checkout endpoints only *open* a session. Credits and subscription changes are
applied when Stripe confirms payment. Returning to a success URL proves nothing.

| Flow | Endpoint | Settled by |
| ---- | -------- | ---------- |
| Atmosphere signup (Starter / Work Verification / Scale) | `POST /api/billing/checkout/onboarding` | `customer.subscription.*` |
| Extra Field Capture seats | `POST /api/billing/checkout/extra-seats` | Updates the subscription item, or Checkout; webhook syncs quantity |
| Cards / invoices / cancel | `POST /api/billing/portal` | Stripe Customer Portal |
| Invoice / receipt list | `GET /api/billing/invoices` | Stripe Invoices API for the org `stripe_customer_id` |
| Same-day token/AI usage | recorded with `record_token_usage` | InvoiceItem + Invoice that day; `invoice.paid` records it |
| Period overage (jobs / compute) + leftover usage | `POST /api/metering/period/close` | Creates a Stripe invoice; `invoice.paid` records it |
| Credit packs (no UI) | `POST /api/billing/purchases` | `checkout.session.completed` |
| Seat plans (no UI) | `POST /api/billing/checkout/subscription` | `customer.subscription.*` |

Customer Settings reads `GET /api/billing/workspace`, not the seat/credit
`billing_overview`.

Token usage on that same page is metered separately from the $849
subscription. `token_usage_events.cost_nanos` is the provider/COGS estimate;
`price_nanos` (Token spend) is the customer charge at
`USAGE_CUSTOMER_MARKUP` / `TOKEN_BILLABLE_MARKUP` (default **10×**, ~90%
gross margin). When billable usage is recorded for an org with an active
Stripe customer, leftover cents for that UTC day become a Stripe InvoiceItem
and a same-day Invoice (`kind=same_day_usage`). Same-day charges are
coalesced: later usage that day invoices only the leftover. `invoice.finalized`
and `invoice.paid` record the receipt. Period-close invoices leftover usage
days as a safety net. Do not apply this multiplier to seat or Stripe
subscription prices. Settings → Billing lists the same invoices from Stripe
(`GET /api/billing/invoices`) with a hosted invoice / PDF link.

Field Capture seats: allowed = **included seats from the org plan + extra
seat quantity** (Starter 1, Work Verification 3, Scale 10). Creating an
account past that limit returns `fc_seat_limit` until extra seats are added
on invite (`POST /api/org/invites`) or via `POST /api/billing/checkout/extra-seats`.
The webhook syncs extra quantity from any `field_capture_extra_seat`
subscription item and writes `atmosphere_plan_code` / `included_fc_seats`
from subscription metadata. Inserts into `org_members` / `org_invites` are
also checked in Postgres under an advisory lock so concurrent join-code
requests cannot mint unpaid seats.

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
prints (also written into `metering_plan_versions.stripe_price_id`). Set
`STRIPE_STARTER_PRICE_ID` and `STRIPE_SCALE_PRICE_ID` on Railway to the live
Starter / Scale ids (`price_1UDGIY1b5twUY3Ly7UlLMYBW` /
`price_1UDGIb1b5twUY3LyUuZeyp75`). Those ids are also pinned in
`backend/src/lib/stripeCatalog.ts` so re-runs look up by `atmosphere_plan_code`
(and those ids) instead of creating duplicates, and checkout can fall back if
the env is unset. Product/price metadata includes `atmosphere_plan_code` and
`atmosphere_included_fc_seats`. Extra seats are `field_capture_extra_seat`.
Prior live prices (`price_1UD7vi1b5twUY3LykzUsVQVr`, `price_1UD4Sq1b5twUY3Ly6nqfRaGC`,
`price_1UD7vj1b5twUY3Ly1Q4uv4kS`, `price_1UD4Sl1b5twUY3LyjD850F4V`) stay
recognized on existing subscriptions until those items migrate.

Chest Mount hardware is one-time `price_1UD4Sl1b5twUY3LyFtodoczS` ($49.99).
The live Payment Link is
`https://buy.stripe.com/bJedR16fJ40l5G1eRJfYY01`. The older
`https://buy.stripe.com/5kQ7sD47B54p7O9391fYY00` link is $49 and inactive.

A price that is not in either catalog is a **hard webhook failure** (500 +
retry). Do not skip unmapped prices — that loses a paid signup.

## Webhook endpoint

Point Stripe at `POST https://<api-host>/api/webhooks/stripe` with events:

- `checkout.session.completed`
- `invoice.finalized`
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
STRIPE_ONBOARDING_PRICE_ID=price_1UDGIZ1b5twUY3LyO0culT5W   # live Work Verification $849/mo; Railway is set by the human
STRIPE_STARTER_PRICE_ID=price_1UDGIY1b5twUY3Ly7UlLMYBW     # live Starter $399/mo (1 seat)
STRIPE_SCALE_PRICE_ID=price_1UDGIb1b5twUY3LyUuZeyp75       # live Scale $1,999/mo (10 seats)
# STRIPE_EXTRA_SEAT_PRICE_ID=price_1UDGIc1b5twUY3Ly0cEsD5Pr  # optional; live extra FC seat $125/mo
SUPABASE_SERVICE_ROLE_KEY=…
FRONTEND_ORIGIN=http://localhost:5174,http://localhost:5173
# Optional — defaults land on Settings → Billing:
# STRIPE_SUCCESS_URL=http://localhost:5174/settings?section=billing&checkout=success
# STRIPE_CANCEL_URL=http://localhost:5174/settings?section=billing&checkout=cancelled
# STRIPE_PORTAL_RETURN_URL=http://localhost:5174/settings?section=billing
# STRIPE_ONBOARDING_RETURN_URL=http://localhost:5174/signup
# BILLING_EXEMPT_EMAILS=jack@jettx.ai   # Railway Atmosphere APIs — skip Checkout for these creators
```

`BILLING_EXEMPT_EMAILS` is an allowlist, not a product change. Listed
creators skip the signup Checkout gate (`required: false`, `complete: true`,
`hasSubscription: true`) and Field Capture seats stay entitled. Same-day
token/AI usage invoices and period-close overage invoices are skipped when
the org creator is listed or `org_billing.status` is `comped`.

Live production (2026-09-07): `BILLING_EXEMPT_EMAILS=jack@jettx.ai` is set on
Railway Atmosphere APIs so founder Checkout and usage invoices stay off.

`/billing` still redirects to `/settings?section=billing` so older return URLs
keep working.

## Migrations

`backend/supabase/migrations/` and `supabase/migrations/` are a **byte-identical
mirror** (CI: `npm run check:migrations --prefix backend`). Apply one tree,
once. Never apply both. See [`docs/production.md`](./production.md).

## Dashboard toggles

Do these in the **live** Stripe Dashboard (and again in test mode while
rehearsing). Atmosphere does **not** send a custom receipt email — Stripe’s
hosted invoice email is the receipt.

### Jack — invoice / receipt email checklist

1. **Customer emails** — Settings → Billing → Subscriptions and emails
   (sometimes labeled **Customer emails**).
   Enable:
   - **Successful payments** — receipt for each charged invoice (monthly plan
     renewals and same-day usage invoices).
   - **Invoice finalized** / **Email finalized invoices** — so an open invoice
     is emailed even before collection finishes.
   - **Failed payments** — so a declined renewal is not silent.
2. Confirm the **Customer** has an email (Checkout writes the org creator
   email onto the Stripe Customer; `ensureCustomer` backfills if it was
   missing). Invoice emails go to that address / the billing email on the
   Customer, not to a Resend template.
3. **Customer portal** — Settings → Billing → Customer portal (the sync script
   tries to create a default configuration). Invoices also appear in
   Settings → Billing → **Invoices / Receipts** (`GET /api/billing/invoices`)
   with **View receipt** → `hosted_invoice_url` or `invoice_pdf`.
4. Stay in **Test mode** until the go-live checklist in
   [`docs/production.md`](./production.md) is done.

Checkout / subscription creates already use `collection_method=charge_automatically`
(Stripe default for Checkout subscriptions; same-day and period-close invoices
set it explicitly). One-time credit Checkout enables `invoice_creation` so
those charges get an invoice too. Do not invent a Resend receipt unless these
Dashboard toggles are insufficient.
