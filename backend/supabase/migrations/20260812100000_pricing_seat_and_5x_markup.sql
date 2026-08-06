-- ---------------------------------------------------------------------------
-- Pricing: $199.99 / user / month seat, no included usage, 5× token markup
-- ---------------------------------------------------------------------------
-- Seat price buys access only. Token usage is prepaid credits charged at
-- 5× our model cost, published on public.model_rate_card.

-- 5× resale markup on every model; regenerate the customer-facing rate card.
update private.model_costs set markup = 5.0;
select private.sync_rate_card();

-- Retire throughput tiers. Existing orgs on those plans move to Pro seats.
update public.org_billing
   set plan_code = 'pro',
       seats = greatest(seats, 1)
 where plan_code in ('max_5x', 'max_20x', 'team');

update public.billing_plans
   set is_active = false
 where code in ('max_5x', 'max_20x', 'team');

-- Free: still the default for new orgs, but no bundled usage credits.
update public.billing_plans
   set name = 'Free',
       tagline = 'Get started — buy seats and credits when you are ready',
       monthly_price_cents = 0,
       annual_price_cents = 0,
       included_credits_nanos = 0,
       per_seat = false,
       min_seats = 1,
       rate_multiplier = 1,
       features = '["1 seat","Buy usage credits as you need them","Community support"]'::jsonb,
       is_contact_sales = false,
       is_active = true,
       sort_order = 10
 where code = 'free';

-- Pro: $199.99 per user / month. Seat only — usage is separate prepaid credits.
update public.billing_plans
   set name = 'Pro',
       tagline = 'Full platform access, billed per user',
       monthly_price_cents = 19999,
       annual_price_cents = null,
       included_credits_nanos = 0,
       per_seat = true,
       min_seats = 1,
       rate_multiplier = 1,
       features = '["$199.99 per user / month","No included usage — load credits separately","Full platform access","Usage analytics","Email support"]'::jsonb,
       is_contact_sales = false,
       is_active = true,
       sort_order = 20
 where code = 'pro';

update public.billing_plans
   set name = 'Enterprise',
       tagline = 'Custom volume and terms',
       monthly_price_cents = 0,
       annual_price_cents = null,
       included_credits_nanos = 0,
       per_seat = true,
       min_seats = 25,
       rate_multiplier = 1,
       features = '["Custom seat and usage terms","Volume pricing","SSO and audit logs","Dedicated support"]'::jsonb,
       is_contact_sales = true,
       is_active = true,
       sort_order = 60
 where code = 'enterprise';
