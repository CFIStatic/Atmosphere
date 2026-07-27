-- ============================================================================
-- Stripe payments, receipts and the in-product payment history
-- ============================================================================
--
-- Money is minted by the WEBHOOK, never by the browser. A checkout endpoint
-- only opens a session; credits and subscription changes are applied when
-- Stripe confirms the payment settled, authenticated with the service-role key.
-- A client that navigates back to a success URL has proved nothing.
--
-- Every function here that moves money is therefore service-role only, and
-- every one is replay-safe: Stripe guarantees at-least-once delivery and
-- retries on any non-2xx, so each event will arrive more than once.
-- ============================================================================

-- Stripe identifiers on the org and the plan catalog.
alter table public.org_billing
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

create unique index if not exists org_billing_stripe_customer
  on public.org_billing (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists org_billing_stripe_subscription
  on public.org_billing (stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.billing_plans
  add column if not exists stripe_price_id_monthly text,
  add column if not exists stripe_price_id_annual  text;

-- ---------------------------------------------------------------------------
-- Payment history
-- ---------------------------------------------------------------------------

-- One row per money movement, holding the Stripe receipt and invoice links so
-- a customer can retrieve proof of payment at any time without leaving the
-- product or mailing support.
create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.orgs(id) on delete cascade,
  kind                     text not null check (kind in ('subscription','credits','refund')),
  status                   text not null default 'pending'
                             check (status in ('pending','succeeded','failed','refunded')),
  amount_cents             integer not null,
  currency                 text not null default 'usd',
  description              text,

  stripe_payment_intent_id text,
  stripe_invoice_id        text,
  stripe_charge_id         text,

  receipt_url              text,
  hosted_invoice_url       text,
  invoice_pdf_url          text,
  receipt_email            text,

  card_brand               text,
  card_last4               text,

  purchase_id              uuid references public.credit_purchases(id) on delete set null,
  period_start             timestamptz,
  period_end               timestamptz,
  failure_reason           text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (private.is_org_member(org_id));

create index if not exists payments_org_time on public.payments (org_id, created_at desc);

-- Stripe identifies a payment by intent OR invoice depending on the flow; both
-- are unique so a redelivered webhook updates the row instead of duplicating it.
create unique index if not exists payments_payment_intent
  on public.payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create unique index if not exists payments_invoice
  on public.payments (stripe_invoice_id) where stripe_invoice_id is not null;

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Webhook idempotency
-- ---------------------------------------------------------------------------

create table if not exists private.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

-- True the first time an event id is seen, false on every replay.
create or replace function public.stripe_event_seen(p_event_id text, p_type text)
returns boolean language plpgsql security definer
set search_path to 'private','public','pg_temp' as $$
declare v_first boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  insert into private.stripe_events (id, type) values (p_event_id, p_type)
  on conflict (id) do nothing;
  get diagnostics v_first = row_count;
  return v_first;
end $$;

-- ---------------------------------------------------------------------------
-- Webhook-facing operations
-- ---------------------------------------------------------------------------

create or replace function public.link_stripe_customer(p_org uuid, p_customer_id text)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not private.can_manage_billing(p_org) then
    raise exception 'billing_forbidden' using errcode = '42501';
  end if;
  perform private.advance_billing_period(p_org);
  update public.org_billing set stripe_customer_id = p_customer_id where org_id = p_org;
end $$;

-- Record or update a payment, keyed on the Stripe id so a redelivered webhook
-- updates the existing row rather than creating a second one.
create or replace function public.record_payment(
  p_org uuid, p_kind text, p_status text, p_amount_cents integer,
  p_currency text default 'usd', p_description text default null,
  p_payment_intent_id text default null, p_invoice_id text default null,
  p_charge_id text default null, p_receipt_url text default null,
  p_hosted_invoice_url text default null, p_invoice_pdf_url text default null,
  p_receipt_email text default null, p_card_brand text default null,
  p_card_last4 text default null, p_purchase_id uuid default null,
  p_period_start timestamptz default null, p_period_end timestamptz default null,
  p_failure_reason text default null)
returns public.payments language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_row public.payments%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_payment_intent_id is not null then
    select * into v_row from public.payments
     where stripe_payment_intent_id = p_payment_intent_id for update;
  elsif p_invoice_id is not null then
    select * into v_row from public.payments where stripe_invoice_id = p_invoice_id for update;
  end if;

  if found and v_row.id is not null then
    update public.payments set
      status = p_status, amount_cents = p_amount_cents,
      description = coalesce(p_description, description),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
      stripe_invoice_id = coalesce(p_invoice_id, stripe_invoice_id),
      receipt_url = coalesce(p_receipt_url, receipt_url),
      hosted_invoice_url = coalesce(p_hosted_invoice_url, hosted_invoice_url),
      invoice_pdf_url = coalesce(p_invoice_pdf_url, invoice_pdf_url),
      receipt_email = coalesce(p_receipt_email, receipt_email),
      card_brand = coalesce(p_card_brand, card_brand),
      card_last4 = coalesce(p_card_last4, card_last4),
      purchase_id = coalesce(p_purchase_id, purchase_id),
      period_start = coalesce(p_period_start, period_start),
      period_end = coalesce(p_period_end, period_end),
      failure_reason = p_failure_reason
    where id = v_row.id returning * into v_row;
    return v_row;
  end if;

  insert into public.payments (
    org_id, kind, status, amount_cents, currency, description,
    stripe_payment_intent_id, stripe_invoice_id, stripe_charge_id,
    receipt_url, hosted_invoice_url, invoice_pdf_url, receipt_email,
    card_brand, card_last4, purchase_id, period_start, period_end, failure_reason)
  values (
    p_org, p_kind, p_status, p_amount_cents, p_currency, p_description,
    p_payment_intent_id, p_invoice_id, p_charge_id,
    p_receipt_url, p_hosted_invoice_url, p_invoice_pdf_url, p_receipt_email,
    p_card_brand, p_card_last4, p_purchase_id, p_period_start, p_period_end, p_failure_reason)
  returning * into v_row;
  return v_row;
end $$;

-- Apply a subscription state change from Stripe. Stripe is the source of truth
-- for what the customer is paying for, so this bypasses the role check that
-- guards the in-app plan switcher — it is service-role only.
create or replace function public.stripe_sync_subscription(
  p_org uuid, p_plan text, p_interval public.billing_interval,
  p_seats integer, p_subscription_id text, p_status public.subscription_status,
  p_period_start timestamptz, p_period_end timestamptz)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  b public.org_billing%rowtype; p public.billing_plans%rowtype;
  v_grant bigint; v_lot uuid; v_changed boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into p from public.billing_plans where code = p_plan;
  if not found then raise exception 'unknown_plan' using detail = p_plan, errcode = 'P0002'; end if;

  perform private.advance_billing_period(p_org);
  select * into b from public.org_billing where org_id = p_org for update;

  -- Only re-grant when the plan, seat count or period actually moved. Stripe
  -- sends subscription.updated for plenty of changes that do not affect
  -- entitlement, and re-granting on each one would hand out free credits.
  v_changed := b.plan_code is distinct from p_plan
            or b.seats is distinct from p_seats
            or b.period_end is distinct from p_period_end;

  if v_changed then
    insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
    select org_id, 'expiration', 'plan', -remaining_nanos, 'Subscription changed', id
    from public.credit_lots where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

    update public.credit_lots set remaining_nanos = 0
     where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;
  end if;

  update public.org_billing set
    plan_code = p_plan, billing_interval = p_interval, seats = greatest(p_seats, 1),
    status = p_status, stripe_subscription_id = p_subscription_id,
    period_start = coalesce(p_period_start, period_start),
    period_end = coalesce(p_period_end, period_end),
    cancel_at_period_end = false
  where org_id = p_org returning * into b;

  if v_changed then
    v_grant := p.included_credits_nanos * (case when p.per_seat then b.seats else 1 end);
    if v_grant > 0 then
      insert into public.credit_lots (org_id, bucket, granted_nanos, remaining_nanos, expires_at, description)
      values (p_org, 'plan', v_grant, v_grant, b.period_end, p.name || ' plan credits')
      returning id into v_lot;
      insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
      values (p_org, 'plan_grant', 'plan', v_grant, p.name || ' plan credits', v_lot);
    end if;
  end if;

  return jsonb_build_object('plan', p_plan, 'changed', v_changed,
    'period_end', b.period_end, 'balance', public.credit_balance(p_org));
end $$;

-- The subscription ended at Stripe. Plan credits go with it; credits the
-- customer PAID for are deliberately left alone.
create or replace function public.stripe_cancel_subscription(p_org uuid)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
  select org_id, 'expiration', 'plan', -remaining_nanos, 'Subscription ended', id
  from public.credit_lots where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.credit_lots set remaining_nanos = 0
   where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.org_billing
     set plan_code = 'free', seats = 1, status = 'canceled',
         stripe_subscription_id = null, cancel_at_period_end = false
   where org_id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- credit_balance must be callable by the webhook
-- ---------------------------------------------------------------------------

-- complete_credit_purchase and stripe_sync_subscription both return the new
-- balance, and both run from the webhook under the service role — which has no
-- auth.uid() and so failed the membership check. That raised AFTER the credits
-- were inserted, rolling the whole transaction back: the payment would settle
-- at Stripe, the webhook would 500, Stripe would retry forever, and the
-- customer would never receive the credits they paid for.
create or replace function public.credit_balance(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_nanos', coalesce(sum(remaining_nanos), 0),
    'plan_nanos', coalesce(sum(remaining_nanos) filter (where bucket = 'plan'), 0),
    'purchased_nanos', coalesce(sum(remaining_nanos) filter (where bucket = 'purchased'), 0),
    'promo_nanos', coalesce(sum(remaining_nanos) filter (where bucket = 'promotional'), 0),
    'next_expiry', min(expires_at) filter (where expires_at is not null))
  into v_result from public.credit_lots
  where org_id = p_org and remaining_nanos > 0 and (expires_at is null or expires_at > now());
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Grants — webhook operations stay off the public API
-- ---------------------------------------------------------------------------

revoke execute on function public.stripe_event_seen(text, text) from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, text, text, integer, text, text, text, text, text, text, text, text, text, text, text, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.stripe_sync_subscription(uuid, text, public.billing_interval, integer, text, public.subscription_status, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.stripe_cancel_subscription(uuid) from public, anon, authenticated;

revoke execute on function public.link_stripe_customer(uuid, text) from public, anon;
grant execute on function public.link_stripe_customer(uuid, text) to authenticated;

revoke execute on function public.credit_balance(uuid) from public, anon;
grant execute on function public.credit_balance(uuid) to authenticated;
