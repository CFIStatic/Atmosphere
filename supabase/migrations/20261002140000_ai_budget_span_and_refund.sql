-- One open price span per org, closed and replaced under a lock, and a
-- credit-pack refund that cannot drive the balance below zero.
--
-- subscription.created and subscription.updated can run together. Reading the
-- open span and inserting from the API left two open spans, and the allowance
-- summed both. The partial unique index rejects a second open span. The
-- function holds the org lock, closes the current span, and inserts the next
-- one in the same transaction.
--
-- A refund or dispute of a credit pack debits `refund` once per refund or
-- dispute id. Spent credits are not taken from a later pack past zero; the
-- unpaid remainder is stored on the row as shortfall_nanos.

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

create or replace function public.refund_ai_credits(
  p_org uuid,
  p_refund_id text,
  p_debit_nanos bigint,
  p_note text
)
returns table (
  applied boolean,
  debited_nanos bigint,
  shortfall_nanos bigint,
  balance_nanos bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_credit_ledger%rowtype;
  v_balance bigint;
  v_requested bigint;
  v_debit bigint;
  v_shortfall bigint;
  v_note text;
begin
  if p_refund_id is null or length(btrim(p_refund_id)) = 0 then
    raise exception 'refund_id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-credit-draw'), hashtext(p_org::text));

  select *
    into v_existing
  from public.ai_credit_ledger
  where stripe_event_id = p_refund_id;

  if found then
    v_balance := public.ai_credit_balance(p_org);
    return query
      select false,
             greatest(-v_existing.delta_nanos, 0),
             0::bigint,
             v_balance;
    return;
  end if;

  v_requested := greatest(coalesce(p_debit_nanos, 0), 0);
  v_balance := greatest(public.ai_credit_balance(p_org), 0);
  v_debit := least(v_requested, v_balance);
  v_shortfall := v_requested - v_debit;
  v_note := concat_ws(
    ' ',
    nullif(btrim(coalesce(p_note, '')), ''),
    case when v_shortfall > 0 then 'shortfall_nanos=' || v_shortfall::text else null end
  );

  insert into public.ai_credit_ledger (
    org_id, delta_nanos, kind, stripe_event_id, note
  ) values (
    p_org,
    -v_debit,
    'refund',
    p_refund_id,
    nullif(v_note, '')
  );

  return query
    select true, v_debit, v_shortfall, v_balance - v_debit;
end;
$$;

revoke all on function public.record_subscription_price_span(uuid, integer, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.refund_ai_credits(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_subscription_price_span(uuid, integer, text, timestamptz, timestamptz) to service_role;
grant execute on function public.refund_ai_credits(uuid, text, bigint, text) to service_role;
