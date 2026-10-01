# AI usage budgets

Each Atmosphere plan includes an AI usage allowance for the billing period.
When the allowance is used up, non-essential AI pauses until the period resets,
unless the account upgrades or buys credits. Customers see the allowance.
They do not see how it is derived.

## Allowance

The allowance is `AI_BUDGET_FRACTION` (default `0.10`) of the org's active
subscription charge for the current billing period, including extra Field
Capture seats. A $125/month charge is a $12.50 allowance. The fraction is read
in one place (`backend/src/metering/aiBudgetConfig.ts`).

Mid-period price changes are time-weighted. Stripe subscription updates record
a price span (`ai_budget_price_spans`) from each recurring item's
`unit_amount * quantity`. The first span in a period is backdated to the
period start so an existing subscription is not under-budgeted before the
first webhook. Later changes start at the change time.

Annual plans (a period of about 300 days or more) use 10% of the annual charge
as the period allowance. The rolling daily cap uses one twelfth of that
allowance as the monthly slice. Monthly plans use the full period allowance
as the monthly slice.

Comped and billing-exempt orgs are not paused. If the allowance tables are
missing, limits stay off so Ask keeps working before the migration is applied.

## What is metered

Provider cost is `token_usage_events.cost_nanos`, priced from
`backend/src/metering/modelPriceTable.ts` (token counts times the per-model
table, plus flat fees). The same ledger already used by Settings token usage
is the meter. `price_nanos` is still cost times `USAGE_CUSTOMER_MARKUP` for
history. The allowance itself uses provider cost, not that markup.

| Feature | How it is metered |
| --- | --- |
| Ask | Measured tokens on the Ask model call (`feature=ask`) |
| Research loop | Sum of plan, sufficiency, and synthesis tokens (`feature=research`) |
| Video analysis | Existing verification / proof analysis token events |
| Transcription | Whisper audio minutes (`AI_PRICE_WHISPER_USD_PER_MINUTE`, default $0.006) |
| Document analysis | Scope-document extraction tokens |
| Web search | One Tavily search (`AI_PRICE_TAVILY_SEARCH_USD`, default $0.008) when `TAVILY_API_KEY` is set |

Gemini and DuckDuckGo search fallbacks are not a Tavily invoice, so they are
not given a Tavily fee. Model calls on those paths are still metered when the
provider returns token usage. Anything that never reports tokens and has no
flat price in the table cannot be metered yet.

Same-day token usage invoices are off by default
(`AI_ALLOWANCE_REPLACES_USAGE_INVOICES`, default true). The allowance replaces
that overage invoice. Set the env var to `false` to restore same-day token
invoices. Period-close compute overage is unchanged.

## Rolling window

`AI_BUDGET_ROLLING_ENABLED` defaults on. While it is on, included allowance
used in any rolling `AI_BUDGET_ROLLING_HOURS` (default 24) cannot exceed
`AI_BUDGET_ROLLING_FRACTION` (default `0.25`) of the monthly slice. Set the
enabled flag to `false`, `0`, or `off` to disable the window. Purchased
credits are not capped by the window, so buying credits still unblocks a
heavy day.

## Limits

- At `AI_BUDGET_WARN_FRACTION` (default 0.80) the account sees a warning. AI keeps running.
- At 100% of the included allowance, with no credits left, Ask, the research loop, document analysis, and re-analysis pause. The message offers upgrade and buy-credits actions to owners.
- Video and document uploads are stored either way. Analysis is queued when the allowance can cover it, and held (`job_proofs.ai_budget_hold` or `scope_documents.status = budget_hold`, shown as "Waiting for AI allowance") until a reset, upgrade, or credit purchase. The analysis sweep releases held work when the account is no longer paused.

## Credits

Packs are one-time Stripe Checkout payments (`$10`, `$25`, `$50`). The amount
paid becomes AI spend at `AI_CREDIT_USD_RATIO` (default `1`). A $10 pack is
$10 of provider spend. That matches "one credit is one dollar" in
`backend/src/lib/money.ts`. It is not the old 10× customer markup.

Included allowance does **not** roll over. Unused allowance expires at the
period boundary. Purchased credits and staff grants **do** roll over until
they are used. Credits are drawn only after the included allowance (and the
rolling window, when it is on) cannot cover the call.

Checkout metadata is `kind=ai_credits`. The webhook verifies the Stripe
signature, claims `stripe_event_seen`, and grants once per Checkout session
id. A replay does not mint a second balance. An existing subscription changes
plan in place: the plan item's price is updated with proration, and extra
Field Capture seat items stay on that subscription. A workspace with no
subscription still opens Checkout (`kind=plan_change`) on its current interval.

Only org owners (Global Admin, including the legacy office-manager role) can
upgrade or buy. Employees cannot. Atmosphere staff on the internal analytics
scope can list every org's spend and grant credits. Investors cannot.

## Stripe objects to create at launch

Do not create these in live mode from this repo. Create one-time **test-mode**
Prices (or live Prices at launch, by hand) and set:

| Pack | Env var | Amount |
| --- | --- | --- |
| $10 | `STRIPE_AI_CREDIT_10_PRICE_ID` | 1000 cents, one-time |
| $25 | `STRIPE_AI_CREDIT_25_PRICE_ID` | 2500 cents, one-time |
| $50 | `STRIPE_AI_CREDIT_50_PRICE_ID` | 5000 cents, one-time |

Plan changes reuse the existing self-serve subscription prices. No new plan
products are required. Webhook events already handled (`checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`) must stay
enabled. No secrets belong in git.

## Config

| Env | Default | Meaning |
| --- | --- | --- |
| `AI_BUDGET_FRACTION` | `0.10` | Allowance share of the period charge |
| `AI_BUDGET_WARN_FRACTION` | `0.80` | Warning threshold |
| `AI_BUDGET_ROLLING_ENABLED` | `true` | Daily window |
| `AI_BUDGET_ROLLING_HOURS` | `24` | Window length |
| `AI_BUDGET_ROLLING_FRACTION` | `0.25` | Window cap as a share of the monthly slice |
| `AI_CREDIT_USD_RATIO` | `1` | AI dollars credited per dollar paid |
| `AI_ALLOWANCE_REPLACES_USAGE_INVOICES` | `true` | Skip same-day token invoices |
| `AI_PRICE_WHISPER_USD_PER_MINUTE` | `0.006` | Transcription price |
| `AI_PRICE_TAVILY_SEARCH_USD` | `0.008` | One Tavily search |
| `STRIPE_AI_CREDIT_10_PRICE_ID` | empty | Test-mode price |
| `STRIPE_AI_CREDIT_25_PRICE_ID` | empty | Test-mode price |
| `STRIPE_AI_CREDIT_50_PRICE_ID` | empty | Test-mode price |
