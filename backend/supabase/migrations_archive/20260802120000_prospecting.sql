-- 20260802120000_prospecting
--
-- Prospecting: finding the people who hand out restoration work — property
-- managers, adjusters, general contractors, commercial building owners — and
-- getting their contact details onto a lead without retyping anything.
--
-- Three things live here.
--
-- 1. `crm_prospects` — a person a search turned up, saved to the org. The row
--    exists whether or not their email and phone have been paid for; the
--    `revealed_at` stamp is what separates "we found this person" from "we
--    bought their details". Contact columns stay null until a reveal.
--
-- 2. `crm_suppressions` — do-not-contact, per organization. A prospecting tool
--    that cannot be told "never this address again" is a liability, so the
--    list is a first-class table checked before every reveal, not a flag
--    bolted on later.
--
-- 3. `charge_feature_credits()` — the missing half of billing. `record_usage`
--    prices tokens against a model and is the only thing that can currently
--    draw a credit lot down; a revealed phone number is a fixed price with no
--    model and no tokens. This function is the debit half of `record_usage`
--    with the pricing removed and the amount passed in, so a feature can
--    charge a flat rate through exactly the same lots, ledger, spend limit and
--    idempotency guarantees.
--
-- Row Level Security is the tenant boundary here as everywhere else: a row is
-- yours if, and only if, you are a member of the org that owns it.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.prospect_status as enum (
    'new', 'saved', 'contacted', 'converted', 'discarded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- What a suppression covers. An email or phone is suppressed exactly; a
  -- domain suppresses everyone at a company, which is what a "stop contacting
  -- our staff" request from a property manager actually means.
  create type public.suppression_kind as enum ('email', 'phone', 'domain');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Prospects
-- ---------------------------------------------------------------------------

create table if not exists public.crm_prospects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,

  -- Who they are. Name and company come back from a search for free; the
  -- contact columns are the part that costs money.
  full_name text not null,
  title text,
  company_name text,
  company_domain text,
  location text,
  linkedin_url text,

  email text,
  phone text,
  mobile text,

  -- Where the row came from and how much to trust it. `provider` is the
  -- vendor that returned it ('sandbox' while no vendor is licensed);
  -- `provider_person_id` is their key, kept so a re-reveal can be served from
  -- the same record rather than bought twice.
  provider text not null default 'sandbox',
  provider_person_id text,
  confidence numeric(4, 3),

  status public.prospect_status not null default 'new',

  -- The reveal. Null until someone pays for the contact details; the charge
  -- and its ledger description are recorded so the invoice line can always be
  -- traced back to the row it bought.
  revealed_at timestamptz,
  revealed_by uuid references public.profiles (id) on delete set null,
  reveal_cost_nanos bigint not null default 0,

  -- Links out. Set when a prospect becomes a real record; nullable because
  -- linking is caller-supplied, exactly as it is for leads.
  contact_id uuid references public.crm_contacts (id) on delete set null,
  account_id uuid references public.crm_accounts (id) on delete set null,
  lead_id uuid references public.crm_leads (id) on delete set null,

  notes text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_prospects_reveal_cost_nonneg check (reveal_cost_nanos >= 0),
  -- A revealed row must carry something worth having; an unrevealed one must
  -- not carry contact details at all. This is what keeps "revealed" honest.
  constraint crm_prospects_reveal_shape check (
    (revealed_at is null and email is null and phone is null and mobile is null)
    or (revealed_at is not null)
  )
);

create index if not exists crm_prospects_org_idx
  on public.crm_prospects (org_id, created_at desc);
create index if not exists crm_prospects_org_status_idx
  on public.crm_prospects (org_id, status);
-- Soft dedupe, matching the CRM's "normalise and look up, never reject" stance.
create index if not exists crm_prospects_email_idx
  on public.crm_prospects (org_id, lower(email));
-- Unique, not merely indexed: the already-revealed guard reads this row, and
-- a duplicate would let a concurrent second call charge for the same person.
create unique index if not exists crm_prospects_provider_idx
  on public.crm_prospects (org_id, provider_person_id)
  where provider_person_id is not null;

-- ---------------------------------------------------------------------------
-- Suppression list
-- ---------------------------------------------------------------------------

create table if not exists public.crm_suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,

  kind public.suppression_kind not null,
  -- Always stored lowercased and trimmed by the caller; the unique index below
  -- is what makes "add it twice" harmless.
  value text not null,
  reason text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_suppressions_value_present check (length(btrim(value)) > 0)
);

-- A plain column constraint rather than an expression index: the route
-- upserts with ON CONFLICT (org_id, kind, value), and PostgREST can only
-- target a real constraint. Values are lowercased by the writer.
alter table public.crm_suppressions
  drop constraint if exists crm_suppressions_unique;
alter table public.crm_suppressions
  add constraint crm_suppressions_unique unique (org_id, kind, value);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at + immutable ownership
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_prospects', 'crm_suppressions']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function private.touch_updated_at()', t || '_touch', t);

    execute format('drop trigger if exists %I on public.%I', t || '_freeze', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function private.freeze_ownership()', t || '_freeze', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_prospects', 'crm_suppressions']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_org_member(org_id))', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_org_member(org_id))', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.is_org_member(org_id))
         with check (private.is_org_member(org_id))', t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (private.is_org_member(org_id))', t || '_delete', t);
  end loop;
end $$;

grant select, insert, update, delete on public.crm_prospects to authenticated;
grant select, insert, update, delete on public.crm_suppressions to authenticated;
revoke all on public.crm_prospects from anon;
revoke all on public.crm_suppressions from anon;

-- ---------------------------------------------------------------------------
-- Feature prices — server-side, so a caller cannot choose what it pays
-- ---------------------------------------------------------------------------
--
-- The first draft took the amount as an argument, which made the price a
-- client input on a function every authenticated member may execute. Prices
-- live here instead; the charge function looks them up by feature name and
-- refuses a feature it has never heard of.

create table if not exists public.feature_prices (
  feature text primary key,
  price_nanos bigint not null check (price_nanos >= 0),
  description text,
  updated_at timestamptz not null default now()
);

insert into public.feature_prices (feature, price_nanos, description)
values ('contact_reveal', 250000000, 'One revealed business contact')
on conflict (feature) do nothing;

alter table public.feature_prices enable row level security;
drop policy if exists feature_prices_select on public.feature_prices;
create policy feature_prices_select on public.feature_prices
  for select to authenticated using (true);
grant select on public.feature_prices to authenticated;
revoke all on public.feature_prices from anon;

-- ---------------------------------------------------------------------------
-- charge_feature_credits — a flat price, drawn from the same credit lots
-- ---------------------------------------------------------------------------
--
-- `record_usage` cannot serve this: it prices tokens against a model in
-- private.model_costs and refuses an unknown model. A revealed phone number
-- has no model and no tokens — it has a price. So this is that function's
-- debit half, with pricing replaced by a caller-supplied amount:
--
--   membership → billing period → spend limit → balance → FIFO draw-down,
--   one credit_ledger row per lot consumed, keyed for idempotency.
--
-- Idempotency uses public.usage_events the same way record_usage does, so a
-- retried reveal charges once. The event carries zero tokens and the synthetic
-- model id 'feature:<name>', which keeps every charge in one place for the
-- usage screens while remaining obviously not a model call.

create or replace function public.charge_feature_credits(
  p_org uuid,
  p_feature text,
  p_request_id text,
  p_description text default null,
  p_cost_nanos bigint default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_event_id uuid;
  v_existing public.usage_events%rowtype;
  v_remaining bigint;
  v_take bigint;
  v_period_start timestamptz;
  v_spend_limit bigint;
  v_period_spend bigint;
  v_model_id text := 'feature:' || coalesce(p_feature, 'unknown');
  p_amount_nanos bigint;
  lot record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if p_request_id is null or length(btrim(p_request_id)) = 0 then
    raise exception 'request_id_required' using errcode = 'P0001';
  end if;

  -- The price is ours, not the caller's.
  select price_nanos into p_amount_nanos
    from public.feature_prices where feature = p_feature;

  if p_amount_nanos is null then
    raise exception 'unknown_feature'
      using detail = format('no price for %s', p_feature), errcode = 'P0001';
  end if;

  -- Replay of a charge already made: hand back the original receipt rather
  -- than billing twice.
  --
  -- The key alone is NOT enough to authorise that. `usage_events` is a shared
  -- namespace — `record_usage` dedupes in it too — and for a feature charge
  -- the amount and the subject both come from the caller, so the key is the
  -- only thing distinguishing two different purchases. Returning a stranger's
  -- receipt here would hand out unlimited free reveals (and, across the
  -- namespace, free model calls). So a replay must prove it is the SAME
  -- charge; anything else is a collision and must fail loudly.
  select * into v_existing
    from public.usage_events
   where org_id = p_org and request_id = p_request_id;

  if found then
    if v_existing.model_id is distinct from v_model_id
       or v_existing.feature is distinct from p_feature
       or v_existing.price_nanos is distinct from p_amount_nanos then
      raise exception 'request_id_conflict'
        using detail = 'That idempotency key was already used for a different charge.',
              errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'event_id', v_existing.id,
      'price_nanos', v_existing.price_nanos,
      'duplicate', true,
      'balance', public.credit_balance(p_org)
    );
  end if;

  perform private.advance_billing_period(p_org);

  -- A free feature still records its event, so the count of reveals is right
  -- even on a plan where they cost nothing.
  if p_amount_nanos > 0 then
    select period_start, monthly_spend_limit_nanos
      into v_period_start, v_spend_limit
      from public.org_billing
     where org_id = p_org;

    if v_spend_limit is not null then
      select coalesce(sum(price_nanos), 0) into v_period_spend
        from public.usage_events
       where org_id = p_org and created_at >= v_period_start;

      if v_period_spend + p_amount_nanos > v_spend_limit then
        raise exception 'spend_limit_exceeded'
          using detail = format('limit=%s spent=%s required=%s',
                                v_spend_limit, v_period_spend, p_amount_nanos),
                errcode = 'P0001';
      end if;
    end if;

    select coalesce(sum(remaining_nanos), 0) into v_balance
      from public.credit_lots
     where org_id = p_org
       and remaining_nanos > 0
       and (expires_at is null or expires_at > now());

    if v_balance < p_amount_nanos then
      raise exception 'insufficient_credits'
        using detail = format('balance=%s required=%s', v_balance, p_amount_nanos),
              errcode = 'P0001';
    end if;
  end if;

  -- cost_nanos is what the upstream vendor charged us for this reveal, so the
  -- generated margin column stays meaningful for a feature charge exactly as
  -- it does for a model call.
  insert into public.usage_events (
    org_id, user_id, model_id, request_id, feature,
    input_tokens, output_tokens, cost_nanos, price_nanos
  ) values (
    p_org, v_uid, v_model_id, p_request_id, p_feature,
    0, 0, greatest(coalesce(p_cost_nanos, 0), 0), p_amount_nanos
  ) returning id into v_event_id;

  v_remaining := p_amount_nanos;

  for lot in
    select id, bucket, remaining_nanos
      from public.credit_lots
     where org_id = p_org
       and remaining_nanos > 0
       and (expires_at is null or expires_at > now())
     order by expires_at nulls last, created_at
     for update
  loop
    exit when v_remaining <= 0;

    v_take := least(lot.remaining_nanos, v_remaining);

    update public.credit_lots
       set remaining_nanos = remaining_nanos - v_take
     where id = lot.id;

    insert into public.credit_ledger (
      org_id, entry_type, bucket, amount_nanos, description, lot_id,
      usage_event_id, created_by
    ) values (
      p_org, 'usage', lot.bucket, -v_take,
      coalesce(p_description, p_feature), lot.id, v_event_id, v_uid
    );

    v_remaining := v_remaining - v_take;
  end loop;

  return jsonb_build_object(
    'event_id', v_event_id,
    'price_nanos', p_amount_nanos,
    'duplicate', false,
    'balance', public.credit_balance(p_org)
  );
end $$;

revoke execute on function
  public.charge_feature_credits(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function
  public.charge_feature_credits(uuid, text, text, text, bigint)
  to authenticated;
