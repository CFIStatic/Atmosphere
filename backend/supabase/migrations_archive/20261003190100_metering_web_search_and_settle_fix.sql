-- ============================================================================
-- Metering: web search line, research as Ask, and the allowance settle fix.
-- ============================================================================
-- 1. classify_token_feature: 'web_search' / 'tavily' / 'gemini_search' map to
--    the new 'web_search' bucket (was 'other'); 'research' (an Ask mode) maps
--    to 'ask' (was 'other'). Kept in lockstep with
--    backend/src/metering/tokenFeatures.ts.
-- 2. Existing Tavily / Gemini-search rows stored as 'other' move to
--    'web_search'. Amounts are not touched. Idempotent.
-- 3. settle_ai_usage: RETURNS TABLE declares OUT columns named allowance_nanos
--    and credit_nanos, so the unqualified sums over ai_usage_allocations raised
--    42702 "column reference allowance_nanos is ambiguous" on every call with
--    a billing period. No settlement ever succeeded (ai_usage_allocations is
--    empty in production), so purchased AI credits were never drawn down.
--    Same function, columns qualified with the table alias.
-- 4. Gemini rows written before the rate card fix (pricing_status 'legacy')
--    were priced at $0.10 / $0.40 per MTok, the Gemini 2.5 Flash-Lite rate,
--    whatever the model. They are re-priced from their stored token counts at
--    the official rate in private.model_costs (gemini-3.6-flash $0.75/$3.75,
--    gemini-3.5-flash-lite $0.30/$2.50, verified 2026-10-02) × the row's
--    customer markup (10). Output tokens are taken as stored: the raw
--    usageMetadata was not kept, so thinking tokens the old code may have left
--    out cannot be added back. Idempotent (only 'legacy' rows move).
-- ============================================================================

create or replace function public.classify_token_feature(p_feature text)
returns public.token_usage_feature
language sql
immutable
as $$
  select case
    when p_feature is null or btrim(p_feature) = '' then 'other'::public.token_usage_feature
    when lower(p_feature) in (
      'web_search', 'web-search', 'tavily', 'tavily_search', 'gemini_search'
    )
      then 'web_search'::public.token_usage_feature
    when lower(p_feature) in (
      'video_analysis', 'verification', 'llm_verifier', 'vision', 'analyzer',
      'proof_analysis', 'frame_analysis', 'video', 'vision_analyzer',
      'work_event_verification', 'escalation', 'clip_analysis'
    )
      or lower(p_feature) ~ '(^|[_-])(video|verif|analys|vision|frame)([_-]|$)'
      then 'video_analysis'::public.token_usage_feature
    when lower(p_feature) in (
      'ask', 'clip_ask', 'proof_ask', 'job_ask', 'job-ask', 'clip-ask', 'proof-ask', 'research'
    )
      or lower(p_feature) ~ '(^|[_-])ask([_-]|$)'
      then 'ask'::public.token_usage_feature
    when lower(p_feature) in (
      'chat', 'model_completion', 'field_assistant', 'technician',
      'voice', 'assist', 'field-assistant', 'technician_assist', 'field_assist'
    )
      or lower(p_feature) ~ '(chat|assist|voice|completion)'
      then 'chat'::public.token_usage_feature
    else 'other'::public.token_usage_feature
  end;
$$;

update public.token_usage_events
set feature = 'web_search'::public.token_usage_feature,
    provider = coalesce(provider, case when lower(coalesce(model_id, '')) like 'tavily%' then 'tavily' end)
where feature = 'other'::public.token_usage_feature
  and (
    source in ('tavily', 'gemini_search')
    or lower(coalesce(model_id, '')) like 'tavily%'
  );

with priced as (
  select
    e.id,
    round(
        e.input_tokens  * c.input_cost_per_mtok  * 1000
      + e.output_tokens * c.output_cost_per_mtok * 1000
      + e.cache_tokens  * c.input_cost_per_mtok  * 1000 * c.cache_read_multiplier
    )::bigint as cost_nanos,
    coalesce(
      case when (e.metadata->>'customerMarkup') ~ '^[0-9]+(\.[0-9]+)?$'
           then (e.metadata->>'customerMarkup')::numeric end,
      10
    ) as markup,
    e.cost_nanos as old_cost_nanos,
    e.price_nanos as old_price_nanos,
    c.input_cost_per_mtok, c.output_cost_per_mtok, c.cache_read_multiplier
  from public.token_usage_events e
  join private.model_costs c on c.model_id = e.model_id
  where e.pricing_status = 'legacy'
    and e.model_id ~* '^gemini-'
    and e.provider_usage is null
    and e.total_tokens > 0
)
update public.token_usage_events e
set
  cost_nanos     = p.cost_nanos,
  price_nanos    = round(p.cost_nanos * greatest(p.markup, 1))::bigint,
  provider       = coalesce(e.provider, 'google'),
  pricing_status = 'repriced_conservative',
  metadata       = e.metadata || jsonb_build_object(
    'repricing', jsonb_build_object(
      'migration', '20261003190100_metering_web_search_and_settle_fix',
      'reason', 'legacy Gemini row priced at $0.10/$0.40 per MTok instead of the model''s official rate',
      'previousCostNanos', p.old_cost_nanos,
      'previousPriceNanos', p.old_price_nanos,
      'outputAssumption', 'output tokens as stored; raw usageMetadata (thinking tokens) was not kept',
      'inputUsdPerMTok', p.input_cost_per_mtok,
      'outputUsdPerMTok', p.output_cost_per_mtok,
      'cacheReadMultiplier', p.cache_read_multiplier,
      'markup', p.markup,
      'rateCardVerifiedAt', '2026-10-02'
    )
  )
from priced p
where e.id = p.id
  and p.cost_nanos > 0
  and e.pricing_status = 'legacy';

create or replace function public.settle_ai_usage(
  p_org uuid,
  p_request_id text,
  p_cost_nanos bigint,
  p_allowance_nanos bigint,
  p_credit_nanos bigint,
  p_at timestamptz,
  p_period_allowance_nanos bigint,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_window_start timestamptz,
  p_rolling_cap_nanos bigint,
  p_window_event_nanos bigint
)
returns table (
  applied boolean,
  credit_applied boolean,
  allowance_nanos bigint,
  credit_nanos bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_usage_allocations%rowtype;
  v_balance bigint;
  v_caller_allowance bigint := greatest(coalesce(p_allowance_nanos, 0), 0);
  v_credit bigint := greatest(coalesce(p_credit_nanos, 0), 0);
  v_allowance bigint := v_caller_allowance;
  v_period_used bigint := 0;
  v_window_used bigint := 0;
  v_window_count bigint := 0;
  v_window_room bigint := 0;
begin
  if p_request_id is null or length(btrim(p_request_id)) = 0 then
    raise exception 'request_id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-credit-draw'), hashtext(p_org::text));

  select a.* into v_existing
  from public.ai_usage_allocations a
  where a.org_id = p_org and a.request_id = p_request_id;

  if found then
    return query
      select true,
             v_existing.credit_nanos > 0,
             v_existing.allowance_nanos,
             v_existing.credit_nanos;
    return;
  end if;

  if p_period_start is not null
     and p_period_end is not null
     and p_period_allowance_nanos is not null
  then
    select coalesce(sum(greatest(a.allowance_nanos, 0)), 0)
      into v_period_used
    from public.ai_usage_allocations a
    where a.org_id = p_org
      and a.created_at >= p_period_start
      and a.created_at < p_period_end;

    v_allowance := least(v_allowance, greatest(0, p_period_allowance_nanos - v_period_used));
  end if;

  if p_rolling_cap_nanos is not null and p_window_start is not null then
    select coalesce(sum(greatest(a.allowance_nanos, 0)), 0), count(*)
      into v_window_used, v_window_count
    from public.ai_usage_allocations a
    where a.org_id = p_org
      and a.created_at >= p_window_start;

    if v_window_count > 0 then
      v_window_room := greatest(0, p_rolling_cap_nanos - v_window_used);
    else
      v_window_room := greatest(0, p_rolling_cap_nanos - greatest(coalesce(p_window_event_nanos, 0), 0));
    end if;

    v_allowance := least(v_allowance, v_window_room);
  end if;

  v_credit := v_credit + greatest(0, v_caller_allowance - v_allowance);

  select public.ai_credit_balance(p_org) into v_balance;

  if v_credit > 0 and v_balance < v_credit then
    v_credit := 0;
  end if;

  insert into public.ai_usage_allocations (
    org_id, request_id, cost_nanos, allowance_nanos, credit_nanos, created_at
  ) values (
    p_org,
    p_request_id,
    greatest(coalesce(p_cost_nanos, 0), 0),
    v_allowance,
    v_credit,
    coalesce(p_at, now())
  );

  if v_credit > 0 then
    insert into public.ai_credit_ledger (
      org_id, delta_nanos, kind, request_id, note, created_at
    ) values (
      p_org, -v_credit, 'consume', p_request_id, 'AI usage', coalesce(p_at, now())
    );
  end if;

  return query select true, v_credit > 0, v_allowance, v_credit;
end;
$$;

revoke all on function public.settle_ai_usage(uuid, text, bigint, bigint, bigint, timestamptz, bigint, timestamptz, timestamptz, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.settle_ai_usage(uuid, text, bigint, bigint, bigint, timestamptz, bigint, timestamptz, timestamptz, timestamptz, bigint, bigint) to service_role;
