-- One open price span per org, closed and replaced under a lock, and a
-- credit-pack refund that cannot drive the balance below zero.
--
-- subscription.created and subscription.updated can run together. Reading the
-- open span and inserting from the API left two open spans, and the allowance
-- summed both. The partial unique index rejects a second open span. The
-- function holds the org lock, closes the current span, and inserts the next
-- one in the same transaction.
--
-- Clawback is tracked per credit-pack charge. The amount owed is the larger
-- of the cumulative refunded share and any open or lost dispute share, and it
-- never exceeds that pack's grant. Each Stripe event debits or restores only
-- the difference from what is already recorded for the charge. A won dispute
-- drops its share, which restores credits unless a refund still covers them.
-- The balance is not taken below zero; the unpaid remainder is shortfall_nanos.

-- Close any raced duplicates so the index can be built on a database that
-- already stored two open spans.
with ranked as (
  select id,
         row_number() over (
           partition by org_id
           order by effective_from desc, created_at desc, id desc
         ) as rn
  from public.ai_budget_price_spans
  where effective_to is null
)
update public.ai_budget_price_spans as span
set effective_to = span.effective_from + interval '1 microsecond'
from ranked
where span.id = ranked.id
  and ranked.rn > 1
  and span.effective_to is null;

create unique index if not exists ai_budget_price_spans_one_open_idx
  on public.ai_budget_price_spans (org_id)
  where effective_to is null;

create or replace function public.record_subscription_price_span(
  p_org uuid,
  p_amount_cents integer,
  p_interval text,
  p_at timestamptz,
  p_period_start timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open public.ai_budget_price_spans%rowtype;
  v_from timestamptz;
begin
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'amount_cents required' using errcode = '22023';
  end if;
  if p_interval is null or p_interval not in ('month', 'year') then
    raise exception 'billing interval required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-budget-price-span'), hashtext(p_org::text));

  select *
    into v_open
  from public.ai_budget_price_spans
  where org_id = p_org
    and effective_to is null
  order by effective_from desc, created_at desc
  limit 1
  for update;

  if found and v_open.amount_cents = p_amount_cents then
    return;
  end if;

  -- Same instant cannot close and reopen without violating effective_to > effective_from.
  if found and p_at <= v_open.effective_from then
    update public.ai_budget_price_spans
    set amount_cents = p_amount_cents,
        billing_interval = p_interval
    where id = v_open.id;
    return;
  end if;

  if found then
    update public.ai_budget_price_spans
    set effective_to = p_at
    where id = v_open.id
      and effective_to is null;
    v_from := p_at;
  elsif p_period_start is not null and p_period_start < p_at then
    v_from := p_period_start;
  else
    v_from := p_at;
  end if;

  insert into public.ai_budget_price_spans (
    org_id, amount_cents, billing_interval, effective_from
  ) values (
    p_org, p_amount_cents, p_interval, v_from
  );
end;
$$;

alter table public.ai_credit_ledger
  add column if not exists stripe_charge_id text;

comment on column public.ai_credit_ledger.stripe_charge_id is
  'Credit-pack charge this clawback debit or restore belongs to.';

create index if not exists ai_credit_ledger_charge_idx
  on public.ai_credit_ledger (org_id, stripe_charge_id)
  where stripe_charge_id is not null;

create table if not exists public.ai_credit_pack_clawbacks (
  org_id                 uuid not null references public.orgs (id) on delete cascade,
  stripe_charge_id       text not null,
  granted_nanos          bigint not null check (granted_nanos >= 0),
  charge_amount_cents    integer not null check (charge_amount_cents >= 0),
  amount_refunded_cents  integer not null default 0 check (amount_refunded_cents >= 0),
  dispute_amount_cents   integer not null default 0 check (dispute_amount_cents >= 0),
  dispute_standing       text check (dispute_standing is null or dispute_standing in ('open', 'lost', 'won')),
  dispute_event_at       timestamptz,
  primary key (org_id, stripe_charge_id)
);

comment on table public.ai_credit_pack_clawbacks is
  'Running refund and dispute position for one credit-pack charge. The ledger holds the debits and restores; this row is what they are measured against.';

alter table public.ai_credit_pack_clawbacks enable row level security;
revoke all on public.ai_credit_pack_clawbacks from public, anon, authenticated;
grant all on public.ai_credit_pack_clawbacks to service_role;

create or replace function public.apply_ai_credit_clawback(
  p_org uuid,
  p_event_id text,
  p_charge_id text,
  p_charge_amount_cents integer,
  p_granted_nanos bigint,
  p_amount_refunded_cents integer,
  p_dispute_amount_cents integer,
  p_dispute_standing text,
  p_event_at timestamptz,
  p_note text
)
returns table (
  applied boolean,
  debited_nanos bigint,
  restored_nanos bigint,
  shortfall_nanos bigint,
  balance_nanos bigint,
  clawed_nanos bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_credit_ledger%rowtype;
  v_state public.ai_credit_pack_clawbacks%rowtype;
  v_grant bigint;
  v_refund_share bigint := 0;
  v_dispute_share bigint := 0;
  v_target bigint;
  v_clawed bigint;
  v_delta bigint;
  v_balance bigint;
  v_debit bigint := 0;
  v_restore bigint := 0;
  v_shortfall bigint := 0;
  v_note text;
  v_apply_dispute boolean := false;
  v_incoming_rank integer := 0;
  v_stored_rank integer := 0;
begin
  if p_event_id is null or length(btrim(p_event_id)) = 0 then
    raise exception 'event_id required' using errcode = '22023';
  end if;
  if p_charge_id is null or length(btrim(p_charge_id)) = 0 then
    raise exception 'charge_id required' using errcode = '22023';
  end if;
  if p_dispute_standing is not null and p_dispute_standing not in ('open', 'lost', 'won') then
    raise exception 'dispute standing required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-credit-draw'), hashtext(p_org::text));

  select *
    into v_existing
  from public.ai_credit_ledger
  where stripe_event_id = p_event_id;

  if found then
    select coalesce(-sum(delta_nanos), 0)
      into v_clawed
    from public.ai_credit_ledger
    where org_id = p_org
      and stripe_charge_id = p_charge_id;
    return query
      select false,
             case when v_existing.delta_nanos < 0 then -v_existing.delta_nanos else 0::bigint end,
             case when v_existing.delta_nanos > 0 then v_existing.delta_nanos else 0::bigint end,
             0::bigint,
             public.ai_credit_balance(p_org),
             v_clawed;
    return;
  end if;

  v_grant := greatest(coalesce(p_granted_nanos, 0), 0);
  v_incoming_rank := case p_dispute_standing
    when 'won' then 2
    when 'lost' then 2
    when 'open' then 1
    else 0
  end;

  select *
    into v_state
  from public.ai_credit_pack_clawbacks
  where org_id = p_org
    and stripe_charge_id = p_charge_id
  for update;

  -- Open is rank 1. Won and lost are rank 2 and are never replaced by open.
  -- At the same rank, only a Stripe event at least as new as the stored one applies.
  if p_dispute_standing is not null then
    v_stored_rank := case
      when not found or v_state.dispute_standing is null then 0
      when v_state.dispute_standing in ('won', 'lost') then 2
      else 1
    end;
    if v_incoming_rank > v_stored_rank then
      v_apply_dispute := true;
    elsif v_incoming_rank = v_stored_rank and v_incoming_rank > 0 then
      v_apply_dispute := not found
        or v_state.dispute_event_at is null
        or p_event_at is null
        or p_event_at >= v_state.dispute_event_at;
    end if;
  end if;

  if not found then
    insert into public.ai_credit_pack_clawbacks (
      org_id, stripe_charge_id, granted_nanos, charge_amount_cents,
      amount_refunded_cents, dispute_amount_cents, dispute_standing, dispute_event_at
    ) values (
      p_org,
      p_charge_id,
      v_grant,
      greatest(coalesce(p_charge_amount_cents, 0), 0),
      greatest(coalesce(p_amount_refunded_cents, 0), 0),
      case when v_apply_dispute then greatest(coalesce(p_dispute_amount_cents, 0), 0) else 0 end,
      case when v_apply_dispute then p_dispute_standing else null end,
      case when v_apply_dispute then p_event_at else null end
    )
    returning * into v_state;
  else
    update public.ai_credit_pack_clawbacks
    set granted_nanos = greatest(granted_nanos, v_grant),
        charge_amount_cents = greatest(charge_amount_cents, greatest(coalesce(p_charge_amount_cents, 0), 0)),
        amount_refunded_cents = greatest(amount_refunded_cents, greatest(coalesce(p_amount_refunded_cents, 0), 0)),
        dispute_amount_cents = case
          when v_apply_dispute then greatest(coalesce(p_dispute_amount_cents, 0), 0)
          else dispute_amount_cents
        end,
        dispute_standing = case
          when v_apply_dispute then p_dispute_standing
          else dispute_standing
        end,
        dispute_event_at = case
          when v_apply_dispute then p_event_at
          else dispute_event_at
        end
    where org_id = p_org
      and stripe_charge_id = p_charge_id
    returning * into v_state;
  end if;

  if v_state.charge_amount_cents > 0 and v_state.granted_nanos > 0 then
    v_refund_share := least(
      v_state.granted_nanos,
      round(
        v_state.granted_nanos
        * least(v_state.amount_refunded_cents, v_state.charge_amount_cents)::numeric
        / v_state.charge_amount_cents
      )::bigint
    );
    if v_state.dispute_standing is not null and v_state.dispute_standing <> 'won' then
      v_dispute_share := least(
        v_state.granted_nanos,
        round(
          v_state.granted_nanos
          * least(v_state.dispute_amount_cents, v_state.charge_amount_cents)::numeric
          / v_state.charge_amount_cents
        )::bigint
      );
    end if;
  end if;

  v_target := least(v_state.granted_nanos, greatest(v_refund_share, v_dispute_share));

  select coalesce(-sum(delta_nanos), 0)
    into v_clawed
  from public.ai_credit_ledger
  where org_id = p_org
    and stripe_charge_id = p_charge_id;

  v_delta := v_target - v_clawed;
  v_balance := greatest(public.ai_credit_balance(p_org), 0);

  if v_delta > 0 then
    v_debit := least(v_delta, v_balance);
    v_shortfall := v_delta - v_debit;
  elsif v_delta < 0 then
    v_restore := -v_delta;
  end if;

  v_note := concat_ws(
    ' ',
    nullif(btrim(coalesce(p_note, '')), ''),
    case when v_shortfall > 0 then 'shortfall_nanos=' || v_shortfall::text else null end
  );

  insert into public.ai_credit_ledger (
    org_id, delta_nanos, kind, stripe_event_id, stripe_charge_id, note
  ) values (
    p_org,
    case when v_restore > 0 then v_restore else -v_debit end,
    case when v_restore > 0 then 'adjustment' else 'refund' end,
    p_event_id,
    p_charge_id,
    nullif(v_note, '')
  );

  return query
    select true,
           v_debit,
           v_restore,
           v_shortfall,
           v_balance - v_debit + v_restore,
           v_clawed + v_debit - v_restore;
end;
$$;

revoke all on function public.record_subscription_price_span(uuid, integer, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_ai_credit_clawback(uuid, text, text, integer, bigint, integer, integer, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_subscription_price_span(uuid, integer, text, timestamptz, timestamptz) to service_role;
grant execute on function public.apply_ai_credit_clawback(uuid, text, text, integer, bigint, integer, integer, text, timestamptz, text) to service_role;
